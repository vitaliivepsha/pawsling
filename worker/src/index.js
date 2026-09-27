// Pawsling server: a Cloudflare Worker over a D1 database.
// Game requests carry Telegram's initData. Its signature is checked with the bot token,
// so everything is tied to the Telegram account that is actually playing.
//
// POST /board    { initData, night?, stars?, board? }
//   saves the player's best Night Shift waves and total stars (only ever raised),
//   and when `board` is "night" or "stars" returns the top of that board and the player's rank.
// POST /invoice  { initData, item, lang }  ->  { link }
//   a Telegram Stars invoice for an in-game item, opened in the game with WebApp.openInvoice.
// POST /tg       the bot's webhook (set automatically on the first game request):
//   approves pre-checkout queries, records successful payments, answers /start.

const MAX_AGE = 7 * 24 * 3600; // initData older than this is refused
const LIMITS = { night: 500, stars: 300 }; // anything above is not a real result
const TOP = 20;
// Items sold for Telegram Stars (currency XTR). The price is checked again at pre-checkout.
const ITEMS = { continue: { stars: 1 } };
const TEXT = {
  uk: { title: 'Друге дихання', desc: 'Продовж рівень: повна міцність квартири й усі герої знову на ногах.',
    start: n => `Привіт, ${n}! Роботи-пилососи захопили квартиру. Запускай котів і єнотів, як з рогатки!`, play: '🐾 Грати' },
  en: { title: 'Second wind', desc: 'Continue the level: full home strength and every hero back on their feet.',
    start: n => `Hi, ${n}! Robot vacuums have taken over the flat. Launch the cats and raccoons like a slingshot!`, play: '🐾 Play' },
  pl: { title: 'Drugi oddech', desc: 'Kontynuuj poziom: pełna wytrzymałość mieszkania i wszyscy bohaterowie znów na nogach.',
    start: n => `Cześć, ${n}! Roboty sprzątające przejęły mieszkanie. Wystrzel koty i szopy jak z procy!`, play: '🐾 Graj' },
  de: { title: 'Zweite Luft', desc: 'Spiel weiter: volle Wohnungsstärke und alle Helden wieder auf den Beinen.',
    start: n => `Hallo, ${n}! Saugroboter haben die Wohnung übernommen. Schieß Katzen und Waschbären wie mit einer Schleuder!`, play: '🐾 Spielen' },
  es: { title: 'Segundo aliento', desc: 'Continúa el nivel: resistencia completa y todos los héroes de nuevo en pie.',
    start: n => `¡Hola, ${n}! Las aspiradoras robot han tomado el piso. ¡Lanza a los gatos y mapaches como con un tirachinas!`, play: '🐾 Jugar' },
};
const text = code => TEXT[(code || '').slice(0, 2)] || TEXT.en;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url), path = url.pathname;
    if (req.method !== 'POST' || !['/board', '/invoice', '/tg'].includes(path)) return json({ error: 'not found' }, 404);

    if (path === '/tg') {
      // only Telegram knows the secret we gave it in setWebhook
      if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await hookSecret(env)) return new Response('forbidden', { status: 403 });
      try { await onUpdate(env, await req.json()); } catch (e) { console.log('update failed', e && e.message); }
      return new Response('ok');
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const user = await verify(body.initData, env.BOT_TOKEN);
    if (!user || !user.id) return json({ error: 'unauthorized' }, 401);
    await ensureHook(env, url.origin);

    if (path === '/invoice') {
      const item = ITEMS[body.item];
      if (!item) return json({ error: 'unknown item' }, 400);
      const t = text(body.lang || user.language_code);
      const r = await tg(env, 'createInvoiceLink', {
        title: t.title, description: t.desc, currency: 'XTR',
        payload: JSON.stringify({ item: body.item, u: user.id }),
        prices: [{ label: t.title, amount: item.stars }],
      });
      if (!r.ok) return json({ error: 'invoice failed' }, 502);
      return json({ link: r.result });
    }

    const night = clampInt(body.night, LIMITS.night), stars = clampInt(body.stars, LIMITS.stars);
    if (night || stars) await save(env.DB, user, night, stars);

    if (body.board !== 'night' && body.board !== 'stars') return json({ ok: true });
    return json(await board(env.DB, body.board, user.id));
  },
};

// ---------- Telegram Bot API ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
// the webhook secret is derived from the bot token, so there is nothing extra to configure
async function hookSecret(env) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode('pawsling-hook:' + env.BOT_TOKEN));
  return hex(new Uint8Array(d)).slice(0, 48);
}
let hookReady = false; // per isolate: check the webhook once, not on every request
async function ensureHook(env, origin) {
  if (hookReady) return;
  const url = origin + '/tg';
  const info = await tg(env, 'getWebhookInfo', {});
  if (!(info.ok && info.result.url === url)) {
    await tg(env, 'setWebhook', { url, secret_token: await hookSecret(env), allowed_updates: ['message', 'pre_checkout_query'] });
  }
  hookReady = true;
}
let purchasesReady = false;
async function onUpdate(env, u) {
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    let item = null;
    try { item = ITEMS[JSON.parse(q.invoice_payload).item]; } catch {}
    const ok = !!item && q.currency === 'XTR' && q.total_amount === item.stars;
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: 'This item is no longer available.' });
    return;
  }
  const m = u.message;
  if (!m) return;
  if (m.successful_payment) {
    const p = m.successful_payment;
    let item = '';
    try { item = JSON.parse(p.invoice_payload).item; } catch {}
    if (!purchasesReady) {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS purchases (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        item TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER NOT NULL)`).run();
      purchasesReady = true;
    }
    await env.DB.prepare('INSERT OR IGNORE INTO purchases (charge_id, user_id, item, stars, at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(p.telegram_payment_charge_id, m.from.id, item, p.total_amount, Math.floor(Date.now() / 1000)).run();
    return;
  }
  if (typeof m.text === 'string' && /^\/(start|play)\b/.test(m.text) && env.WEBAPP_URL) {
    const t = text(m.from && m.from.language_code);
    await tg(env, 'sendMessage', {
      chat_id: m.chat.id, text: t.start((m.from && m.from.first_name) || ''),
      reply_markup: { inline_keyboard: [[{ text: t.play, web_app: { url: env.WEBAPP_URL } }]] },
    });
  }
}

function clampInt(v, max) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

function displayName(u) {
  const last = u.last_name ? ` ${[...u.last_name][0]}.` : '';
  const name = `${u.first_name || u.username || 'Player'}${last}`.trim();
  return [...name].slice(0, 24).join('');
}

async function save(db, user, night, stars) {
  const now = Math.floor(Date.now() / 1000);
  // SQLite evaluates every SET expression against the old row, so the *_at columns
  // compare with the previous best before it is replaced.
  await db.prepare(`
    INSERT INTO players (id, name, night, stars, night_at, stars_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      night_at = CASE WHEN excluded.night > players.night THEN excluded.night_at ELSE players.night_at END,
      night = MAX(players.night, excluded.night),
      stars_at = CASE WHEN excluded.stars > players.stars THEN excluded.stars_at ELSE players.stars_at END,
      stars = MAX(players.stars, excluded.stars),
      updated_at = excluded.updated_at
  `).bind(user.id, displayName(user), night, stars, now).run();
}

async function board(db, col, id) {
  // `col` is one of two fixed names checked by the caller, never user text
  const top = await db.prepare(
    `SELECT id, name, ${col} AS value FROM players WHERE ${col} > 0 ORDER BY ${col} DESC, ${col}_at ASC LIMIT ${TOP}`,
  ).all();
  const me = await db.prepare(`SELECT ${col} AS value, ${col}_at AS at FROM players WHERE id = ?1`).bind(id).first();
  let mine = null;
  if (me && me.value > 0) {
    const ahead = await db.prepare(
      `SELECT COUNT(*) AS n FROM players WHERE ${col} > ?1 OR (${col} = ?1 AND ${col}_at < ?2)`,
    ).bind(me.value, me.at).first();
    mine = { rank: ahead.n + 1, value: me.value };
  }
  return {
    board: col,
    top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, me: r.id === id })),
    me: mine,
  };
}

// ---------- Telegram initData check (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) ----------
const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verify(initData, token) {
  if (typeof initData !== 'string' || !initData || !token) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', token);
  if (!sameString(hex(await hmac(secret, check)), hash)) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date'));
  if (!(age >= -60 && age < MAX_AGE)) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
