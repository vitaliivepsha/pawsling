// Pawsling server: a Cloudflare Worker over a D1 database.
// Game requests carry Telegram's initData. Its signature is checked with the bot token,
// so everything is tied to the Telegram account that is actually playing.
//
// POST /board    { initData, night?, stars?, board? }
//   saves the player's best Night Shift waves and total stars (only ever raised),
//   and when `board` is "night" or "stars" returns the top of that board and the player's rank.
// POST /invoice  { initData, item, lang }  ->  { link }
//   a Telegram Stars invoice for an in-game item, opened in the game with WebApp.openInvoice.
// POST /inventory { initData }  ->  { items }   what the player owns (boosters, hats, heroes)
// POST /use       { initData, item }  ->  { ok, items }   spends one booster
// POST /daily     { initData }  ->  today's login bonus (once a day), streak, invite count, bot name;
//   a first visit through a friend's link (start_param ref_<id>) gifts both players
// POST /challenge { initData, reward }  ->  the daily challenge reward, once a day
// POST /notify    { initData, on, tz, room, lang }  ->  raid alerts on or off (on by default; tz: getTimezoneOffset minutes)
// POST /raid      { initData, id }  ->  { ok, late?, reward, items }  the raid bonus, if the raid was repelled in time
// cron (every hour): players with alerts on who haven't played for a while get, at most once a day and
//   between 10:00 and 21:00 their time, a raid alert with a picture and a button; they have 30 minutes
// POST /share     { initData, lang }  ->  { id }  an invite card (picture, text, Play button with the
//   player's referral link) prepared for WebApp.shareMessage; t.me Mini App links get no link preview
// cron (Monday 00:05 UTC): the week's top 3 in Night Shift get prizes and a message from the bot
// POST /tg       the bot's webhook (set automatically on the first game request):
//   approves pre-checkout queries, records successful payments and refunds, answers /start,
//   and answers inline queries (@the_bot in any chat) with the player's invite card.
// ADMIN_ID (secret, optional): the owner's Telegram id. The bot messages the owner about every
//   purchase and refund, and answers the owner's /sales with a sales summary. Other text sent to the
//   bot goes to the owner as a support message; the owner's reply to it goes back to that player.

const MAX_AGE = 7 * 24 * 3600; // initData older than this is refused
const LIMITS = { night: 500, stars: 300 }; // anything above is not a real result
const TOP = 20;
// Items sold for Telegram Stars (currency XTR). The price is checked again at pre-checkout.
// `grant` is what lands in the player's inventory once the payment succeeds.
const ITEMS = {
  continue: { stars: 10 },
  heart3: { stars: 15, grant: { heart: 3 } },
  meter3: { stars: 15, grant: { meter: 3 } },
  hat_party: { stars: 20, grant: { hat_party: 1 } },
  hat_crown: { stars: 40, grant: { hat_crown: 1 } },
  hat_bow: { stars: 20, grant: { hat_bow: 1 } },
  rainbow: { stars: 25, grant: { rainbow: 1 } },
  hero_spark: { stars: 150, grant: { hero_spark: 1 } },
  hero_rex: { stars: 150, grant: { hero_rex: 1 } },
};
const BOOSTERS = ['heart', 'meter']; // the only items that get used up
// login bonus by day of the streak (the 7th day restarts the cycle)
const DAILY = [{ meter: 1 }, { heart: 1 }, { meter: 1 }, { heart: 1 }, { meter: 2 }, { heart: 2 }, { hat_party: 1, heart: 1, meter: 1 }];
const RAID_GIFT = { heart: 1, meter: 1 }, RAID_MIN = 30, ROOMS_N = 13;
const REF_GIFT = { heart: 1, meter: 1 }; // for both the inviter and the new player
const WEEK_PRIZES = [{ heart: 3, meter: 3 }, { heart: 2, meter: 2 }, { heart: 1, meter: 1 }];
const DAY = 86400000;
const utcDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
function weekStart(ts = Date.now()) { // Monday 00:00 UTC of the week containing ts
  const d = new Date(ts), back = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}
const weekKey = (ts = Date.now()) => utcDay(weekStart(ts));
const TEXT = {
  uk: { rooms: ['Кухня', 'Вітальня', 'Спальня', 'Ванна', 'Балкон', 'Горище', 'Гараж', 'Підвал', 'Дах', 'Сад', 'Серверна', 'Під\'їзд', 'Склад'], raid: room => `🚨 Тривога! Роботи-пилососи напали на кімнату «${room}»!\n\nВідбий нальот за 30 хвилин і отримай бонус: ❤️ +1 серце і ⚡ +1 швидкий старт.`, raidBtn: '🐾 Відбити нальот',
    invite: 'Коти та єноти проти роботів-пилососів! Зіграй зі мною в Pawsling 🐾',
    sent: 'Дякуємо! Повідомлення передано розробнику.',
    refJoined: n => `${n} прийшов у гру за твоїм запрошенням! Вам обом: +1 серце і +1 швидкий старт.`,
    weekWin: (place, w) => `Тиждень «Нічної зміни» завершено: ти на ${place} місці (${w} хвиль)! Приз уже в магазині.`,
    items: { heart3: ['Серце+ ×3', '+1 серце кожному героєві на 3 рівні.'], meter3: ['Швидкий старт ×3', 'Пів шкали «Бешкету» на старті 3 рівнів.'], hat_party: ['Святковий ковпак', 'Капелюшок для всієї команди, назавжди.'], hat_crown: ['Корона', 'Корона для всієї команди, назавжди.'], hat_bow: ['Бантик', 'Бантик для всієї команди, назавжди.'], rainbow: ['Райдужна нитка', 'Нитки героїв переливаються веселкою, назавжди.'], hero_rex: ['Рекс', 'Новий герой: пес-рятувальник, що лікує друзів, яких зачепить.'], hero_spark: ['Іскра', 'Нова героїня: її удар перескакує блискавкою на найближчого ворога.'] },
    title: 'Друге дихання', desc: 'Продовж рівень: повна міцність квартири й усі герої знову на ногах.',
    start: n => `Привіт, ${n}! Роботи-пилососи захопили квартиру. Запускай котів і єнотів, як з рогатки!`, play: '🐾 Грати' },
  en: { rooms: ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Balcony', 'Attic', 'Garage', 'Basement', 'Roof', 'Garden', 'Server room', 'Stairwell', 'Warehouse'], raid: room => `🚨 Alert! Robot vacuums are raiding your home: ${room}!\n\nRepel the raid within 30 minutes and get a bonus: ❤️ +1 heart and ⚡ +1 quick start.`, raidBtn: '🐾 Repel the raid',
    invite: 'Cats and raccoons vs robot vacuums! Play Pawsling with me 🐾',
    sent: 'Thanks! Your message has been sent to the developer.',
    refJoined: n => `${n} joined the game with your invite! You both get +1 heart and +1 quick start.`,
    weekWin: (place, w) => `The Night Shift week is over: you finished #${place} (${w} waves)! Your prize is in the shop.`,
    items: { heart3: ['Heart+ ×3', '+1 heart for every hero, for 3 levels.'], meter3: ['Quick start ×3', 'Half a Mischief meter at the start of 3 levels.'], hat_party: ['Party hat', 'A hat for the whole team, forever.'], hat_crown: ['Crown', 'A crown for the whole team, forever.'], hat_bow: ['Bow', 'A bow for the whole team, forever.'], rainbow: ['Rainbow yarn', 'Hero threads shimmer in rainbow colors, forever.'], hero_rex: ['Rex', 'A new hero: a rescue dog that heals every friend he touches.'], hero_spark: ['Sparky', 'A new hero: her hits arc like lightning to the nearest enemy.'] },
    title: 'Second wind', desc: 'Continue the level: full home strength and every hero back on their feet.',
    start: n => `Hi, ${n}! Robot vacuums have taken over the flat. Launch the cats and raccoons like a slingshot!`, play: '🐾 Play' },
  pl: { rooms: ['Kuchnia', 'Salon', 'Sypialnia', 'Łazienka', 'Balkon', 'Strych', 'Garaż', 'Piwnica', 'Dach', 'Ogród', 'Serwerownia', 'Klatka schodowa', 'Magazyn'], raid: room => `🚨 Alarm! Roboty sprzątające napadły na pokój: ${room}!\n\nOdeprzyj nalot w 30 minut i zdobądź bonus: ❤️ +1 serce i ⚡ +1 szybki start.`, raidBtn: '🐾 Odeprzyj nalot',
    invite: 'Koty i szopy kontra roboty sprzątające! Zagraj ze mną w Pawsling 🐾',
    sent: 'Dzięki! Wiadomość trafiła do twórcy gry.',
    refJoined: n => `${n} dołączył(a) do gry z twojego zaproszenia! Oboje dostajecie +1 serce i +1 szybki start.`,
    weekWin: (place, w) => `Tydzień nocnej zmiany zakończony: zajmujesz ${place}. miejsce (${w} fal)! Nagroda czeka w sklepie.`,
    items: { heart3: ['Serce+ ×3', '+1 serce dla każdego bohatera na 3 poziomy.'], meter3: ['Szybki start ×3', 'Pół paska psot na starcie 3 poziomów.'], hat_party: ['Czapeczka imprezowa', 'Czapka dla całej drużyny, na zawsze.'], hat_crown: ['Korona', 'Korona dla całej drużyny, na zawsze.'], hat_bow: ['Kokardka', 'Kokardka dla całej drużyny, na zawsze.'], rainbow: ['Tęczowa włóczka', 'Nitki bohaterów mienią się tęczą, na zawsze.'], hero_rex: ['Reks', 'Nowy bohater: pies ratownik, który leczy przyjaciół, których dotknie.'], hero_spark: ['Iskra', 'Nowa bohaterka: jej ciosy przeskakują piorunem na najbliższego wroga.'] },
    title: 'Drugi oddech', desc: 'Kontynuuj poziom: pełna wytrzymałość mieszkania i wszyscy bohaterowie znów na nogach.',
    start: n => `Cześć, ${n}! Roboty sprzątające przejęły mieszkanie. Wystrzel koty i szopy jak z procy!`, play: '🐾 Graj' },
  de: { rooms: ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Badezimmer', 'Balkon', 'Dachboden', 'Garage', 'Keller', 'Dach', 'Garten', 'Serverraum', 'Treppenhaus', 'Lager'], raid: room => `🚨 Alarm! Saugroboter überfallen den Raum: ${room}!\n\nWehr den Überfall in 30 Minuten ab und hol dir einen Bonus: ❤️ +1 Herz und ⚡ +1 Schnellstart.`, raidBtn: '🐾 Überfall abwehren',
    invite: 'Katzen und Waschbären gegen Saugroboter! Spiel Pawsling mit mir 🐾',
    sent: 'Danke! Deine Nachricht wurde an den Entwickler weitergeleitet.',
    refJoined: n => `${n} ist über deine Einladung ins Spiel gekommen! Ihr bekommt beide +1 Herz und +1 Schnellstart.`,
    weekWin: (place, w) => `Die Nachtschicht-Woche ist vorbei: Platz ${place} (${w} Wellen)! Dein Preis liegt im Shop.`,
    items: { heart3: ['Herz+ ×3', '+1 Herz für jeden Helden, für 3 Level.'], meter3: ['Schnellstart ×3', 'Halbe Unfug-Leiste zu Beginn von 3 Leveln.'], hat_party: ['Partyhut', 'Ein Hut für das ganze Team, für immer.'], hat_crown: ['Krone', 'Eine Krone für das ganze Team, für immer.'], hat_bow: ['Schleife', 'Eine Schleife für das ganze Team, für immer.'], rainbow: ['Regenbogenwolle', 'Die Fäden der Helden schimmern in Regenbogenfarben, für immer.'], hero_rex: ['Rex', 'Ein neuer Held: ein Rettungshund, der jeden berührten Freund heilt.'], hero_spark: ['Funke', 'Eine neue Heldin: ihre Treffer springen als Blitz zum nächsten Gegner.'] },
    title: 'Zweite Luft', desc: 'Spiel weiter: volle Wohnungsstärke und alle Helden wieder auf den Beinen.',
    start: n => `Hallo, ${n}! Saugroboter haben die Wohnung übernommen. Schieß Katzen und Waschbären wie mit einer Schleuder!`, play: '🐾 Spielen' },
  es: { rooms: ['Cocina', 'Salón', 'Dormitorio', 'Baño', 'Balcón', 'Desván', 'Garaje', 'Sótano', 'Tejado', 'Jardín', 'Sala de servidores', 'Escalera', 'Almacén'], raid: room => `🚨 ¡Alerta! ¡Las aspiradoras robot asaltan la habitación: ${room}!\n\nRechaza el asalto en 30 minutos y gana un bonus: ❤️ +1 corazón y ⚡ +1 inicio rápido.`, raidBtn: '🐾 Rechazar el asalto',
    invite: '¡Gatos y mapaches contra aspiradoras robot! Juega Pawsling conmigo 🐾',
    sent: '¡Gracias! Tu mensaje se ha enviado al desarrollador.',
    refJoined: n => `¡${n} se unió al juego con tu invitación! Los dos recibís +1 corazón y +1 inicio rápido.`,
    weekWin: (place, w) => `Terminó la semana del turno de noche: quedaste en el puesto ${place} (${w} oleadas). ¡Tu premio está en la tienda!`,
    items: { heart3: ['Corazón+ ×3', '+1 corazón para cada héroe durante 3 niveles.'], meter3: ['Inicio rápido ×3', 'Media barra de travesura al empezar 3 niveles.'], hat_party: ['Gorro de fiesta', 'Un gorro para todo el equipo, para siempre.'], hat_crown: ['Corona', 'Una corona para todo el equipo, para siempre.'], hat_bow: ['Lazo', 'Un lazo para todo el equipo, para siempre.'], rainbow: ['Hilo arcoíris', 'Los hilos de los héroes brillan con los colores del arcoíris, para siempre.'], hero_rex: ['Rex', 'Un nuevo héroe: un perro de rescate que cura a cada amigo que toca.'], hero_spark: ['Chispa', 'Una nueva heroína: sus golpes saltan como un rayo al enemigo más cercano.'] },
    title: 'Segundo aliento', desc: 'Continúa el nivel: resistencia completa y todos los héroes de nuevo en pie.',
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
    if (req.method !== 'POST' || !['/board', '/invoice', '/inventory', '/use', '/daily', '/challenge', '/share', '/notify', '/raid', '/tg'].includes(path)) return json({ error: 'not found' }, 404);

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
    try { await ensureHook(env, url.origin); } catch (e) { console.log('webhook check failed', e && e.message); }

    if (path === '/invoice') {
      const item = ITEMS[body.item];
      if (!item) return json({ error: 'unknown item' }, 400);
      const t = text(body.lang || user.language_code);
      const [title, description] = (t.items && t.items[body.item]) || [t.title, t.desc];
      const r = await tg(env, 'createInvoiceLink', {
        title, description, currency: 'XTR',
        payload: JSON.stringify({ item: body.item, u: user.id }),
        prices: [{ label: title, amount: item.stars }],
      });
      if (!r.ok) return json({ error: 'invoice failed' }, 502);
      return json({ link: r.result });
    }
    if (path === '/inventory') return json({ items: await inventory(env.DB, user.id) });
    if (path === '/use') {
      if (!BOOSTERS.includes(body.item)) return json({ error: 'not a booster' }, 400);
      await ensureTables(env.DB);
      const r = await env.DB.prepare('UPDATE inventory SET count = count - 1 WHERE user_id = ?1 AND item = ?2 AND count > 0')
        .bind(user.id, body.item).run();
      return json({ ok: r.meta.changes > 0, items: await inventory(env.DB, user.id) });
    }

    if (path === '/daily') return json(await daily(env, user, body));
    if (path === '/notify') {
      await ensureTables(env.DB);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`INSERT INTO notify (user_id, enabled, lang, tz, room, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, lang = excluded.lang, tz = excluded.tz, room = excluded.room, last_seen = excluded.last_seen, blocked = 0`)
        .bind(user.id, body.on ? 1 : 0, String(body.lang || user.language_code || '').slice(0, 5), clampTz(body.tz), clampRoom(body.room), now).run();
      return json({ ok: true, on: !!body.on });
    }
    if (path === '/raid') {
      await ensureTables(env.DB);
      const now = Math.floor(Date.now() / 1000), id = Math.floor(Number(body.id)) || 0;
      // a minute of grace for a win that lands just as the timer runs out
      const r = await env.DB.prepare('UPDATE raids SET done = ?3 WHERE id = ?1 AND user_id = ?2 AND done IS NULL AND expires + 60 >= ?3')
        .bind(id, user.id, now).run();
      if (r.meta.changes > 0) await grant(env.DB, user.id, RAID_GIFT);
      return json({ ok: r.meta.changes > 0, late: r.meta.changes === 0, reward: RAID_GIFT, items: await inventory(env.DB, user.id) });
    }
    if (path === '/share') {
      if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
      const r = await tg(env, 'savePreparedInlineMessage', {
        user_id: user.id, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true,
        result: inviteCard(text(body.lang || user.language_code), user.id),
      });
      return r.ok ? json({ id: r.result.id }) : json({ error: 'share failed' }, 502);
    }
    if (path === '/challenge') {
      if (!BOOSTERS.includes(body.reward)) return json({ error: 'bad reward' }, 400);
      await ensureTables(env.DB);
      const today = utcDay();
      const r = await env.DB.prepare(`INSERT INTO daily (user_id, streak, challenge_day, lang) VALUES (?1, 0, ?2, ?3)
        ON CONFLICT(user_id) DO UPDATE SET challenge_day = excluded.challenge_day WHERE daily.challenge_day IS NOT excluded.challenge_day`)
        .bind(user.id, today, user.language_code || '').run();
      if (r.meta.changes > 0) await grant(env.DB, user.id, { [body.reward]: 1 });
      return json({ ok: r.meta.changes > 0, items: await inventory(env.DB, user.id) });
    }

    await ensureTables(env.DB);
    const night = clampInt(body.night, LIMITS.night), stars = clampInt(body.stars, LIMITS.stars), week = clampInt(body.week, LIMITS.night);
    if (night || stars) await save(env.DB, user, night, stars);
    if (week) await saveWeek(env.DB, user, week);

    if (body.board === 'week') return json(await weekBoard(env.DB, user.id));
    if (body.board !== 'night' && body.board !== 'stars') return json({ ok: true });
    return json(await board(env.DB, body.board, user.id));
  },

  async scheduled(event, env, ctx) { ctx.waitUntil(event.cron === '5 0 * * 1' ? awardWeek(env) : sendRaids(env)); },
};

// ---------- daily bonus, challenge, invites ----------
let botName = null;
async function daily(env, user, body = {}) {
  const db = env.DB;
  await ensureTables(db);
  // remember when this player was last here (raids skip people who are playing anyway)
  const now = Math.floor(Date.now() / 1000);
  // raid alerts are on by default; a player can turn them off with the bell in the game
  await db.prepare('INSERT OR IGNORE INTO notify (user_id, enabled, lang, tz, room, last_seen) VALUES (?1, 1, ?2, ?3, ?4, ?5)')
    .bind(user.id, String(body.lang || user.language_code || '').slice(0, 5), clampTz(body.tz), clampRoom(body.room), now).run();
  await db.prepare('UPDATE notify SET last_seen = ?2, tz = ?3, room = ?4 WHERE user_id = ?1').bind(user.id, now, clampTz(body.tz), clampRoom(body.room)).run();
  const nrow = await db.prepare('SELECT enabled FROM notify WHERE user_id = ?1').bind(user.id).first();
  const raid = await db.prepare('SELECT id, room, expires FROM raids WHERE user_id = ?1 AND done IS NULL AND expires > ?2 ORDER BY id DESC LIMIT 1').bind(user.id, now).first();
  const today = utcDay(), yesterday = utcDay(Date.now() - DAY);
  const row = await db.prepare('SELECT last_day, streak, challenge_day FROM daily WHERE user_id = ?1').bind(user.id).first();
  const known = row || await db.prepare('SELECT 1 AS x FROM players WHERE id = ?1').bind(user.id).first();
  let claimed = false, streak = row ? row.streak : 0, reward = null, gifted = false;
  if (!row || row.last_day !== today) {
    const next = row && row.last_day === yesterday ? row.streak % DAILY.length + 1 : 1;
    const r = await db.prepare(`INSERT INTO daily (user_id, last_day, streak, lang) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(user_id) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak, lang = excluded.lang
      WHERE daily.last_day IS NOT excluded.last_day`)
      .bind(user.id, today, next, user.language_code || '').run();
    streak = next;
    if (r.meta.changes > 0) { reward = DAILY[next - 1]; await grant(db, user.id, reward); claimed = true; }
  }
  // a brand-new player who came through a friend's link
  const m = /^ref_(\d+)$/.exec(user.start || '');
  if (!known && m && Number(m[1]) !== user.id) {
    const inviter = Number(m[1]);
    const r = await db.prepare('INSERT OR IGNORE INTO referrals (user_id, ref_by, at) VALUES (?1, ?2, ?3)').bind(user.id, inviter, Math.floor(Date.now() / 1000)).run();
    if (r.meta.changes > 0) {
      await grant(db, user.id, REF_GIFT); await grant(db, inviter, REF_GIFT); gifted = true;
      const il = await db.prepare('SELECT lang FROM daily WHERE user_id = ?1').bind(inviter).first();
      await tg(env, 'sendMessage', { chat_id: inviter, text: text(il && il.lang).refJoined(displayName(user)) });
    }
  }
  const inv = await db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE ref_by = ?1').bind(user.id).first();
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  return { claimed, streak, reward, gifted, challengeDone: !!row && row.challenge_day === today, invited: inv.n, bot: botName,
    notify: !!(nrow && nrow.enabled), raid: raid ? { id: raid.id, room: raid.room, expires: raid.expires * 1000 } : null,
    items: await inventory(db, user.id), today, weekEnds: weekStart() + 7 * DAY };
}
async function grant(db, id, g) {
  await db.batch(Object.entries(g).map(([k, n]) => db.prepare(
    'INSERT INTO inventory (user_id, item, count) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count',
  ).bind(id, k, n)));
}

// ---------- weekly Night Shift tournament ----------
async function saveWeek(db, user, night) {
  await db.prepare(`INSERT INTO weekly (week, user_id, name, lang, night, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(week, user_id) DO UPDATE SET name = excluded.name, lang = excluded.lang,
      at = CASE WHEN excluded.night > weekly.night THEN excluded.at ELSE weekly.at END,
      night = MAX(weekly.night, excluded.night)`)
    .bind(weekKey(), user.id, displayName(user), user.language_code || '', night, Math.floor(Date.now() / 1000)).run();
}
async function weekBoard(db, id) {
  const wk = weekKey();
  const top = await db.prepare(`SELECT user_id AS id, name, night AS value FROM weekly WHERE week = ?1 AND night > 0 ORDER BY night DESC, at ASC LIMIT ${TOP}`).bind(wk).all();
  const me = await db.prepare('SELECT night AS value, at FROM weekly WHERE week = ?1 AND user_id = ?2').bind(wk, id).first();
  let mine = null;
  if (me && me.value > 0) {
    const ahead = await db.prepare('SELECT COUNT(*) AS n FROM weekly WHERE week = ?1 AND (night > ?2 OR (night = ?2 AND at < ?3))').bind(wk, me.value, me.at).first();
    mine = { rank: ahead.n + 1, value: me.value };
  }
  return { board: 'week', top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, me: r.id === id })), me: mine,
    endsAt: weekStart() + 7 * DAY };
}
async function awardWeek(env) {
  const db = env.DB;
  await ensureTables(db);
  const wk = weekKey(Date.now() - 3 * DAY); // the cron runs early on Monday: award the week that just ended
  const done = await db.prepare('INSERT OR IGNORE INTO week_awards (week, at) VALUES (?1, ?2)').bind(wk, Math.floor(Date.now() / 1000)).run();
  if (done.meta.changes === 0) return;
  const top = await db.prepare('SELECT user_id, lang, night FROM weekly WHERE week = ?1 AND night > 0 ORDER BY night DESC, at ASC LIMIT 3').bind(wk).all();
  for (const [i, r] of top.results.entries()) {
    await grant(db, r.user_id, WEEK_PRIZES[i]);
    try { await tg(env, 'sendMessage', { chat_id: r.user_id, text: text(r.lang).weekWin(i + 1, r.night) }); } catch {}
  }
}

// ---------- Telegram Bot API ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try { return await r.json(); } catch (e) { return { ok: false, description: 'HTTP ' + r.status }; }
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
  const want = ['message', 'pre_checkout_query', 'inline_query', 'my_chat_member'];
  const have = (info.ok && info.result.allowed_updates) || [];
  if (!(info.ok && info.result.url === url) || want.some(k => !have.includes(k))) {
    await tg(env, 'setWebhook', { url, secret_token: await hookSecret(env), allowed_updates: want });
  }
  hookReady = true;
}
let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, night INTEGER NOT NULL DEFAULT 0,
      stars INTEGER NOT NULL DEFAULT 0, night_at INTEGER NOT NULL DEFAULT 0, stars_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_night ON players (night DESC, night_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_stars ON players (stars DESC, stars_at ASC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS purchases (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      item TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory (user_id INTEGER NOT NULL, item TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, item))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily (user_id INTEGER PRIMARY KEY, last_day TEXT, streak INTEGER NOT NULL DEFAULT 0,
      challenge_day TEXT, lang TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS referrals (user_id INTEGER PRIMARY KEY, ref_by INTEGER NOT NULL, at INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS weekly (week TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, lang TEXT,
      night INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (week, user_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_weekly ON weekly (week, night DESC, at ASC)'),
    db.prepare('CREATE TABLE IF NOT EXISTS week_awards (week TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS refunds (charge_id TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS notify (user_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, lang TEXT, tz INTEGER NOT NULL DEFAULT 0,
      room INTEGER NOT NULL DEFAULT 0, last_seen INTEGER, last_raid INTEGER, blocked INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS raids (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, room INTEGER NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL, done INTEGER)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_raids_user ON raids (user_id, id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS raid_runs (at INTEGER PRIMARY KEY, checked INTEGER NOT NULL, sent INTEGER NOT NULL,
      failed INTEGER NOT NULL, err TEXT)`),
  ]);
  tablesReady = true;
}
async function inventory(db, id) {
  await ensureTables(db);
  const rows = await db.prepare('SELECT item, count FROM inventory WHERE user_id = ?1 AND count > 0').bind(id).all();
  return Object.fromEntries(rows.results.map(r => [r.item, r.count]));
}
// the invite: a picture, a line of text and a Play button carrying the sender's referral link
function inviteCard(t, uid) {
  const art = 'https://vitaliivepsha.github.io/pawsling/promo/';
  return { type: 'photo', id: 'invite-' + uid, photo_url: art + 'welcome-1280x720.jpg', thumbnail_url: art + 'welcome-640x360.jpg',
    photo_width: 1280, photo_height: 720, caption: t.invite,
    reply_markup: { inline_keyboard: [[{ text: t.play, url: `https://t.me/${botName}?startapp=ref_${uid}` }]] } };
}
async function onUpdate(env, u) {
  if (u.my_chat_member) {
    // a player who blocks the bot gets no more alerts; unblocking lets them come back
    const st = u.my_chat_member.new_chat_member && u.my_chat_member.new_chat_member.status;
    await ensureTables(env.DB);
    await env.DB.prepare('UPDATE notify SET blocked = ?2 WHERE user_id = ?1').bind(u.my_chat_member.from.id, st === 'kicked' ? 1 : 0).run();
    return;
  }
  if (u.inline_query) {
    // typing @the_bot in any chat offers the invite card
    const q = u.inline_query;
    if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
    await tg(env, 'answerInlineQuery', { inline_query_id: q.id, is_personal: true, cache_time: 300,
      results: [inviteCard(text(q.from && q.from.language_code), q.from.id)] });
    return;
  }
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
    await ensureTables(env.DB);
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO purchases (charge_id, user_id, item, stars, at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(p.telegram_payment_charge_id, m.from.id, item, p.total_amount, Math.floor(Date.now() / 1000)).run();
    const g = ITEMS[item] && ITEMS[item].grant;
    if (ins.meta.changes > 0) {
      if (g) await grant(env.DB, m.from.id, g);
      await notifyAdmin(env, `💰 ${buyer(m.from)} купує «${itemName(item)}» за ${p.total_amount} ⭐`);
    }
    return;
  }
  if (m.refunded_payment) {
    // a refund takes back what the purchase gave, as far as it is still there
    const p = m.refunded_payment;
    await ensureTables(env.DB);
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO refunds (charge_id, at) VALUES (?1, ?2)')
      .bind(p.telegram_payment_charge_id, Math.floor(Date.now() / 1000)).run();
    if (ins.meta.changes === 0) return;
    const row = await env.DB.prepare('SELECT user_id, item FROM purchases WHERE charge_id = ?1').bind(p.telegram_payment_charge_id).first();
    const g = row && ITEMS[row.item] && ITEMS[row.item].grant;
    if (g) await env.DB.batch(Object.entries(g).map(([k, n]) => env.DB.prepare(
      'UPDATE inventory SET count = MAX(0, count - ?3) WHERE user_id = ?1 AND item = ?2').bind(row.user_id, k, n)));
    await notifyAdmin(env, `↩️ Повернення: ${p.total_amount} ⭐ ${buyer(m.from)}${row ? ` за «${itemName(row.item)}»` : ''}`);
    return;
  }
  if (typeof m.text === 'string' && /^\/raidtest\b/.test(m.text) && isAdmin(env, m.from)) {
    // the owner can try a raid alert right away
    await ensureTables(env.DB);
    const row = await env.DB.prepare('SELECT lang, room FROM notify WHERE user_id = ?1').bind(m.from.id).first();
    const r = await sendRaid(env, m.from.id, (row && row.lang) || (m.from && m.from.language_code), row ? row.room : 0);
    if (!r.ok) await tg(env, 'sendMessage', { chat_id: m.chat.id, text: '⚠️ Не вдалося надіслати нальот: ' + (r.description || '') });
    return;
  }
  if (typeof m.text === 'string' && /^\/raidlog\b/.test(m.text) && isAdmin(env, m.from)) {
    const row = await env.DB.prepare('SELECT tz FROM notify WHERE user_id = ?1').bind(m.from.id).first();
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: await raidLog(env.DB, row ? row.tz : 0) });
    return;
  }
  if (typeof m.text === 'string' && /^\/sales\b/.test(m.text) && isAdmin(env, m.from)) {
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: await salesReport(env.DB) });
    return;
  }
  // starting the bot or allowing it to write lets alerts through again after a block
  if (m.write_access_allowed || (typeof m.text === 'string' && /^\/start\b/.test(m.text))) {
    await ensureTables(env.DB);
    await env.DB.prepare('UPDATE notify SET blocked = 0 WHERE user_id = ?1').bind(m.from.id).run();
    if (m.write_access_allowed) return;
  }
  if (typeof m.text === 'string' && /^\/(start|play)\b/.test(m.text) && env.WEBAPP_URL) {
    const t = text(m.from && m.from.language_code);
    await tg(env, 'sendMessage', {
      chat_id: m.chat.id, text: t.start((m.from && m.from.first_name) || ''),
      reply_markup: { inline_keyboard: [[{ text: t.play, web_app: { url: env.WEBAPP_URL } }]] },
    });
    return;
  }
  // support: players write to the bot, the owner gets the message and answers by replying to it
  if (m.chat && m.chat.type === 'private' && typeof m.text === 'string' && env.ADMIN_ID) {
    if (isAdmin(env, m.from)) {
      const ref = m.reply_to_message && /#u(\d+)/.exec(m.reply_to_message.text || '');
      if (!ref) return;
      const r = await tg(env, 'sendMessage', { chat_id: Number(ref[1]), text: `💬 ${m.text}` });
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: r.ok ? '✅ Відповідь надіслано' : `⚠️ Не вдалося надіслати: ${r.description || ''}` });
      return;
    }
    if (m.text.startsWith('/')) return;
    await notifyAdmin(env, `✉️ ${buyer(m.from)} #u${m.from.id}

${m.text.slice(0, 3500)}

↩️ Відповідь: зроби реплай на це повідомлення`);
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: text(m.from && m.from.language_code).sent });
  }
}

// ---------- owner: purchase notifications and /sales ----------
const isAdmin = (env, from) => !!(env.ADMIN_ID && from && String(from.id) === String(env.ADMIN_ID).trim());
const itemName = item => (TEXT.uk.items[item] || [])[0] || (item === 'continue' ? TEXT.uk.title : item || '?');
const buyer = u => `${displayName(u || {})}${u && u.username ? ' @' + u.username : ''} (id ${u ? u.id : '?'})`;
async function notifyAdmin(env, msg) {
  if (!env.ADMIN_ID) return;
  try { await tg(env, 'sendMessage', { chat_id: String(env.ADMIN_ID).trim(), text: msg }); } catch (e) {}
}
async function salesReport(db) {
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), paid = 'charge_id NOT IN (SELECT charge_id FROM refunds)';
  const period = async since => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS s FROM purchases WHERE ${paid} AND at >= ?1`).bind(since).first();
  const [d1, d7, d30, all] = await Promise.all([period(now - 86400), period(now - 7 * 86400), period(now - 30 * 86400), period(0)]);
  const back = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS s FROM purchases WHERE charge_id IN (SELECT charge_id FROM refunds)`).first();
  const buyers = await db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM purchases WHERE ${paid}`).first();
  const top = await db.prepare(`SELECT item, COUNT(*) AS n, SUM(stars) AS s FROM purchases WHERE ${paid} GROUP BY item ORDER BY s DESC LIMIT 5`).all();
  const last = await db.prepare(`SELECT p.item, p.stars, p.at, p.user_id, pl.name FROM purchases p LEFT JOIN players pl ON pl.id = p.user_id
    WHERE ${paid.replace('charge_id', 'p.charge_id')} ORDER BY p.at DESC LIMIT 5`).all();
  const line = (label, r) => `${label}: ${r.n} ${r.n === 1 ? 'покупка' : r.n >= 2 && r.n <= 4 ? 'покупки' : 'покупок'} · ${r.s} ⭐`;
  const when = ts => new Date(ts * 1000).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const out = ['📊 Продажі Pawsling', '', line('За 24 год', d1), line('За 7 днів', d7), line('За 30 днів', d30), line('Усього', all),
    `Покупців: ${buyers.n}`];
  if (back.n) out.push(`Повернено: ${back.n} · ${back.s} ⭐ (не враховано вище)`);
  if (top.results.length) { out.push('', 'Найкраще продається:'); for (const r of top.results) out.push(`• ${itemName(r.item)} — ${r.n} × · ${r.s} ⭐`); }
  if (last.results.length) { out.push('', 'Останні покупки:'); for (const r of last.results) out.push(`• ${when(r.at)} · ${itemName(r.item)} · ${r.stars} ⭐ · ${r.name || 'id ' + r.user_id}`); }
  if (!all.n) out.push('', 'Поки що покупок немає.');
  return out.join('\n');
}

// ---------- raids: an alert from the bot, 30 minutes to repel it in the game ----------
const clampTz = v => Math.max(-840, Math.min(840, Math.round(Number(v)) || 0));
const clampRoom = v => Math.max(0, Math.min(ROOMS_N - 1, Math.floor(Number(v)) || 0));
async function sendRaid(env, uid, lang, maxRoom) {
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  const now = Math.floor(Date.now() / 1000), room = Math.floor(Math.random() * (clampRoom(maxRoom) + 1)), t = text(lang);
  const ins = await env.DB.prepare('INSERT INTO raids (user_id, room, created, expires) VALUES (?1, ?2, ?3, ?4)').bind(uid, room, now, now + RAID_MIN * 60).run();
  const id = ins.meta.last_row_id;
  const r = await tg(env, 'sendPhoto', {
    chat_id: uid, photo: `https://vitaliivepsha.github.io/pawsling/promo/raid/raid-${room}.jpg`, caption: t.raid(t.rooms[room]),
    reply_markup: { inline_keyboard: [[{ text: t.raidBtn, url: `https://t.me/${botName}?startapp=raid_${id}` }]] },
  });
  if (r.ok) await env.DB.prepare('UPDATE notify SET last_raid = ?2 WHERE user_id = ?1').bind(uid, now).run();
  else {
    await env.DB.prepare('DELETE FROM raids WHERE id = ?1').bind(id).run();
    if (r.error_code === 403) await env.DB.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(uid).run();
  }
  return r;
}
async function sendRaids(env) {
  const db = env.DB;
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), d = new Date();
  // alerts are on, not blocked, nothing sent in the last 20 hours, and not playing in the last 2 hours
  const rows = await db.prepare(`SELECT user_id, lang, tz, room FROM notify WHERE enabled = 1 AND blocked = 0
    AND (last_raid IS NULL OR last_raid < ?1) AND (last_seen IS NULL OR last_seen < ?2) LIMIT 300`).bind(now - 20 * 3600, now - 2 * 3600).all();
  let checked = 0, sent = 0, failed = 0, err = null;
  for (const r of rows.results) {
    const hour = Math.floor(((d.getUTCHours() * 60 + d.getUTCMinutes() - r.tz) % 1440 + 1440) % 1440 / 60);
    if (hour < 10 || hour > 20) continue;
    checked++;
    // a surprise hour between 10:00 and 20:00 local; on about a quarter of the days there is no raid at all
    if (Math.random() > .12) continue;
    let res;
    try { res = await sendRaid(env, r.user_id, r.lang, r.room); } catch (e) { res = { description: String(e) }; }
    if (res.ok) sent++; else { failed++; err = String(res.description || 'error').slice(0, 200); }
  }
  // a short log of the hourly runs for /raidlog
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO raid_runs (at, checked, sent, failed, err) VALUES (?1, ?2, ?3, ?4, ?5)').bind(now, checked, sent, failed, err),
    db.prepare('DELETE FROM raid_runs WHERE at < ?1').bind(now - 3 * 86400),
  ]);
}
async function raidLog(db, tz) {
  await ensureTables(db);
  const runs = await db.prepare('SELECT * FROM raid_runs ORDER BY at DESC LIMIT 24').all();
  const users = await db.prepare('SELECT enabled, blocked, last_raid FROM notify').all();
  const hm = (t) => new Date((t - tz * 60) * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const u = users.results, on = u.filter((x) => x.enabled && !x.blocked).length;
  const lines = [`🚨 Сигнали: увімкнено ${on} з ${u.length}, заблокували ${u.filter((x) => x.blocked).length}`,
    `Нальотів за добу: ${(await db.prepare('SELECT count(*) n FROM raids WHERE created > ?1').bind(Math.floor(Date.now() / 1000) - 86400).first()).n}`, ''];
  if (!runs.results.length) lines.push('Щогодинних запусків ще не було');
  for (const r of runs.results) lines.push(`${hm(r.at)} — у вікні ${r.checked}, надіслано ${r.sent}${r.failed ? `, помилок ${r.failed}: ${r.err}` : ''}`);
  return lines.join('\n');
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
  try { const u = JSON.parse(p.get('user')); u.start = p.get('start_param') || ''; return u; } catch { return null; }
}
