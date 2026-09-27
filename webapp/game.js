(() => {
const W = 450, H = 800, TOP = 60, BOT = 676;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FD = 'Rubik,"Arial Black",system-ui,sans-serif';
const FB = 'Nunito,system-ui,sans-serif';
const TAU = Math.PI * 2;

// ---------- Telegram ----------
const TGW = window.Telegram && window.Telegram.WebApp;
const TG = TGW && TGW.initData ? TGW : null;
const tgv = v => !!(TG && TG.isVersionAtLeast && TG.isVersionAtLeast(v));
const TG_CLOUD = !!(TG && TG.CloudStorage && tgv('6.9'));
const TG_NAME = (TG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.first_name) || '';

let scale = 1, dpr = 1, T = 0;
function resize() {
  const b = document.body;
  const aw = Math.max(240, b.clientWidth - 32), ah = Math.max(320, b.clientHeight - 16);
  scale = Math.min(aw / W, ah / H);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = (W * scale) + 'px';
  cv.style.height = (H * scale) + 'px';
  cv.width = Math.round(W * scale * dpr);
  cv.height = Math.round(H * scale * dpr);
}
addEventListener('resize', resize);
resize();

if (TG) {
  try { TG.ready(); TG.expand(); } catch (e) {}
  try {
    if (tgv('6.1')) {
      TG.setHeaderColor('#15122a');
      TG.setBackgroundColor('#110e22');
      TG.BackButton.onClick(() => { if (SCREEN === 'game') goMap(); else if (SCREEN === 'howto') closeHowto(); else if (['lang', 'board', 'shop', 'prep', 'daily', 'heroes'].includes(SCREEN)) setScreen('map'); });
    }
    if (tgv('7.7')) TG.disableVerticalSwipes();
    TG.onEvent('viewportChanged', resize);
  } catch (e) {}
}

function haptic(kind) {
  try {
    if (TG && tgv('6.1')) {
      if (kind === 'success' || kind === 'error' || kind === 'warning') TG.HapticFeedback.notificationOccurred(kind);
      else TG.HapticFeedback.impactOccurred(kind);
    } else if (navigator.vibrate) {
      navigator.vibrate(kind === 'heavy' ? 30 : kind === 'error' ? [40, 40, 40] : kind === 'success' ? [20, 30, 20] : 10);
    }
  } catch (e) {}
}

// ---------- utils ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}
function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function rr(x, y, w, h, r, c = ctx) {
  c.beginPath();
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function star(x, y, r, fill, stroke, c = ctx) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .45 : r;
    c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  c.closePath();
  c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
}
function segX(p, p2, q, q2) {
  const rx = p2[0] - p[0], ry = p2[1] - p[1], sx = q2[0] - q[0], sy = q2[1] - q[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = q[0] - p[0], qy = q[1] - p[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? [p[0] + t * rx, p[1] + t * ry] : null;
}
function wrap(text, x, y, maxW, lh) {
  let line = '', yy = y;
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; }
    else line = t;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

// ---------- sound (synthesised, no files) ----------
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const Snd = {
  c: null, m: null, nb: null, dest: null, room: -1, on: lsGet('pawsling-sound') !== 'off', last: {},
  init() {
    if (this.c) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.c = new C();
      this.m = this.c.createGain(); this.m.gain.value = .5; this.m.connect(this.c.destination);
    } catch (e) { this.c = null; }
    if (this.c && SCREEN === 'game' && G) Amb.start(G.lvl.ch);
  },
  resume() { if (this.c && this.c.state === 'suspended') this.c.resume().catch(() => {}); },
  out() { return this.dest || this.m; },
  noiseBuf() {
    if (!this.nb) {
      const c = this.c;
      this.nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const a = this.nb.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    }
    return this.nb;
  },
  // cut: optional low-pass cutoff, used for softer brass and metal voices
  tone(f, d, type = 'sine', v = .2, to = null, delay = 0, cut = 0) {
    const c = this.c, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    if (cut) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; o.connect(fl); fl.connect(g); }
    else o.connect(g);
    g.connect(this.out());
    o.start(t); o.stop(t + d + .03);
  },
  noise(d, v = .2, f = 1000, to = null, delay = 0, type = 'bandpass') {
    const c = this.c, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf();
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t);
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d);
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + .02);
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(this.out());
    s.start(t); s.stop(t + d + .05);
  },
  play(name) {
    if (!this.c || !this.on || !SOUNDS[name]) return;
    const gap = GAPS[name] || 0, now = performance.now();
    if (gap && this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    try { SOUNDS[name](this); } catch (e) {}
  },
  // notes: [beat, midi note or null, length in beats, instrument, volume]
  seq(bpm, notes) {
    if (!this.c || !this.on) return;
    const b = 60 / bpm;
    try { for (const [at, n, len, ins, v = 1] of notes) INST[ins](this, n == null ? 0 : ins === 'clang' ? n : midi(n), len * b, at * b, v); } catch (e) {}
  },
  toggle() {
    this.on = !this.on; lsSet('pawsling-sound', this.on ? 'on' : 'off');
    if (this.on) { this.play('click'); if (SCREEN === 'game' && G) Amb.start(G.lvl.ch); }
    else Amb.stop();
  },
};
const GAPS = { wall: 50, hit: 40, crit: 40, snack: 60, armor: 60 };
const INST = {
  tri: (s, f, d, t, v) => s.tone(f, Math.max(.08, d * .9), 'triangle', .13 * v, null, t),
  sq: (s, f, d, t, v) => s.tone(f, Math.max(.06, d * .7), 'square', .035 * v, null, t, 2500),
  bass: (s, f, d, t, v) => s.tone(f, Math.max(.1, d * .85), 'triangle', .17 * v, null, t),
  brass: (s, f, d, t, v) => { s.tone(f, d * .95, 'sawtooth', .06 * v, null, t, 1700); s.tone(f * 1.004, d * .95, 'sawtooth', .035 * v, null, t, 1100); },
  bell: (s, f, d, t, v) => {
    s.tone(f, Math.max(.7, d * 2), 'sine', .1 * v, null, t);
    s.tone(f * 2, Math.max(.35, d), 'sine', .03 * v, null, t);
    s.tone(f * 3.01, .25, 'sine', .012 * v, null, t);
  },
  kick: (s, f, d, t, v) => s.tone(130, .14, 'sine', .3 * v, 45, t),
  snare: (s, f, d, t, v) => s.noise(.12, .11 * v, 1800, null, t, 'highpass'),
  hat: (s, f, d, t, v) => s.noise(.035, .05 * v, 8000, null, t, 'highpass'),
  crash: (s, f, d, t, v) => s.noise(1.3, .08 * v, 5000, 3000, t, 'highpass'),
  clang: (s, f, d, t, v) => { f = f || 1000; s.tone(f, .3, 'square', .022 * v, null, t, 3200); s.tone(f * 1.47, .25, 'square', .016 * v, null, t, 3200); },
};

// room-flavoured effects: pots in the kitchen, cushions and party horns in the living room, chimes at night
const ROOM_SFX = [
  { wall: s => { s.tone(900 + Math.random() * 300, .1, 'square', .02, null, 0, 3000); s.tone(1400 + Math.random() * 300, .08, 'square', .014, null, 0, 3000); },
    kill: s => [0, .05, .11].forEach(d => s.tone(350 + Math.random() * 150, .06, 'sine', .07, 1100, d)) },
  { wall: s => { s.tone(140, .09, 'sine', .12, 70); s.noise(.06, .05, 400, null, 0, 'lowpass'); },
    kill: s => { s.tone(330, .28, 'sawtooth', .05, 540, 0, 1400); s.noise(.25, .05, 6000, null, .02, 'highpass'); } },
  { wall: s => s.tone(880 + Math.random() * 220, .14, 'triangle', .045, 700),
    kill: s => [1568, 2093, 2637].forEach((f, i) => INST.bell(s, f, .3, i * .07, .8)) },
  { wall: s => s.tone(1300 + Math.random() * 500, .08, 'sine', .05, 800),
    kill: s => [0, .05, .1, .16].forEach(d => s.tone(500 + Math.random() * 300, .09, 'sine', .06, 1500, d)) },
  { wall: s => s.tone(320, .07, 'triangle', .07, 210),
    kill: s => [2093, 2349, 2794].forEach((f, i) => INST.bell(s, f, .25, i * .06, .6)) },
  { wall: s => { s.tone(110, .12, 'sine', .12, 60); s.noise(.08, .05, 300, null, 0, 'lowpass'); },
    kill: s => { s.noise(.35, .09, 900, 300, 0, 'lowpass'); s.tone(260, .2, 'triangle', .06, 520); } },
  { wall: s => { s.tone(620, .12, 'square', .025, null, 0, 2400); s.tone(930, .1, 'square', .018, null, 0, 2400); },
    kill: s => { INST.clang(s, 900, .3, 0, 1.2); s.noise(.25, .08, 2500, 800, 0, 'bandpass'); } },
  { wall: s => { s.tone(160, .1, 'sine', .1, 80); s.noise(.06, .05, 600, null, 0, 'lowpass'); },
    kill: s => { s.noise(.3, .08, 1200, 400, 0, 'lowpass'); s.tone(300, .15, 'triangle', .05, 150); } },
];
const SOUNDS = {
  click: s => s.tone(700, .05, 'triangle', .08),
  launch: s => { s.noise(.3, .25, 400, 2400); s.tone(260, .15, 'triangle', .12, 620); },
  wall: s => (ROOM_SFX[s.room] ? ROOM_SFX[s.room].wall(s) : s.tone(190, .05, 'square', .04)),
  hit: s => { s.tone(150, .14, 'sine', .35, 60); s.noise(.06, .15, 1800); },
  crit: s => { s.tone(150, .14, 'sine', .35, 60); s.tone(1200, .12, 'square', .07, 1600); },
  armor: s => s.tone(900, .08, 'square', .06, 700),
  kill: s => { s.tone(500, .18, 'triangle', .18, 1300); s.noise(.2, .2, 3000, 500); if (ROOM_SFX[s.room]) ROOM_SFX[s.room].kill(s); },
  knot: s => [880, 1320, 1760].forEach((f, i) => s.tone(f, .3, 'sine', .12, null, i * .05)),
  meow: s => { s.tone(420, .12, 'sawtooth', .06, 820); s.tone(820, .28, 'triangle', .1, 380, .1); },
  portal: s => s.tone(220, .28, 'sine', .18, 1400),
  snack: s => { s.tone(1000, .07, 'triangle', .1); s.tone(1500, .09, 'triangle', .1, null, .05); },
  combo: s => { s.tone(660, .1, 'triangle', .12); s.tone(990, .14, 'triangle', .12, null, .07); },
  heal: s => [523, 784].forEach((f, i) => s.tone(f, .2, 'sine', .12, null, i * .08)),
  attack: s => { s.tone(95, .45, 'sawtooth', .08, 70); s.noise(.45, .12, 500, 200, 0, 'lowpass'); },
  boss: s => { s.tone(60, .7, 'sawtooth', .12, 40); s.noise(.7, .18, 300, 120, 0, 'lowpass'); },
  zoom: s => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, .15, 'square', .06, null, i * .06)),
  lose: s => [392, 330, 262, 196].forEach((f, i) => s.tone(f, .35, 'triangle', .12, null, i * .16)),
  wave: s => { s.tone(440, .12, 'triangle', .1); s.tone(660, .18, 'triangle', .1, null, .1); },
  locked: s => s.tone(160, .12, 'square', .05),
  splat: s => { s.noise(.25, .2, 600, 200, 0, 'lowpass'); s.tone(180, .2, 'sine', .12, 90); },
  tvad: s => [72, 76, 79, 84].forEach((n, i) => s.tone(midi(n), .1, 'square', .05, null, i * .08, 2000)),
  bells: s => { for (let i = 0; i < 8; i++) s.tone(i % 2 ? 2350 : 2100, .08, 'square', .04, null, i * .06, 5000); },
  foam: s => { for (let i = 0; i < 5; i++) s.tone(600 + Math.random() * 900, .06, 'sine', .06, 1400, i * .04); },
  gust: s => s.noise(.7, .25, 500, 3000, 0, 'bandpass'),
  boo: s => { s.tone(300, .6, 'sine', .09, 180); s.tone(310, .6, 'triangle', .05, 190, .05); },
};

// Victory music. ROUND_TUNES play when a wave is cleared, WIN_TUNES when the level is won.
const ROUND_TUNES = [
  [180, [[0, 72, .5, 'tri'], [.5, 76, .5, 'tri'], [1, 79, .5, 'tri'], [1.5, 84, 1.5, 'tri'], [1.5, 1200, 0, 'clang'],
    [0, 48, 1, 'bass'], [1.5, 48, 1.5, 'bass'], [0, null, 0, 'hat'], [.5, null, 0, 'hat'], [1, null, 0, 'hat']]],
  [132, [[0, 67, .33, 'brass'], [.33, 67, .33, 'brass'], [.66, 67, .33, 'brass'], [1, 74, 1.5, 'brass'], [1, 71, 1.5, 'brass', .7],
    [1, 43, 1.5, 'bass'], [0, null, 0, 'snare', .6], [.33, null, 0, 'snare', .6], [.66, null, 0, 'snare', .8], [1, null, 0, 'crash']]],
  [96, [[0, 77, .25, 'bell'], [.25, 81, .25, 'bell'], [.5, 84, .25, 'bell'], [.75, 89, 1.5, 'bell'], [0, 53, 2, 'bass', .5]]],
];
function oompah(bars, roots, chords) {
  const out = [];
  for (let b = 0; b < bars; b++) for (let k = 0; k < 4; k++) {
    const at = b * 4 + k;
    if (k % 2 === 0) { out.push([at, roots[b], .9, 'bass'], [at, null, 0, 'kick', .7]); }
    else { for (const n of chords[b]) out.push([at, n, .5, 'sq']); out.push([at, null, 0, 'hat']); }
  }
  return out;
}
const WIN_TUNES = [
  // kitchen: a bouncy polka with pot clangs
  [168, [
    [0, 67, .5, 'tri'], [.5, 72, .5, 'tri'], [1, 76, .5, 'tri'], [1.5, 79, .5, 'tri'], [2, 76, .5, 'tri'], [2.5, 79, .5, 'tri'], [3, 81, 1, 'tri'],
    [4, 79, .5, 'tri'], [4.5, 77, .5, 'tri'], [5, 76, .5, 'tri'], [5.5, 74, .5, 'tri'], [6, 72, .5, 'tri'], [6.5, 76, .5, 'tri'], [7, 74, 1, 'tri'],
    [8, 72, .5, 'tri'], [8.5, 76, .5, 'tri'], [9, 79, .5, 'tri'], [9.5, 84, 2.5, 'tri'], [9.5, 79, 2.5, 'tri', .5],
    [9.5, 1100, 0, 'clang'], [10, 1500, 0, 'clang', .7], [9.5, null, 0, 'crash'], [9.5, 48, 2, 'bass'],
    ...oompah(2, [48, 43], [[64, 67], [65, 71]]), [8, 48, .9, 'bass'], [8, null, 0, 'kick'], [9, null, 0, 'hat'],
  ]],
  // living room: a brass fanfare with a snare roll and cymbal
  [126, [
    [0, 67, .5, 'brass'], [.5, 71, .5, 'brass'], [1, 74, .5, 'brass'], [1.5, 79, 1, 'brass'], [2.5, 78, .5, 'brass'], [3, 76, .5, 'brass'], [3.5, 78, .5, 'brass'],
    [4, 79, .5, 'brass'], [4.5, 81, .5, 'brass'], [5, 83, 2.5, 'brass'], [5, 79, 2.5, 'brass', .7], [5, 74, 2.5, 'brass', .6],
    [0, 43, 1.5, 'bass'], [1.5, 50, 1, 'bass'], [2.5, 48, 1, 'bass'], [3.5, 50, 1.5, 'bass'], [5, 43, 2.5, 'bass'],
    [0, null, 0, 'kick'], [1.5, null, 0, 'kick'], [2.5, null, 0, 'kick'], [3.5, null, 0, 'kick'], [5, null, 0, 'kick'],
    [1, null, 0, 'snare'], [2, null, 0, 'snare'], [3, null, 0, 'snare'],
    ...[4, 4.25, 4.5, 4.625, 4.75, 4.875].map(at => [at, null, 0, 'snare', .5 + (at - 4)]),
    [5, null, 0, 'crash', 1.2],
  ]],
  // bedroom: a music-box lullaby
  [100, [
    [0, 84, .5, 'bell'], [.5, 81, .5, 'bell'], [1, 77, 1, 'bell'], [2, 79, .5, 'bell'], [2.5, 81, .5, 'bell'], [3, 82, .5, 'bell'], [3.5, 81, .5, 'bell'],
    [4, 79, 1, 'bell'], [5, 84, .5, 'bell'], [5.5, 81, .5, 'bell'], [6, 89, 1.5, 'bell'],
    [7.5, 77, 2, 'bell', .8], [7.5, 81, 2, 'bell', .7], [7.5, 84, 2, 'bell', .7],
    [0, 53, 2, 'bass', .45], [2, 46, 2, 'bass', .45], [4, 48, 2, 'bass', .45], [6, 53, 3, 'bass', .45],
  ]],
];
const STAR_FLOURISH = [[0, 96, .25, 'bell', .5], [.25, 100, .25, 'bell', .5], [.5, 103, .25, 'bell', .5], [.75, 108, .8, 'bell', .6]];
function playRound(room) { const t = ROUND_TUNES[room % ROUND_TUNES.length]; Snd.seq(t[0], t[1]); }
function playWin(room, stars) {
  const t = WIN_TUNES[room % WIN_TUNES.length];
  Snd.seq(t[0], t[1]);
  if (stars === 3) { const end = Math.max(...t[1].map(n => n[0])) + 1.5; Snd.seq(t[0], STAR_FLOURISH.map(n => [n[0] + end, ...n.slice(1)])); }
}

// Room ambience: a quiet bed of filtered noise plus little scheduled events.
const Amb = {
  g: null, srcs: [], iv: null, next: 0, tick2: 0, room: -1,
  start(room) {
    const s = Snd;
    this.stop();
    this.room = room; s.room = room;
    if (!s.c || !s.on) return;
    const c = s.c, g = c.createGain();
    g.gain.setValueAtTime(.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.5);
    g.connect(s.m); this.g = g;
    const bed = (type, f, q, v) => {
      const src = c.createBufferSource(); src.buffer = s.noiseBuf(); src.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const gg = c.createGain(); gg.gain.value = v;
      src.connect(fl); fl.connect(gg); gg.connect(g); src.start(); this.srcs.push(src);
      return { fl, gg };
    };
    const lfo = (hz, depth, param) => {
      const o = c.createOscillator(), og = c.createGain(); o.frequency.value = hz; og.gain.value = depth;
      o.connect(og); og.connect(param); o.start(); this.srcs.push(o);
    };
    if (room === 0) { bed('lowpass', 180, .7, .05); const z = bed('bandpass', 3500, .8, .01); lfo(.3, .005, z.gg.gain); }
    else if (room === 1) {
      const tv = bed('bandpass', 1100, 3, .016); lfo(.7, 450, tv.fl.frequency); lfo(2.3, .006, tv.gg.gain);
      const hum = c.createOscillator(), hg = c.createGain(); hum.type = 'triangle'; hum.frequency.value = 120; hg.gain.value = .005;
      hum.connect(hg); hg.connect(g); hum.start(); this.srcs.push(hum);
    } else if (room === 2) { const w = bed('lowpass', 350, .5, .035); lfo(.12, .022, w.gg.gain); }
    else if (room === 3) { const w = bed('bandpass', 600, .8, .012); lfo(.2, .006, w.gg.gain); }
    else if (room === 4) { const w = bed('lowpass', 500, .5, .03); lfo(.09, .02, w.gg.gain); }
    else if (room === 5) { const w = bed('highpass', 3000, .5, .02); lfo(.3, .008, w.gg.gain); }
    else if (room === 7) { const w = bed('lowpass', 140, .8, .04); lfo(.07, .015, w.gg.gain); }
    else {
      bed('lowpass', 200, .7, .03);
      const hum = c.createOscillator(), hg = c.createGain(); hum.type = 'triangle'; hum.frequency.value = 100; hg.gain.value = .004;
      hum.connect(hg); hg.connect(g); hum.start(); this.srcs.push(hum);
    }
    this.next = c.currentTime + .6; this.tick2 = 0;
    this.iv = setInterval(() => this.tick(), 150);
  },
  tick() {
    const s = Snd, c = s.c;
    if (!c || !this.g || !s.on) return;
    s.dest = this.g;
    try {
      while (this.next < c.currentTime + .4) {
        const d = Math.max(0, this.next - c.currentTime), r = Math.random();
        if (this.room === 0) {
          if (r < .65) s.tone(250 + Math.random() * 200, .07, 'sine', .03, 600 + Math.random() * 300, d);
          else if (r < .95) s.noise(.025, .035, 4000 + Math.random() * 3000, null, d, 'highpass');
          else { s.tone(2400, .25, 'sine', .015, null, d); s.tone(3610, .2, 'sine', .01, null, d); }
          this.next += .35 + Math.random();
        } else if (this.room === 1) {
          s.tone(this.tick2++ % 2 ? 1500 : 1800, .03, 'square', .01, null, d, 4000);
          if (r < .06) [72, 76, 79].forEach((n, i) => s.tone(midi(n), .12, 'square', .008, null, d + .3 + i * .12, 1200));
          this.next += 1;
        } else if (this.room === 3) {
          s.tone(1100 + Math.random() * 700, .06, 'sine', .035, 650, d);
          if (r < .12) s.tone(70, .8, 'sine', .02, 60, d + .2);
          this.next += .6 + Math.random();
        } else if (this.room === 4) {
          if (r < .55) for (let k = 0; k < 3; k++) s.tone(4200 + Math.random() * 300, .03, 'sine', .01, null, d + k * .05);
          else INST.bell(s, midi([79, 81, 84, 86, 88][Math.floor(Math.random() * 5)]), .4, d, .15);
          this.next += .5 + Math.random() * 1.1;
        } else if (this.room === 5) {
          if (r < .5) s.tone(900 + Math.random() * 500, .04, 'sine', .02, 500, d);
          else if (r < .75) s.tone(180, .35, 'sawtooth', .012, 140, d, 700);
          this.next += .7 + Math.random() * 1.3;
        } else if (this.room === 7) {
          if (r < .6) s.tone(700 + Math.random() * 500, .05, 'sine', .03, 380, d);
          else if (r < .75) s.tone(90, .5, 'sawtooth', .01, 70, d, 500);
          this.next += .9 + Math.random() * 1.5;
        } else if (this.room === 6) {
          if (r < .4) s.tone(1500 + Math.random() * 900, .07, 'square', .008, null, d, 3000);
          else if (r < .6) s.tone(900 + Math.random() * 400, .05, 'sine', .02, 500, d);
          this.next += .8 + Math.random() * 1.4;
        } else {
          if (r < .6) for (let k = 0; k < 3; k++) s.tone(4400 + Math.random() * 200, .03, 'sine', .01, null, d + k * .06);
          else if (r < .85) INST.bell(s, midi([77, 79, 81, 84, 86, 89][Math.floor(Math.random() * 6)]), .5, d, .2);
          else if (r < .9) { s.tone(420, .35, 'sine', .025, 380, d); s.tone(400, .45, 'sine', .025, 350, d + .45); }
          this.next += .5 + Math.random() * 1.2;
        }
      }
    } catch (e) {}
    s.dest = null;
  },
  duck(v) { if (this.g && Snd.c) { const t = Snd.c.currentTime; this.g.gain.cancelScheduledValues(t); this.g.gain.setTargetAtTime(v, t, .3); } },
  stop() {
    clearInterval(this.iv); this.iv = null;
    const g = this.g, srcs = this.srcs;
    this.g = null; this.srcs = []; Snd.room = -1;
    if (!g) return;
    try { const t = Snd.c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(.0001, t, .15); } catch (e) {}
    setTimeout(() => { for (const x of srcs) try { x.stop(); } catch (e) {} try { g.disconnect(); } catch (e) {} }, 800);
  },
};
document.addEventListener('visibilitychange', () => {
  if (!Snd.c) return;
  if (document.hidden) Snd.c.suspend().catch(() => {}); else Snd.resume();
});

// ---------- data ----------
const HEROES = [
  { id: 'mochi', name: 'Мочі', kind: 'cat', type: 'bounce', fur: '#f29e4c', dark: '#b8621c', muzzle: '#ffdcb3', eye: '#3dd68c', yarn: '#ff9f43',
    dmg: 520, speed: 1350, r: 22, skill: '+15% шкоди за кожен відскок від стіни', combo: 'Хвиля мурчання' },
  { id: 'pixel', name: 'Піксель', kind: 'cat', type: 'pierce', fur: '#34304a', dark: '#1c1a2b', muzzle: '#4d4866', eye: '#ffd23f', yarn: '#b18cff',
    dmg: 460, speed: 1450, r: 21, skill: 'пролітає крізь ворогів наскрізь', combo: 'Лазерний погляд' },
  { id: 'bandit', name: 'Бандит', kind: 'raccoon', type: 'bounce', fur: '#9aa0ad', dark: '#33363f', muzzle: '#f1ece4', eye: '#ffffff', yarn: '#5ce1c6',
    dmg: 700, speed: 1150, r: 25, skill: 'кожен удар відкладає атаку ворога на хід', combo: 'Нічний перекус' },
  { id: 'nugget', name: 'Наґет', kind: 'raccoon', type: 'pierce', fur: '#b9a78f', dark: '#4a3f35', muzzle: '#f1ece4', eye: '#ffffff', yarn: '#ff8fb1',
    dmg: 380, speed: 1300, r: 23, skill: 'кожен удар вибухає по сусідніх ворогах', combo: 'Скарб зі смітника' },
  // bought in the shop; joins the team as a fifth hero
  { id: 'spark', name: 'Іскра', kind: 'cat', type: 'bounce', fur: '#f4f1ea', dark: '#c9c2b0', muzzle: '#ffffff', eye: '#4fc3f7', yarn: '#ffe14d',
    dmg: 480, speed: 1400, r: 22, skill: 'удар перескакує блискавкою на найближчого ворога', combo: 'Грозова хмара' },
  // a rescue dog (shop): heals every ally he touches
  { id: 'rex', name: 'Рекс', kind: 'dog', type: 'bounce', fur: '#c98b4f', dark: '#8a5a2e', muzzle: '#f3d9b8', eye: '#2a1a10', yarn: '#ff6b6b',
    dmg: 540, speed: 1250, r: 24, skill: 'зачеплені друзі отримують +1 серце', combo: 'Рятувальна місія' },
  // a hamster (free after level 24): the longer he rolls, the harder he hits
  { id: 'homa', name: 'Хома', kind: 'hamster', type: 'pierce', fur: '#f0b765', dark: '#c47f2e', muzzle: '#fff3dc', eye: '#1b1b22', yarn: '#ffb347',
    dmg: 360, speed: 1500, r: 20, skill: 'що довше котиться, то сильніше б\'є', combo: 'Горіховий дощ' },
];
const HOMA_UNLOCK = 24; // Hammy joins after this level is won
function heroOwned(id) {
  if (id === 'spark') return owns('hero_spark');
  if (id === 'rex') return owns('hero_rex');
  if (id === 'homa') return (PROG.stars[String(HOMA_UNLOCK)] || 0) > 0;
  return true;
}
// the team: 4-5 owned heroes the player picked, or the first five owned
function teamDefs() {
  const owned = HEROES.filter(d => heroOwned(d.id));
  let pick = (PROG.team || []).filter(id => owned.some(d => d.id === id));
  if (pick.length < 4) pick = owned.slice(0, 5).map(d => d.id);
  return owned.filter(d => pick.includes(d.id)).slice(0, 5);
}
const START = [[90, 612], [180, 632], [270, 632], [360, 612]];
const START5 = [[62, 612], [143, 632], [225, 642], [307, 632], [388, 612]];
const startPos = (i, n) => (n > 4 ? START5 : START)[i];
const ENEMY = {
  vac:   { r: 24, hp: 1600,  timer: 3, atk: 1250 },
  spray: { r: 22, hp: 1200,  timer: 2, atk: 900 },
  mop:   { r: 26, hp: 2200,  timer: 3, atk: 1600 },
  boss:  { r: 58, hp: 16000, timer: 3, atk: 2600 },
  brush: { r: 22, hp: 1400,  timer: 3, atk: 900 },   // heals enemies around it
  fan:   { r: 25, hp: 1800,  timer: 3, atk: 1100 },  // blows heroes away
  rc:    { r: 23, hp: 1500,  timer: 2, atk: 1000 },  // drives to a new spot every turn
  shield: { r: 24, hp: 1800, timer: 4, atk: 800 },   // enemies near it take a third of the damage
  split: { r: 27, hp: 2000,  timer: 3, atk: 1300 },  // breaks into two minis when destroyed
  mini:  { r: 16, hp: 700,   timer: 2, atk: 700 },
};
const HEAL_R = 150, FAN_R = 125, SHIELD_R = 140;
// Each chapter is a room with its own palette, particle shape and window light (A, B along the wall, D across the floor).
const CHAPTERS = [
  { name: 'Кухня', key: 'kitchen', col: '#ff9f43', hp: 1, atk: 1,
    hud: '#1d120c', line: '#5a3620', shade: 'rgba(22,12,8,.9)', fx: ['#ffd9a8', '#ff9f43', '#fff3e0', '#ffc857'], shape: 'bubble',
    beam: [[450, 190], [450, 330], [250, 300]], beamCol: '255,190,110' },
  { name: 'Вітальня', key: 'living', col: '#b18cff', hp: 1.25, atk: 1.15,
    hud: '#17122a', line: '#4a3775', shade: 'rgba(16,11,30,.9)', fx: ['#b18cff', '#ffd166', '#ff8fb1', '#5ce1c6'], shape: 'confetti',
    beam: [[300, 60], [430, 60], [160, 556]], beamCol: '255,230,190' },
  { name: 'Спальня', key: 'bedroom', col: '#5ce1c6', hp: 1.5, atk: 1.2,
    hud: '#0a161c', line: '#1f4a50', shade: 'rgba(6,16,22,.92)', fx: ['#5ce1c6', '#cfe8ff', '#ffe8a3', '#9fd8e0'], shape: 'star',
    beam: [[40, 60], [200, 60], [0, 470]], beamCol: '170,215,255' },
  { name: 'Ванна', key: 'bath', col: '#6ec3ff', hp: 1.8, atk: 1.35,
    hud: '#0b1622', line: '#24506e', shade: 'rgba(6,14,24,.92)', fx: ['#bfe6ff', '#6ec3ff', '#ffffff', '#9fe8ff'], shape: 'bubble',
    beam: [[20, 60], [130, 60], [60, 340]], beamCol: '200,235,255' },
  { name: 'Балкон', key: 'balcony', col: '#9ee06a', hp: 2.05, atk: 1.45,
    hud: '#0f1a10', line: '#3c5a2a', shade: 'rgba(8,16,8,.92)', fx: ['#9ee06a', '#ffd166', '#ff8fb1', '#e8ffd0'], shape: 'leaf',
    beam: [[250, 120], [450, 120], [150, 560]], beamCol: '210,225,255' },
  { name: 'Горище', key: 'attic', col: '#ffb070', hp: 2.3, atk: 1.55,
    hud: '#1a120c', line: '#5a3b24', shade: 'rgba(18,12,8,.92)', fx: ['#ffb070', '#e8d2b0', '#c9a27a', '#fff1d6'], shape: 'dust',
    beam: [[170, 60], [290, 60], [110, 470]], beamCol: '255,225,180' },
  { name: 'Гараж', key: 'garage', col: '#a9c1d9', hp: 2.7, atk: 1.7,
    hud: '#121317', line: '#4a4d57', shade: 'rgba(10,10,14,.92)', fx: ['#ffd166', '#c9d3dd', '#ff9f43', '#8a96a3'], shape: 'confetti',
    beam: [[300, 60], [440, 60], [200, 540]], beamCol: '230,240,255' },
  { name: 'Підвал', key: 'basement', col: '#8fd14f', hp: 3.1, atk: 1.9,
    hud: '#0e120c', line: '#3a4a2a', shade: 'rgba(8,10,6,.92)', fx: ['#8fd14f', '#c9d3dd', '#e8ecf2', '#6b7a5a'], shape: 'dust',
    beam: [[360, 60], [440, 60], [290, 330]], beamCol: '200,255,170' },
];
const LEVELS = [
  { ch: 0, par: 5, noBoxes: true, tip: 'Потягни від героя назад і відпусти',
    waves: [[['vac', 120, 230], ['vac', 330, 230]]] },
  { ch: 0, par: 6, tip: 'Перетни стару нитку, і вузол вибухне',
    waves: [[['vac', 110, 210], ['vac', 340, 210], ['vac', 225, 380]]] },
  { ch: 0, par: 10, tip: 'Коти женуться за червоною лазерною точкою',
    waves: [[['vac', 90, 180], ['vac', 225, 160], ['vac', 360, 180]], [['spray', 120, 250], ['spray', 330, 250], ['vac', 225, 400]]] },
  { ch: 0, par: 12, boss: .6, tip: 'Бий у жовтий сенсор: потрійна шкода',
    waves: [[['vac', 110, 300], ['vac', 340, 300]], [['boss', 225, 250]]] },
  { ch: 1, par: 7, tip: 'Швабри в броні: Піксель і Наґет б\'ють їх удвічі сильніше',
    waves: [[['mop', 225, 200], ['vac', 100, 330], ['vac', 350, 330]]] },
  { ch: 1, par: 12,
    waves: [[['spray', 90, 160], ['vac', 225, 250], ['spray', 360, 160], ['vac', 225, 440]], [['mop', 120, 200], ['mop', 330, 200], ['spray', 225, 360]]] },
  { ch: 1, par: 13,
    waves: [[['vac', 70, 150], ['vac', 380, 150], ['mop', 225, 300], ['vac', 70, 450], ['vac', 380, 450]], [['spray', 225, 150], ['mop', 100, 330], ['mop', 350, 330], ['spray', 225, 480]]] },
  { ch: 1, par: 15, boss: .75,
    waves: [[['mop', 110, 280], ['spray', 225, 180], ['mop', 340, 280]], [['boss', 225, 250], ['vac', 85, 430], ['vac', 365, 430]]] },
  { ch: 2, par: 8,
    waves: [[['vac', 80, 170], ['spray', 225, 140], ['vac', 370, 170], ['spray', 120, 380], ['spray', 330, 380]]] },
  { ch: 2, par: 13,
    waves: [[['mop', 150, 200], ['mop', 300, 200], ['vac', 225, 340]], [['spray', 70, 140], ['spray', 380, 140], ['vac', 150, 300], ['vac', 300, 300], ['mop', 225, 450]]] },
  { ch: 2, par: 18,
    waves: [[['vac', 100, 200], ['vac', 225, 300], ['vac', 350, 200]], [['mop', 90, 160], ['spray', 225, 220], ['mop', 360, 160], ['spray', 225, 420]], [['mop', 120, 260], ['mop', 330, 260], ['vac', 80, 440], ['vac', 370, 440], ['spray', 225, 150]]] },
  { ch: 2, par: 22, boss: .85,
    waves: [[['spray', 100, 180], ['vac', 225, 260], ['spray', 350, 180]], [['mop', 100, 300], ['mop', 350, 300], ['vac', 225, 170]], [['boss', 225, 240], ['mop', 85, 440], ['mop', 365, 440]]] },
  // bathroom: toothbrushes heal their friends
  { ch: 3, par: 7, tip: 'Зубні щітки лікують ворогів поруч, бий їх першими',
    waves: [[['brush', 225, 180], ['vac', 110, 300], ['vac', 340, 300]]] },
  { ch: 3, par: 12,
    waves: [[['vac', 90, 170], ['brush', 225, 250], ['vac', 360, 170], ['spray', 225, 420]], [['mop', 120, 220], ['brush', 225, 330], ['mop', 330, 220]]] },
  { ch: 3, par: 9,
    waves: [[['spray', 80, 150], ['spray', 370, 150], ['brush', 225, 200], ['vac', 120, 380], ['vac', 330, 380]]] },
  { ch: 3, par: 14,
    waves: [[['brush', 100, 200], ['brush', 350, 200], ['mop', 225, 300]], [['spray', 70, 160], ['vac', 225, 180], ['spray', 380, 160], ['brush', 150, 400], ['brush', 300, 400]]] },
  { ch: 3, par: 19,
    waves: [[['vac', 110, 200], ['vac', 340, 200], ['vac', 225, 380]], [['mop', 90, 250], ['brush', 225, 200], ['mop', 360, 250], ['spray', 225, 430]], [['brush', 120, 180], ['mop', 225, 300], ['brush', 330, 180], ['vac', 90, 450], ['vac', 360, 450]]] },
  { ch: 3, par: 16, boss: .8,
    waves: [[['brush', 110, 300], ['spray', 225, 180], ['brush', 340, 300]], [['boss', 225, 250], ['brush', 85, 440], ['brush', 365, 440]]] },
  // balcony: fans blow heroes off course
  { ch: 4, par: 7, tip: 'Вентилятори здувають героїв убік, цілься з запасом',
    waves: [[['fan', 225, 250], ['vac', 110, 380], ['vac', 340, 380]]] },
  { ch: 4, par: 12,
    waves: [[['fan', 110, 200], ['spray', 225, 150], ['fan', 340, 200], ['vac', 225, 420]], [['mop', 225, 220], ['fan', 90, 380], ['fan', 360, 380]]] },
  { ch: 4, par: 9,
    waves: [[['fan', 225, 330], ['spray', 80, 160], ['spray', 370, 160], ['brush', 225, 160], ['vac', 225, 480]]] },
  { ch: 4, par: 14,
    waves: [[['fan', 100, 180], ['mop', 225, 250], ['fan', 350, 180]], [['brush', 150, 200], ['brush', 300, 200], ['fan', 225, 380], ['spray', 80, 440], ['spray', 370, 440]]] },
  { ch: 4, par: 19,
    waves: [[['vac', 90, 170], ['fan', 225, 220], ['vac', 360, 170]], [['mop', 110, 300], ['fan', 225, 160], ['mop', 340, 300], ['brush', 225, 440]], [['fan', 90, 200], ['fan', 360, 200], ['mop', 225, 330], ['spray', 120, 460], ['spray', 330, 460]]] },
  { ch: 4, par: 16, boss: .85,
    waves: [[['fan', 110, 300], ['mop', 225, 180], ['fan', 340, 300]], [['boss', 225, 240], ['fan', 85, 440], ['fan', 365, 440]]] },
  // attic: RC cars drive around between turns
  { ch: 5, par: 7, tip: 'Радіомашинки щоходу переїжджають на нове місце',
    waves: [[['rc', 225, 220], ['vac', 110, 360], ['vac', 340, 360]]] },
  { ch: 5, par: 12,
    waves: [[['rc', 110, 180], ['rc', 340, 180], ['spray', 225, 300]], [['mop', 120, 230], ['rc', 225, 380], ['mop', 330, 230], ['brush', 225, 150]]] },
  { ch: 5, par: 10,
    waves: [[['rc', 90, 160], ['fan', 225, 250], ['rc', 360, 160], ['spray', 150, 420], ['spray', 300, 420]]] },
  { ch: 5, par: 14,
    waves: [[['rc', 225, 170], ['brush', 100, 280], ['brush', 350, 280]], [['fan', 110, 200], ['rc', 225, 300], ['fan', 340, 200], ['mop', 225, 460]]] },
  { ch: 5, par: 20,
    waves: [[['rc', 100, 200], ['rc', 225, 300], ['rc', 350, 200]], [['mop', 90, 170], ['brush', 225, 220], ['mop', 360, 170], ['fan', 225, 420]], [['rc', 80, 180], ['rc', 370, 180], ['mop', 225, 260], ['brush', 120, 430], ['fan', 330, 430]]] },
  { ch: 5, par: 24, boss: .85,
    waves: [[['rc', 110, 200], ['brush', 225, 300], ['rc', 340, 200]], [['fan', 100, 300], ['mop', 225, 200], ['fan', 350, 300]], [['boss', 225, 240], ['rc', 85, 440], ['rc', 365, 440]]] },
  // garage: shield bots protect their neighbors, twins split in two
  { ch: 6, par: 8, tip: 'shield',
    waves: [[['shield', 225, 200], ['vac', 120, 280], ['vac', 330, 280], ['spray', 225, 400]]] },
  { ch: 6, par: 13, tip: 'split',
    waves: [[['split', 150, 220], ['split', 300, 220], ['spray', 225, 380]], [['shield', 225, 170], ['mop', 110, 280], ['mop', 340, 280], ['split', 225, 420]]] },
  { ch: 6, par: 10,
    waves: [[['shield', 110, 190], ['shield', 340, 190], ['split', 225, 260], ['vac', 90, 420], ['vac', 360, 420]]] },
  { ch: 6, par: 15,
    waves: [[['fan', 225, 300], ['split', 110, 190], ['split', 340, 190]], [['shield', 225, 210], ['brush', 110, 330], ['brush', 340, 330], ['rc', 225, 450]]] },
  { ch: 6, par: 21,
    waves: [[['split', 100, 200], ['split', 225, 300], ['split', 350, 200]], [['shield', 90, 170], ['mop', 225, 230], ['shield', 360, 170], ['fan', 225, 420]], [['shield', 225, 170], ['split', 100, 300], ['split', 350, 300], ['brush', 225, 430], ['rc', 90, 460]]] },
  { ch: 6, par: 25, boss: .62,
    waves: [[['shield', 110, 300], ['split', 225, 180], ['shield', 340, 300]], [['split', 100, 220], ['fan', 225, 330], ['split', 350, 220]], [['boss', 225, 240], ['shield', 120, 380], ['shield', 330, 380]]] },
  // basement: every enemy type at once, and the web-spinning spider boss
  { ch: 7, par: 9, tip: 'basement',
    waves: [[['shield', 225, 170], ['split', 110, 260], ['split', 340, 260], ['brush', 225, 380]]] },
  { ch: 7, par: 14,
    waves: [[['rc', 100, 180], ['rc', 350, 180], ['fan', 225, 300]], [['shield', 120, 200], ['shield', 330, 200], ['mop', 225, 300], ['spray', 225, 450]]] },
  { ch: 7, par: 11,
    waves: [[['split', 90, 170], ['brush', 225, 220], ['split', 360, 170], ['fan', 110, 420], ['fan', 340, 420]]] },
  { ch: 7, par: 16,
    waves: [[['mop', 225, 160], ['shield', 110, 260], ['shield', 340, 260]], [['rc', 225, 200], ['split', 100, 330], ['split', 350, 330], ['brush', 225, 460]]] },
  { ch: 7, par: 22,
    waves: [[['vac', 90, 160], ['spray', 225, 200], ['vac', 360, 160], ['mop', 225, 340]], [['shield', 225, 180], ['fan', 90, 320], ['fan', 360, 320], ['split', 225, 440]], [['rc', 100, 200], ['rc', 350, 200], ['shield', 225, 300], ['brush', 120, 450], ['mop', 330, 450]]] },
  { ch: 7, par: 26, boss: .6, tip: 'web',
    waves: [[['shield', 110, 300], ['brush', 225, 180], ['shield', 340, 300]], [['split', 100, 220], ['rc', 225, 330], ['split', 350, 220]], [['boss', 225, 240], ['split', 110, 420], ['split', 340, 420]]] },
];
const BOXSETS = [[[55, 470], [395, 120]], [[60, 130], [390, 470]], [[50, 560], [400, 560]], [[395, 470], [55, 120]], [[40, 330], [410, 330]]];
const BTN = { x: 276, y: 688, w: 158, h: 50 };

// ---------- languages ----------
// Language: the player's choice, else Telegram's language_code, else the browser's, else English.
const LANGS = { uk: 'Українська', en: 'English', pl: 'Polski', de: 'Deutsch', es: 'Español' };
// what "Automatic" picks: Telegram's interface language, then the device's languages
function autoLang() {
  const tgCode = TG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.language_code;
  for (const c of [tgCode, ...(navigator.languages || [navigator.language])]) {
    const k = (c || '').toLowerCase().slice(0, 2);
    if (LANGS[k]) return k;
  }
  return 'en';
}
function detectLang() {
  const saved = lsGet('pawsling-lang');
  return saved && LANGS[saved] ? saved : autoLang();
}
let LANG = detectLang();
const one = (n, a, b) => (n === 1 ? a : b);
const I18N = {
  uk: {
    'hero.mochi.name': 'Мочі', 'hero.mochi.skill': '+15% шкоди за кожен відскок від стіни', 'hero.mochi.combo': 'Хвиля мурчання',
    'hero.pixel.name': 'Піксель', 'hero.pixel.skill': 'пролітає крізь ворогів наскрізь', 'hero.pixel.combo': 'Лазерний погляд',
    'hero.bandit.name': 'Бандит', 'hero.bandit.skill': 'кожен удар відкладає атаку ворога на хід', 'hero.bandit.combo': 'Нічний перекус',
    'hero.nugget.name': 'Наґет', 'hero.nugget.skill': 'кожен удар вибухає по сусідніх ворогах', 'hero.nugget.combo': 'Скарб зі смітника',
    'room.kitchen': 'Кухня', 'room.living': 'Вітальня', 'room.bedroom': 'Спальня', 'room.bath': 'Ванна', 'room.balcony': 'Балкон', 'room.attic': 'Горище', 'room.garage': 'Гараж', 'room.basement': 'Підвал', 'tip.basement': 'Підвал: усі вороги разом, і вони міцніші, ніж будь-коли', 'tip.web': 'Павук обплутує героїв: зачепи обплутаного друга пострілом, щоб звільнити', webStuck: 'У павутині!', webFreed: 'Звільнили!',
    'tip.shield': 'Щитоботи захищають сусідів: спершу збий щитобота', 'tip.split': 'Двійнята після знищення розпадаються на двох малюків', shielded: 'щит', 'cry.shield': 'Дзинь!', 'cry.split': 'Бульк!', 'cry.mini': 'Пі-пі!',
    'tip.0': 'Потягни від героя назад і відпусти', 'tip.1': 'Перетни стару нитку, і вузол вибухне', 'tip.2': 'Коти женуться за червоною лазерною точкою',
    'tip.3': 'Бий у жовтий сенсор: потрійна шкода', 'tip.4': 'Швабри в броні: Піксель і Наґет б\'ють їх удвічі сильніше',
    'tip.12': 'Зубні щітки лікують ворогів поруч, бий їх першими', 'tip.18': 'Вентилятори здувають героїв убік, цілься з запасом',
    'tip.24': 'Радіомашинки щоходу переїжджають на нове місце',
    woke: 'Прокинувся!', revived: 'Підняли!', waves: n => `${n} ${plural(n, 'хвиля', 'хвилі', 'хвиль')}`,
    newRoom: r => `Нова кімната: ${r}`, record: v => `Рекорд: ${v}`, waveOf: (a, b) => `Хвиля ${a} з ${b}`,
    night: 'Нічна зміна', nightWave: n => `Нічна зміна · хвиля ${n}`, levelRoom: (n, r) => `Рівень ${n} · ${r}`,
    zoomies: 'ТИГИДИК!', armor: 'броня', crit: 'КРИТ!', plusTurn: '+1 хід', plusMischief: v => `+${v} бешкету`, knot: 'Вузол!', caught: 'Спіймав!',
    whoosh: 'Шусть!', whooshFast: 'Шусть! +швидкість', vroom: 'Вррум!',
    'cry.boss': 'ТУРБО-ВСМОКТУВАННЯ!', 'cry.spray': 'Пшшш!', 'cry.mop': 'Шльоп!', 'cry.vac': 'Вжжжух!', 'cry.brush': 'Дзззз!', 'cry.fan': 'Фшшух!', 'cry.rc': 'Бі-біп!',
    ko: 'Нокаут!', koHint: 'Зачепи друга пострілом, щоб підняти', waveClear: 'Хвилю зачищено!', waveClearSub: h => `+${h} до міцності квартири і +1 ♥ кожному`,
    'tag.bounce': ['ВІДСКОК', 'відбивається від ворогів'], 'tag.pierce': ['ПРОШИВАННЯ', 'пролітає ворогів наскрізь'],
    bossTitles: [['Гроза крихт', 'Жодної крихти на підлозі!'], ['Володар пульта', 'Цей диван тепер мій!'], ['Нічний жах', 'Час спати... назавжди!'],
      ['Мильний барон', 'Змию вас у каналізацію!'], ['Буревій', 'Вас здує з балкона!'], ['Горищний привид', 'Тут ніхто не живе... крім мене!'],
      ['Залізний механік', 'Розберу вас на гвинтики!'], ['Підвальний прядильник', 'Ніхто не вийде з мого підвалу!']],
    bossNames: ['БЛЕНДЕР «МЕГАМІКС»', 'ТЕЛЕБОС 3000', 'БУДИЛЬНИК-ДЗВОНАР', 'ПРАЛЬКА «БАРАБАН»', 'ПОВІТРОДУВ «ШКВАЛ»', 'ПИЛОСОС-ПРИВИД', 'РОБО-БОС 9000', 'ПАВУК «ТЕНЕТА»'],
    bossSkills: [['Смузі-калюжі', 'Після атаки лишає липку калюжу: герої в ній гальмують'], ['Реклама', 'Кожна атака викликає міні-пилосос (до двох одразу)'],
      ['Дзвін', 'Б\'є всіх героїв на ногах одразу, по 1 ♥ кожному'], ['Мильна піна', 'Піна повністю гасить перший удар. Після атаки відростає'],
      ['Шквал', 'Атака відкидає всіх героїв подалі від нього'], ['Хованки', 'Після атаки зникає й з\'являється в іншому місці'],
      ['Друга фаза', 'На половині міцності лагодить себе й атакує частіше'], ['Павутина', 'Обплутує героя, якого вдарив: той пропускає хід, якщо друг не звільнить його пострілом']],
    bossCries: ['ВЖИК-ВЖИК!', 'НЕ ПЕРЕМИКАЙТЕ!', 'ДЗЕЛЕНЬ-ДЗЕЛЕНЬ!', 'ВІДЖИМ!', 'ФУУУХ!', 'У-у-у-у!', 'ТУРБО-ВСМОКТУВАННЯ!', 'ТКУ-ТКУ-ТКУ!'],
    bossFx: ['Липко!', 'Реклама!', 'Дзвін!', 'Піна!', 'Шквал!', 'Бу!', 'Друга фаза!', 'Павутина!'], skillLabel: 'Уміння',
    bossWarn: 'УВАГА · БОС НАБЛИЖАЄТЬСЯ', bossName: 'РОБО-БОС 9000', 'stat.hp': 'Міцність', 'stat.atk': 'Удар', 'stat.every': 'Атакує',
    'stat.everyN': n => `кожні ${n} ходи`, bossHint: 'Бий у жовтий сенсор: потрійна шкода', tapToStart: 'Торкнись, щоб почати',
    turn: n => `Хід ${n}`, hudWave: n => ` · хвиля ${n}`, pullHint: 'Тягни від героя назад і відпускай', par3: n => `3 зірки: пройти за ${n} ходів або швидше`,
    koCount: n => `нокаут · ${n}`, zoomReady: 'готово · стріляй', zoomTap: 'торкнись: x2 сила', mischief: 'Бешкет',
    homeHp: (a, b) => `Міцність квартири ${a} / ${b}`, typeBounce: 'відскок', typePierce: 'прошивання',
    features: [['Клубки', 'Кожен герой лишає нитку. Перетни стару нитку, і вузол вибухне по ворогах поруч. До 2 вузлів за постріл.'],
      ['Лазерна указка', 'Коти звертають до червоної точки. Спіймали — прискорення і бешкет.'], ['Коробки', 'Залетів у коробку A — вилетів з коробки B.'],
      ['Бешкет → Тигидик', 'Збирай рибу й піцу. Повна шкала дає постріл з подвійною силою.'], ['Єноти', 'Бандит відкладає атаки ворогів, Наґет влаштовує сміттєві вибухи.']],
    tagline: 'Коти та єноти проти повстання пилососів',
    howtoIntro: 'Тягни від героя назад і відпускай, як рогатку. Цифра над ворогом — скільки ходів до його атаки.',
    play: 'Грати', hello: n => `Привіт, ${n}! Обери рівень`, pickLevel: 'Обери рівень', chStars: (a, b) => `${a} / ${b} зірок`, boss: 'БОС',
    howto: 'Як грати', nightAfter: 'Нічна зміна · після 4 рівня', levelDone: n => `Рівень ${n} пройдено!`, shiftOver: 'Зміну завершено',
    vacWon: 'Пилососи перемогли', winSub: (t, p) => `${t} ходів · для 3 зірок треба ${p}`, survived: w => `Протрималися: ${w}`,
    allKo: 'Усі герої в нокауті. Спробуй ще раз', waveTry: (a, b) => `Хвиля ${a} з ${b}. Спробуй ще раз`,
    'st.knots': 'Вузлів зав\'язано', 'st.lasers': 'Лазер спіймано', 'st.crits': 'Критів по сенсору', 'st.portals': 'Телепортів',
    newBestLevel: 'Новий рекорд для цього рівня!', newBestNight: 'Новий рекорд нічної зміни!', again: 'Ще раз', map: 'Карта', next: 'Далі',
    toMap: 'До карти', allDone: 'Квартиру врятовано! Усі рівні пройдено', lang: 'Мова',
    'ev.halloween': 'Хелловін', 'ev.newyear': 'Новий рік', evSub: (d, n) => `Подія: ${d}/${n} рівнів · нагорода — капелюх`, evLevel: (e, n) => `${e} · ${n}/3`,
    evDone: 'Рівень події пройдено!', evHat: 'Новий капелюх для команди!',
    'item.hat_pumpkin': 'Гарбузовий капелюх', 'itemd.hat_pumpkin': 'Нагорода Хелловіну', 'item.hat_santa': 'Новорічна шапка', 'itemd.hat_santa': 'Нагорода Нового року',
    'hero.rex.name': 'Рекс', 'hero.rex.skill': 'зачеплені друзі отримують +1 серце', 'hero.rex.combo': 'Рятувальна місія',
    'hero.homa.name': 'Хома', 'hero.homa.skill': 'що довше котиться, то сильніше б\'є', 'hero.homa.combo': 'Горіховий дощ',
    'perk.rex.5': 'Дає +2 серця замість +1', 'perk.rex.10': 'Комбо ще й лікує квартиру на 800', 'perk.homa.5': 'Множник до ×3', 'perk.homa.10': '+20% швидкості',
    'item.hero_rex': 'Рекс', 'itemd.hero_rex': 'Лікує друзів, яких зачепить',
    inShop: 'Є в магазині', afterLvl: n => `Відкриється після рівня ${n}`, teamAdd: 'Додати', teamRule: 'У команді 4–5 героїв',
    heroes: 'Герої', lvl: n => `Рів. ${n}`, xpOf: (a, b) => `${a} / ${b} досвіду`, maxLvl: 'Максимальний рівень', perAll: 'Кожен рівень героя: +4% шкоди', xpGain: n => `+${n} досвіду кожному герою`, lvlUp: s => `новий рівень: ${s}`, 'knot.fire': 'Вогняний вузол!', 'knot.purr': 'Мурчальний вузол!', 'knot.trash': 'Сміттєвий вузол!', hardName: 'Випробування', hardDesc: n => `Вороги +40% міцності, лише ${n} ходів. Подвійний досвід і корона`, hardLeft: n => `Випробування: лишилось ${n} ходів`, hardTurns: 'Ходи скінчились. Спробуй ще раз', hardDone: n => `Випробування ${n} пройдено!`, 'perk.mochi.5': '+20% за кожен відскок', 'perk.mochi.10': '+25% за кожен відскок', 'perk.pixel.5': '+15% шкоди, пролітаючи наскрізь', 'perk.pixel.10': 'Лазерний погляд: 800 шкоди', 'perk.bandit.5': 'Нічний перекус лікує на 700', 'perk.bandit.10': 'Удар відкладає атаку на 2 ходи', 'perk.nugget.5': 'Більший радіус вибуху', 'perk.nugget.10': 'Вибухи б\'ють на 320', 'perk.spark.5': 'Блискавка б\'є на 70%', 'perk.spark.10': 'Блискавка б\'є двох ворогів',
    daily: 'Щодня', dailyBonus: 'Бонус за вхід', streak: n => `Серія: ${n} дн.`, dayShort: n => `Д${n}`, challenge: 'Завдання дня', 'ch.knots': n => `Пройди рівень і зав'яжи ${n} вузли`, 'ch.lasers': n => `Пройди рівень і спіймай лазер ${n} рази`, 'ch.noko': () => 'Пройди рівень без жодного нокауту', 'ch.par': n => `Пройди рівень за ${n} ходів або швидше`, 'ch.portals': n => `Пройди рівень і пролети крізь коробки ${n} рази`, reward: 'Нагорода', chDone: 'Виконано ✓', chWon: r => `Завдання дня виконано! +1 ${r}`, invite: 'Запроси друга', inviteDesc: 'Коли друг зайде в гру за твоїм посиланням, ви обидва отримаєте +1 серце і +1 швидкий старт', invited: n => `Запрошено: ${n}`, inviteBtn: 'Запросити', inviteText: 'Коти та єноти проти роботів-пилососів! Зіграй зі мною в Pawsling 🐾', giftedMsg: 'Тебе запросив друг: +1 серце і +1 швидкий старт!', dailyTgOnly: 'Бонуси й нагороди працюють, коли гра відкрита в Telegram', boardWeek: 'Тиждень', weekLeft: (d, h) => `До кінця: ${d} д ${h} год`, weekPrizes: 'топ-3 отримають призи в понеділок',
    shop: 'Магазин',
    shopTgOnly: 'Магазин працює, коли гра відкрита в Telegram',
    equip: 'Вдягнути',
    unequip: 'Зняти',
    inTeam: 'У команді',
    startLvl: 'Почати',
    cancel: 'Скасувати',
    boosters: 'Підсилення на цей рівень',
    boostHeart: 'Серце+',
    boostHeartD: '+1 серце кожному героєві',
    boostMeter: 'Швидкий старт',
    boostMeterD: 'Пів шкали «Бешкету» одразу',
    owned: n => `у вас: ${n}`,
    'item.heart3': 'Серце+ ×3', 'itemd.heart3': '+1 серце кожному героєві, 3 рівні',
    'item.meter3': 'Швидкий старт ×3', 'itemd.meter3': 'Пів шкали «Бешкету» на старті, 3 рівні',
    'item.hero_spark': 'Іскра', 'itemd.hero_spark': 'Удар перескакує блискавкою на сусіда',
    'item.hat_party': 'Святковий ковпак', 'itemd.hat_party': 'Для всієї команди',
    'item.hat_crown': 'Корона', 'itemd.hat_crown': 'Для всієї команди',
    'item.hat_bow': 'Бантик', 'itemd.hat_bow': 'Для всієї команди',
    'item.rainbow': 'Райдужна нитка', 'itemd.rainbow': 'Нитки переливаються веселкою',
    'hero.spark.name': 'Іскра', 'hero.spark.skill': 'удар перескакує блискавкою на найближчого ворога', 'hero.spark.combo': 'Грозова хмара', secondWind: 'Друге дихання', secondWindSub: 'Повна міцність і всі герої на ногах', secondWindGo: 'Друге дихання!', payWait: 'Відкриваю оплату…', payFailed: 'Оплата не пройшла. Спробуй ще раз', langAuto: 'Автоматично',
    aria: 'Гра Pawsling. Потягни від героя назад і відпусти, щоб запустити його, як з рогатки.',
    board: 'Рейтинг', boardNight: 'Нічна зміна', boardStars: 'Зірки', boardYou: 'ти', boardEmpty: 'Поки що нікого. Будь першим!',
    boardLoading: 'Завантаження…', boardError: 'Не вдалося завантажити рейтинг. Перевір інтернет і спробуй ще.',
    boardTgOnly: 'Рейтинг працює, коли гра відкрита в Telegram.', boardRetry: 'Оновити', boardPlayer: 'Гравець',
  },
  en: {
    'hero.mochi.name': 'Mochi', 'hero.mochi.skill': '+15% damage for every wall bounce', 'hero.mochi.combo': 'Purr Wave',
    'hero.pixel.name': 'Pixel', 'hero.pixel.skill': 'flies straight through enemies', 'hero.pixel.combo': 'Laser Stare',
    'hero.bandit.name': 'Bandit', 'hero.bandit.skill': 'each hit delays the enemy attack by a turn', 'hero.bandit.combo': 'Midnight Snack',
    'hero.nugget.name': 'Nugget', 'hero.nugget.skill': 'each hit blasts nearby enemies', 'hero.nugget.combo': 'Trash Treasure',
    'room.kitchen': 'Kitchen', 'room.living': 'Living room', 'room.bedroom': 'Bedroom', 'room.bath': 'Bathroom', 'room.balcony': 'Balcony', 'room.attic': 'Attic', 'room.garage': 'Garage', 'room.basement': 'Basement', 'tip.basement': 'Basement: every enemy type at once, and tougher than ever', 'tip.web': 'The spider webs heroes: hit a webbed friend with a shot to free them', webStuck: 'Stuck in a web!', webFreed: 'Freed!',
    'tip.shield': 'Shield bots protect their neighbors: take the shield bot out first', 'tip.split': 'Twins split into two little ones when destroyed', shielded: 'shield', 'cry.shield': 'Clang!', 'cry.split': 'Blorp!', 'cry.mini': 'Meep!',
    'tip.0': 'Pull back from a hero and let go', 'tip.1': 'Cross an old thread and the knot explodes', 'tip.2': 'Cats chase the red laser dot',
    'tip.3': 'Hit the yellow sensor: triple damage', 'tip.4': 'Mops are armored: Pixel and Nugget hit them twice as hard',
    'tip.12': 'Toothbrushes heal nearby enemies, hit them first', 'tip.18': 'Fans blow heroes aside, aim with a margin',
    'tip.24': 'RC cars drive to a new spot every turn',
    woke: 'Awake!', revived: 'Back up!', waves: n => `${n} ${one(n, 'wave', 'waves')}`,
    newRoom: r => `New room: ${r}`, record: v => `Record: ${v}`, waveOf: (a, b) => `Wave ${a} of ${b}`,
    night: 'Night Shift', nightWave: n => `Night Shift · wave ${n}`, levelRoom: (n, r) => `Level ${n} · ${r}`,
    zoomies: 'ZOOMIES!', armor: 'armor', crit: 'CRIT!', plusTurn: '+1 turn', plusMischief: v => `+${v} mischief`, knot: 'Knot!', caught: 'Caught it!',
    whoosh: 'Whoosh!', whooshFast: 'Whoosh! +speed', vroom: 'Vroom!',
    'cry.boss': 'TURBO SUCK!', 'cry.spray': 'Pssst!', 'cry.mop': 'Splat!', 'cry.vac': 'Vrrrm!', 'cry.brush': 'Bzzzz!', 'cry.fan': 'Fwoosh!', 'cry.rc': 'Beep-beep!',
    ko: 'Knocked out!', koHint: 'Hit a friend with a shot to revive them', waveClear: 'Wave cleared!', waveClearSub: h => `+${h} home strength and +1 ♥ each`,
    'tag.bounce': ['BOUNCE', 'rebounds off enemies'], 'tag.pierce': ['PIERCE', 'flies through enemies'],
    bossTitles: [['Crumb Terror', 'Not a single crumb on the floor!'], ['Remote Overlord', 'This couch is mine now!'], ['Night Terror', 'Time to sleep... forever!'],
      ['Soap Baron', 'Down the drain you go!'], ['Stormbringer', 'I\'ll blow you off the balcony!'], ['Attic Phantom', 'Nobody lives up here... but me!'],
      ['Iron Mechanic', 'I\'ll take you apart, bolt by bolt!'], ['Cellar Spinner', 'Nobody leaves my basement!']],
    bossNames: ['MEGAMIX BLENDER', 'TELEBOSS 3000', 'BELLRINGER ALARM', 'DRUM WASHER', 'GALE BLOWER', 'GHOST VACUUM', 'ROBO-BOSS 9000', 'WEB-SPINNER'],
    bossSkills: [['Smoothie puddles', 'After attacking it leaves a sticky puddle that slows heroes down'], ['Commercial break', 'Every attack summons a mini vacuum (up to two at once)'],
      ['Ring!', 'Hits every standing hero at once, 1 ♥ each'], ['Soap foam', 'Foam fully soaks up the first hit. It grows back after an attack'],
      ['Gale', 'Its attack blows all heroes away from it'], ['Hide and seek', 'After attacking it vanishes and reappears elsewhere'],
      ['Second phase', 'At half toughness it repairs itself and attacks more often'], ['Web', 'Wraps the hero it hits: that hero skips a turn unless a friend frees them with a shot']],
    bossCries: ['WHIRR-WHIRR!', 'DON\'T TOUCH THAT DIAL!', 'RING-A-LING!', 'SPIN CYCLE!', 'FWOOOSH!', 'Boooo!', 'TURBO SUCK!', 'SKITTER-SKITTER!'],
    bossFx: ['Sticky!', 'Ad break!', 'Ring!', 'Foam!', 'Gale!', 'Boo!', 'Second phase!', 'Webbed!'], skillLabel: 'Ability',
    bossWarn: 'WARNING · BOSS INCOMING', bossName: 'ROBO-BOSS 9000', 'stat.hp': 'Toughness', 'stat.atk': 'Hit', 'stat.every': 'Attacks',
    'stat.everyN': n => `every ${n} turns`, bossHint: 'Hit the yellow sensor: triple damage', tapToStart: 'Tap to start',
    turn: n => `Turn ${n}`, hudWave: n => ` · wave ${n}`, pullHint: 'Pull back from a hero and let go', par3: n => `3 stars: finish in ${n} turns or fewer`,
    koCount: n => `out · ${n}`, zoomReady: 'ready · shoot', zoomTap: 'tap: x2 power', mischief: 'Mischief',
    homeHp: (a, b) => `Home strength ${a} / ${b}`, typeBounce: 'bounce', typePierce: 'pierce',
    features: [['Yarn', 'Every hero leaves a thread. Cross an old thread and the knot explodes on nearby enemies. Up to 2 knots per shot.'],
      ['Laser pointer', 'Cats swerve toward the red dot. Catch it for a speed boost and mischief.'], ['Boxes', 'Fly into box A, pop out of box B.'],
      ['Mischief → Zoomies', 'Collect fish and pizza. A full meter gives a shot with double power.'], ['Raccoons', 'Bandit delays enemy attacks, Nugget sets off trash explosions.']],
    tagline: 'Cats and raccoons vs. the robot vacuum uprising',
    howtoIntro: 'Pull back from a hero and let go, like a slingshot. The number above an enemy is how many turns until it attacks.',
    play: 'Play', hello: n => `Hi, ${n}! Pick a level`, pickLevel: 'Pick a level', chStars: (a, b) => `${a} / ${b} stars`, boss: 'BOSS',
    howto: 'How to play', nightAfter: 'Night Shift · after level 4', levelDone: n => `Level ${n} complete!`, shiftOver: 'Shift over',
    vacWon: 'The vacuums won', winSub: (t, p) => `${t} turns · 3 stars need ${p}`, survived: w => `Survived: ${w}`,
    allKo: 'All heroes knocked out. Try again', waveTry: (a, b) => `Wave ${a} of ${b}. Try again`,
    'st.knots': 'Knots tied', 'st.lasers': 'Lasers caught', 'st.crits': 'Sensor crits', 'st.portals': 'Teleports',
    newBestLevel: 'New record for this level!', newBestNight: 'New Night Shift record!', again: 'Again', map: 'Map', next: 'Next',
    toMap: 'To the map', allDone: 'Home saved! All levels complete', lang: 'Language',
    'ev.halloween': 'Halloween', 'ev.newyear': 'New Year', evSub: (d, n) => `Event: ${d}/${n} levels · reward: a hat`, evLevel: (e, n) => `${e} · ${n}/3`,
    evDone: 'Event level complete!', evHat: 'A new hat for the team!',
    'item.hat_pumpkin': 'Pumpkin hat', 'itemd.hat_pumpkin': 'Halloween reward', 'item.hat_santa': 'Santa hat', 'itemd.hat_santa': 'New Year reward',
    'hero.rex.name': 'Rex', 'hero.rex.skill': 'allies he touches get +1 heart', 'hero.rex.combo': 'Rescue mission',
    'hero.homa.name': 'Hammy', 'hero.homa.skill': 'the longer he rolls, the harder he hits', 'hero.homa.combo': 'Nut shower',
    'perk.rex.5': '+2 hearts instead of +1', 'perk.rex.10': 'His combo also heals the home by 800', 'perk.homa.5': 'Multiplier up to ×3', 'perk.homa.10': '+20% speed',
    'item.hero_rex': 'Rex', 'itemd.hero_rex': 'Heals friends he touches',
    inShop: 'In the shop', afterLvl: n => `Unlocks after level ${n}`, teamAdd: 'Add', teamRule: 'A team has 4–5 heroes',
    heroes: 'Heroes', lvl: n => `Lv ${n}`, xpOf: (a, b) => `${a} / ${b} XP`, maxLvl: 'Max level', perAll: 'Every hero level: +4% damage', xpGain: n => `+${n} XP for every hero`, lvlUp: s => `level up: ${s}`, 'knot.fire': 'Fire knot!', 'knot.purr': 'Purring knot!', 'knot.trash': 'Trash knot!', hardName: 'Challenge mode', hardDesc: n => `Enemies +40% tougher, only ${n} turns. Double XP and a crown`, hardLeft: n => `Challenge: ${n} turns left`, hardTurns: 'Out of turns. Try again', hardDone: n => `Challenge ${n} complete!`, 'perk.mochi.5': '+20% per wall bounce', 'perk.mochi.10': '+25% per wall bounce', 'perk.pixel.5': '+15% damage when piercing', 'perk.pixel.10': 'Laser Stare: 800 damage', 'perk.bandit.5': 'Midnight Snack heals 700', 'perk.bandit.10': 'Hits delay attacks by 2 turns', 'perk.nugget.5': 'Bigger blast radius', 'perk.nugget.10': 'Blasts deal 320', 'perk.spark.5': 'Lightning deals 70%', 'perk.spark.10': 'Lightning hits two enemies',
    daily: 'Daily', dailyBonus: 'Login bonus', streak: n => `Streak: ${n} days`, dayShort: n => `D${n}`, challenge: 'Daily challenge', 'ch.knots': n => `Win the level and tie ${n} knots`, 'ch.lasers': n => `Win the level and catch the laser ${n} times`, 'ch.noko': () => 'Win the level without a single knockout', 'ch.par': n => `Win the level in ${n} turns or fewer`, 'ch.portals': n => `Win the level and fly through boxes ${n} times`, reward: 'Reward', chDone: 'Done ✓', chWon: r => `Daily challenge done! +1 ${r}`, invite: 'Invite a friend', inviteDesc: 'When a friend joins through your link, you both get +1 heart and +1 quick start', invited: n => `Invited: ${n}`, inviteBtn: 'Invite', inviteText: 'Cats and raccoons vs robot vacuums! Play Pawsling with me 🐾', giftedMsg: 'A friend invited you: +1 heart and +1 quick start!', dailyTgOnly: 'Bonuses and rewards work when the game is opened in Telegram', boardWeek: 'Week', weekLeft: (d, h) => `Ends in ${d}d ${h}h`, weekPrizes: 'the top 3 get prizes on Monday',
    shop: 'Shop',
    shopTgOnly: 'The shop works when the game is opened in Telegram',
    equip: 'Wear',
    unequip: 'Remove',
    inTeam: 'In the team',
    startLvl: 'Start',
    cancel: 'Cancel',
    boosters: 'Boosters for this level',
    boostHeart: 'Heart+',
    boostHeartD: '+1 heart for every hero',
    boostMeter: 'Quick start',
    boostMeterD: 'Half a Mischief meter right away',
    owned: n => `you have: ${n}`,
    'item.heart3': 'Heart+ ×3', 'itemd.heart3': '+1 heart for every hero, 3 levels',
    'item.meter3': 'Quick start ×3', 'itemd.meter3': 'Half a Mischief meter at the start, 3 levels',
    'item.hero_spark': 'Sparky', 'itemd.hero_spark': 'Her hits arc like lightning to a neighbor',
    'item.hat_party': 'Party hat', 'itemd.hat_party': 'For the whole team',
    'item.hat_crown': 'Crown', 'itemd.hat_crown': 'For the whole team',
    'item.hat_bow': 'Bow', 'itemd.hat_bow': 'For the whole team',
    'item.rainbow': 'Rainbow yarn', 'itemd.rainbow': 'Threads shimmer like a rainbow',
    'hero.spark.name': 'Sparky', 'hero.spark.skill': 'each hit arcs like lightning to the nearest enemy', 'hero.spark.combo': 'Thundercloud', secondWind: 'Second wind', secondWindSub: 'Full home strength, every hero back up', secondWindGo: 'Second wind!', payWait: 'Opening payment…', payFailed: 'Payment failed. Try again', langAuto: 'Automatic',
    aria: 'Pawsling. Pull back from a hero and let go to launch it like a slingshot.',
    board: 'Leaderboard', boardNight: 'Night Shift', boardStars: 'Stars', boardYou: 'you', boardEmpty: 'Nobody here yet. Be the first!',
    boardLoading: 'Loading…', boardError: 'Could not load the leaderboard. Check your connection and try again.',
    boardTgOnly: 'The leaderboard works when the game is opened in Telegram.', boardRetry: 'Refresh', boardPlayer: 'Player',
  },
  pl: {
    'hero.mochi.name': 'Mochi', 'hero.mochi.skill': '+15% obrażeń za każde odbicie od ściany', 'hero.mochi.combo': 'Fala mruczenia',
    'hero.pixel.name': 'Pixel', 'hero.pixel.skill': 'przelatuje przez wrogów na wylot', 'hero.pixel.combo': 'Laserowe spojrzenie',
    'hero.bandit.name': 'Bandyta', 'hero.bandit.skill': 'każde trafienie opóźnia atak wroga o turę', 'hero.bandit.combo': 'Nocna przekąska',
    'hero.nugget.name': 'Nugget', 'hero.nugget.skill': 'każde trafienie wybucha na pobliskich wrogach', 'hero.nugget.combo': 'Skarb ze śmietnika',
    'room.kitchen': 'Kuchnia', 'room.living': 'Salon', 'room.bedroom': 'Sypialnia', 'room.bath': 'Łazienka', 'room.balcony': 'Balkon', 'room.attic': 'Strych', 'room.garage': 'Garaż', 'room.basement': 'Piwnica', 'tip.basement': 'Piwnica: wszystkie rodzaje wrogów naraz, twardsze niż kiedykolwiek', 'tip.web': 'Pająk oplata bohaterów: traf oplątanego przyjaciela strzałem, by go uwolnić', webStuck: 'W pajęczynie!', webFreed: 'Uwolniony!',
    'tip.shield': 'Tarczoboty chronią sąsiadów: najpierw zbij tarczobota', 'tip.split': 'Bliźniaki po zniszczeniu rozpadają się na dwa maluchy', shielded: 'tarcza', 'cry.shield': 'Brzdęk!', 'cry.split': 'Bulk!', 'cry.mini': 'Pip!',
    'tip.0': 'Pociągnij od bohatera do tyłu i puść', 'tip.1': 'Przetnij starą nitkę, a supeł wybuchnie', 'tip.2': 'Koty gonią czerwoną kropkę lasera',
    'tip.3': 'Trafiaj w żółty czujnik: potrójne obrażenia', 'tip.4': 'Mopy mają pancerz: Pixel i Nugget biją je dwa razy mocniej',
    'tip.12': 'Szczoteczki leczą pobliskich wrogów, bij je najpierw', 'tip.18': 'Wiatraki zdmuchują bohaterów, celuj z zapasem',
    'tip.24': 'Autka RC co turę zmieniają miejsce',
    woke: 'Obudził się!', revived: 'Wstał!', waves: n => `${n} ${plural(n, 'fala', 'fale', 'fal')}`,
    newRoom: r => `Nowy pokój: ${r}`, record: v => `Rekord: ${v}`, waveOf: (a, b) => `Fala ${a} z ${b}`,
    night: 'Nocna zmiana', nightWave: n => `Nocna zmiana · fala ${n}`, levelRoom: (n, r) => `Poziom ${n} · ${r}`,
    zoomies: 'SZAŁ!', armor: 'pancerz', crit: 'KRYT!', plusTurn: '+1 tura', plusMischief: v => `+${v} psot`, knot: 'Supeł!', caught: 'Złapany!',
    whoosh: 'Szast!', whooshFast: 'Szast! +szybkość', vroom: 'Wrrum!',
    'cry.boss': 'TURBO-SSANIE!', 'cry.spray': 'Psssik!', 'cry.mop': 'Plask!', 'cry.vac': 'Wrrrum!', 'cry.brush': 'Bzzzz!', 'cry.fan': 'Fiuuu!', 'cry.rc': 'Bip-bip!',
    ko: 'Nokaut!', koHint: 'Traf przyjaciela strzałem, żeby go podnieść', waveClear: 'Fala pokonana!', waveClearSub: h => `+${h} wytrzymałości mieszkania i +1 ♥ dla każdego`,
    'tag.bounce': ['ODBICIE', 'odbija się od wrogów'], 'tag.pierce': ['PRZEBICIE', 'przelatuje przez wrogów'],
    bossTitles: [['Postrach okruszków', 'Ani okruszka na podłodze!'], ['Władca pilota', 'Ta kanapa jest teraz moja!'], ['Nocny koszmar', 'Czas spać... na zawsze!'],
      ['Mydlany baron', 'Spłuczę was do kanalizacji!'], ['Wichrowy', 'Zdmuchnę was z balkonu!'], ['Upiór ze strychu', 'Nikt tu nie mieszka... oprócz mnie!'],
      ['Żelazny mechanik', 'Rozkręcę was na śrubki!'], ['Piwniczny tkacz', 'Nikt nie wyjdzie z mojej piwnicy!']],
    bossNames: ['BLENDER MEGAMIX', 'TELEBOSS 3000', 'BUDZIK-DZWONNIK', 'PRALKA «BĘBEN»', 'DMUCHAWA «WICHER»', 'ODKURZACZ-DUCH', 'ROBO-BOSS 9000', 'PAJĄK «SIEĆ»'],
    bossSkills: [['Kałuże smoothie', 'Po ataku zostawia lepką kałużę, która spowalnia bohaterów'], ['Reklama', 'Każdy atak przywołuje mini-odkurzacz (maks. dwa naraz)'],
      ['Dzwonek', 'Trafia wszystkich stojących bohaterów naraz, po 1 ♥'], ['Piana', 'Piana całkowicie pochłania pierwszy cios. Odrasta po ataku'],
      ['Wicher', 'Jego atak odrzuca wszystkich bohaterów'], ['Chowany', 'Po ataku znika i pojawia się w innym miejscu'],
      ['Druga faza', 'Przy połowie wytrzymałości naprawia się i atakuje częściej'], ['Pajęczyna', 'Oplata trafionego bohatera: traci turę, chyba że przyjaciel uwolni go strzałem']],
    bossCries: ['WZIUU-WZIUU!', 'NIE PRZEŁĄCZAJ!', 'DRRRYŃ!', 'WIROWANIE!', 'FIUUUCH!', 'Uuuuu!', 'TURBO-SSANIE!', 'TUP-TUP-TUP!'],
    bossFx: ['Lepko!', 'Reklama!', 'Dzwonek!', 'Piana!', 'Wicher!', 'Buu!', 'Druga faza!', 'Oplątany!'], skillLabel: 'Umiejętność',
    bossWarn: 'UWAGA · NADCHODZI BOSS', bossName: 'ROBO-BOSS 9000', 'stat.hp': 'Wytrzymałość', 'stat.atk': 'Cios', 'stat.every': 'Atakuje',
    'stat.everyN': n => `co ${n} tury`, bossHint: 'Trafiaj w żółty czujnik: potrójne obrażenia', tapToStart: 'Dotknij, aby zacząć',
    turn: n => `Tura ${n}`, hudWave: n => ` · fala ${n}`, pullHint: 'Ciągnij od bohatera do tyłu i puszczaj', par3: n => `3 gwiazdki: ukończ w ${n} tur lub mniej`,
    koCount: n => `nokaut · ${n}`, zoomReady: 'gotowe · strzelaj', zoomTap: 'dotknij: x2 siła', mischief: 'Psoty',
    homeHp: (a, b) => `Wytrzymałość mieszkania ${a} / ${b}`, typeBounce: 'odbicie', typePierce: 'przebicie',
    features: [['Włóczka', 'Każdy bohater zostawia nitkę. Przetnij starą nitkę, a supeł wybuchnie na pobliskich wrogach. Do 2 supłów na strzał.'],
      ['Wskaźnik laserowy', 'Koty skręcają do czerwonej kropki. Złap ją, by przyspieszyć i zdobyć psoty.'], ['Pudełka', 'Wleć do pudełka A, wyleć z pudełka B.'],
      ['Psoty → Szał', 'Zbieraj ryby i pizzę. Pełny pasek daje strzał z podwójną siłą.'], ['Szopy', 'Bandyta opóźnia ataki wrogów, Nugget urządza śmieciowe wybuchy.']],
    tagline: 'Koty i szopy kontra bunt robotów sprzątających',
    howtoIntro: 'Pociągnij od bohatera do tyłu i puść jak procę. Liczba nad wrogiem to liczba tur do jego ataku.',
    play: 'Graj', hello: n => `Cześć, ${n}! Wybierz poziom`, pickLevel: 'Wybierz poziom', chStars: (a, b) => `${a} / ${b} gwiazdek`, boss: 'BOSS',
    howto: 'Jak grać', nightAfter: 'Nocna zmiana · po poziomie 4', levelDone: n => `Poziom ${n} ukończony!`, shiftOver: 'Koniec zmiany',
    vacWon: 'Odkurzacze wygrały', winSub: (t, p) => `${t} tur · na 3 gwiazdki: ${p}`, survived: w => `Przetrwane: ${w}`,
    allKo: 'Wszyscy bohaterowie znokautowani. Spróbuj jeszcze raz', waveTry: (a, b) => `Fala ${a} z ${b}. Spróbuj jeszcze raz`,
    'st.knots': 'Zawiązane supły', 'st.lasers': 'Złapane lasery', 'st.crits': 'Kryty w czujnik', 'st.portals': 'Teleporty',
    newBestLevel: 'Nowy rekord tego poziomu!', newBestNight: 'Nowy rekord nocnej zmiany!', again: 'Jeszcze raz', map: 'Mapa', next: 'Dalej',
    toMap: 'Do mapy', allDone: 'Mieszkanie uratowane! Wszystkie poziomy ukończone', lang: 'Język',
    'ev.halloween': 'Halloween', 'ev.newyear': 'Nowy Rok', evSub: (d, n) => `Wydarzenie: ${d}/${n} poziomów · nagroda: czapka`, evLevel: (e, n) => `${e} · ${n}/3`,
    evDone: 'Poziom wydarzenia ukończony!', evHat: 'Nowa czapka dla drużyny!',
    'item.hat_pumpkin': 'Dyniowa czapka', 'itemd.hat_pumpkin': 'Nagroda z Halloween', 'item.hat_santa': 'Czapka Mikołaja', 'itemd.hat_santa': 'Nagroda noworoczna',
    'hero.rex.name': 'Reks', 'hero.rex.skill': 'dotknięci przyjaciele dostają +1 serce', 'hero.rex.combo': 'Misja ratunkowa',
    'hero.homa.name': 'Tomek', 'hero.homa.skill': 'im dłużej się toczy, tym mocniej bije', 'hero.homa.combo': 'Orzechowy deszcz',
    'perk.rex.5': '+2 serca zamiast +1', 'perk.rex.10': 'Jego kombo leczy też mieszkanie o 800', 'perk.homa.5': 'Mnożnik do ×3', 'perk.homa.10': '+20% szybkości',
    'item.hero_rex': 'Reks', 'itemd.hero_rex': 'Leczy dotkniętych przyjaciół',
    inShop: 'W sklepie', afterLvl: n => `Odblokuj po poziomie ${n}`, teamAdd: 'Dodaj', teamRule: 'Drużyna ma 4–5 bohaterów',
    heroes: 'Bohaterowie', lvl: n => `Poz. ${n}`, xpOf: (a, b) => `${a} / ${b} PD`, maxLvl: 'Maksymalny poziom', perAll: 'Każdy poziom bohatera: +4% obrażeń', xpGain: n => `+${n} PD dla każdego bohatera`, lvlUp: s => `awans: ${s}`, 'knot.fire': 'Ognisty supeł!', 'knot.purr': 'Mruczący supeł!', 'knot.trash': 'Śmieciowy supeł!', hardName: 'Wyzwanie', hardDesc: n => `Wrogowie +40% wytrzymalsi, tylko ${n} tur. Podwójne PD i korona`, hardLeft: n => `Wyzwanie: zostało ${n} tur`, hardTurns: 'Skończyły się tury. Spróbuj ponownie', hardDone: n => `Wyzwanie ${n} ukończone!`, 'perk.mochi.5': '+20% za każde odbicie', 'perk.mochi.10': '+25% za każde odbicie', 'perk.pixel.5': '+15% obrażeń przy przebiciu', 'perk.pixel.10': 'Laserowe spojrzenie: 800', 'perk.bandit.5': 'Nocna przekąska leczy 700', 'perk.bandit.10': 'Ciosy opóźniają atak o 2 tury', 'perk.nugget.5': 'Większy zasięg wybuchu', 'perk.nugget.10': 'Wybuchy zadają 320', 'perk.spark.5': 'Piorun zadaje 70%', 'perk.spark.10': 'Piorun trafia dwóch wrogów',
    daily: 'Codziennie', dailyBonus: 'Bonus za logowanie', streak: n => `Seria: ${n} dni`, dayShort: n => `D${n}`, challenge: 'Zadanie dnia', 'ch.knots': n => `Wygraj poziom i zawiąż ${n} supły`, 'ch.lasers': n => `Wygraj poziom i złap laser ${n} razy`, 'ch.noko': () => 'Wygraj poziom bez żadnego nokautu', 'ch.par': n => `Wygraj poziom w ${n} tur lub mniej`, 'ch.portals': n => `Wygraj poziom i przeleć przez pudełka ${n} razy`, reward: 'Nagroda', chDone: 'Zrobione ✓', chWon: r => `Zadanie dnia wykonane! +1 ${r}`, invite: 'Zaproś znajomego', inviteDesc: 'Gdy znajomy dołączy z twojego linku, oboje dostaniecie +1 serce i +1 szybki start', invited: n => `Zaproszono: ${n}`, inviteBtn: 'Zaproś', inviteText: 'Koty i szopy kontra roboty sprzątające! Zagraj ze mną w Pawsling 🐾', giftedMsg: 'Zaprosił cię znajomy: +1 serce i +1 szybki start!', dailyTgOnly: 'Bonusy i nagrody działają, gdy gra jest otwarta w Telegramie', boardWeek: 'Tydzień', weekLeft: (d, h) => `Koniec za ${d} d ${h} godz.`, weekPrizes: 'top 3 dostanie nagrody w poniedziałek',
    shop: 'Sklep',
    shopTgOnly: 'Sklep działa, gdy gra jest otwarta w Telegramie',
    equip: 'Załóż',
    unequip: 'Zdejmij',
    inTeam: 'W drużynie',
    startLvl: 'Start',
    cancel: 'Anuluj',
    boosters: 'Wzmocnienia na ten poziom',
    boostHeart: 'Serce+',
    boostHeartD: '+1 serce dla każdego bohatera',
    boostMeter: 'Szybki start',
    boostMeterD: 'Pół paska psot od razu',
    owned: n => `masz: ${n}`,
    'item.heart3': 'Serce+ ×3', 'itemd.heart3': '+1 serce dla każdego bohatera, 3 poziomy',
    'item.meter3': 'Szybki start ×3', 'itemd.meter3': 'Pół paska psot na starcie, 3 poziomy',
    'item.hero_spark': 'Iskra', 'itemd.hero_spark': 'Jej ciosy przeskakują piorunem na sąsiada',
    'item.hat_party': 'Czapeczka imprezowa', 'itemd.hat_party': 'Dla całej drużyny',
    'item.hat_crown': 'Korona', 'itemd.hat_crown': 'Dla całej drużyny',
    'item.hat_bow': 'Kokardka', 'itemd.hat_bow': 'Dla całej drużyny',
    'item.rainbow': 'Tęczowa włóczka', 'itemd.rainbow': 'Nitki mienią się tęczą',
    'hero.spark.name': 'Iskra', 'hero.spark.skill': 'każde trafienie przeskakuje piorunem na najbliższego wroga', 'hero.spark.combo': 'Chmura burzowa', secondWind: 'Drugi oddech', secondWindSub: 'Pełna wytrzymałość i wszyscy bohaterowie na nogach', secondWindGo: 'Drugi oddech!', payWait: 'Otwieram płatność…', payFailed: 'Płatność nie powiodła się. Spróbuj ponownie', langAuto: 'Automatycznie',
    aria: 'Pawsling. Pociągnij od bohatera do tyłu i puść, żeby wystrzelić go jak z procy.',
    board: 'Ranking', boardNight: 'Nocna zmiana', boardStars: 'Gwiazdki', boardYou: 'ty', boardEmpty: 'Jeszcze nikogo tu nie ma. Bądź pierwszy!',
    boardLoading: 'Ładowanie…', boardError: 'Nie udało się wczytać rankingu. Sprawdź internet i spróbuj ponownie.',
    boardTgOnly: 'Ranking działa, gdy gra jest otwarta w Telegramie.', boardRetry: 'Odśwież', boardPlayer: 'Gracz',
  },
  de: {
    'hero.mochi.name': 'Mochi', 'hero.mochi.skill': '+15 % Schaden pro Abprall an der Wand', 'hero.mochi.combo': 'Schnurrwelle',
    'hero.pixel.name': 'Pixel', 'hero.pixel.skill': 'fliegt glatt durch Gegner hindurch', 'hero.pixel.combo': 'Laserblick',
    'hero.bandit.name': 'Bandit', 'hero.bandit.skill': 'jeder Treffer verzögert den Gegnerangriff um einen Zug', 'hero.bandit.combo': 'Mitternachtssnack',
    'hero.nugget.name': 'Nugget', 'hero.nugget.skill': 'jeder Treffer explodiert bei nahen Gegnern', 'hero.nugget.combo': 'Mülltonnenschatz',
    'room.kitchen': 'Küche', 'room.living': 'Wohnzimmer', 'room.bedroom': 'Schlafzimmer', 'room.bath': 'Badezimmer', 'room.balcony': 'Balkon', 'room.attic': 'Dachboden', 'room.garage': 'Garage', 'room.basement': 'Keller', 'tip.basement': 'Keller: alle Gegnerarten auf einmal, härter als je zuvor', 'tip.web': 'Die Spinne umspinnt Helden: triff einen eingesponnenen Freund, um ihn zu befreien', webStuck: 'Im Netz!', webFreed: 'Befreit!',
    'tip.shield': 'Schildbots schützen ihre Nachbarn: schalte zuerst den Schildbot aus', 'tip.split': 'Zwillinge zerfallen beim Zerstören in zwei Kleine', shielded: 'Schild', 'cry.shield': 'Kling!', 'cry.split': 'Blubb!', 'cry.mini': 'Piep!',
    'tip.0': 'Vom Helden nach hinten ziehen und loslassen', 'tip.1': 'Kreuze einen alten Faden und der Knoten explodiert', 'tip.2': 'Katzen jagen den roten Laserpunkt',
    'tip.3': 'Triff den gelben Sensor: dreifacher Schaden', 'tip.4': 'Wischmopps sind gepanzert: Pixel und Nugget treffen sie doppelt',
    'tip.12': 'Zahnbürsten heilen Gegner in der Nähe, schalte sie zuerst aus', 'tip.18': 'Ventilatoren pusten Helden zur Seite, ziele mit Abstand',
    'tip.24': 'RC-Autos fahren jeden Zug an einen neuen Platz',
    woke: 'Wach!', revived: 'Wieder da!', waves: n => `${n} ${one(n, 'Welle', 'Wellen')}`,
    newRoom: r => `Neuer Raum: ${r}`, record: v => `Rekord: ${v}`, waveOf: (a, b) => `Welle ${a} von ${b}`,
    night: 'Nachtschicht', nightWave: n => `Nachtschicht · Welle ${n}`, levelRoom: (n, r) => `Level ${n} · ${r}`,
    zoomies: 'FLITZEN!', armor: 'Panzer', crit: 'KRIT!', plusTurn: '+1 Zug', plusMischief: v => `+${v} Unfug`, knot: 'Knoten!', caught: 'Erwischt!',
    whoosh: 'Wusch!', whooshFast: 'Wusch! +Tempo', vroom: 'Brumm!',
    'cry.boss': 'TURBO-SAUGEN!', 'cry.spray': 'Pschhh!', 'cry.mop': 'Platsch!', 'cry.vac': 'Wrrrumm!', 'cry.brush': 'Bzzzz!', 'cry.fan': 'Fwuusch!', 'cry.rc': 'Piep-piep!',
    ko: 'K.o.!', koHint: 'Triff einen Freund mit einem Schuss, um ihn aufzuwecken', waveClear: 'Welle geschafft!', waveClearSub: h => `+${h} Wohnungsstärke und +1 ♥ für alle`,
    'tag.bounce': ['ABPRALL', 'prallt von Gegnern ab'], 'tag.pierce': ['DURCHSCHLAG', 'fliegt durch Gegner'],
    bossTitles: [['Krümelschreck', 'Kein Krümel auf dem Boden!'], ['Fernbedienungsfürst', 'Das Sofa gehört jetzt mir!'], ['Nachtmahr', 'Schlafenszeit... für immer!'],
      ['Seifenbaron', 'Ab in den Abfluss mit euch!'], ['Sturmbringer', 'Ich puste euch vom Balkon!'], ['Dachbodengeist', 'Hier wohnt niemand... außer mir!'],
      ['Eiserner Mechaniker', 'Ich schraub euch auseinander!'], ['Kellerweber', 'Aus meinem Keller kommt keiner raus!']],
    bossNames: ['MIXER MEGAMIX', 'TELEBOSS 3000', 'WECKER-BIMMLER', 'WASCHTROMMEL', 'STURMBLÄSER', 'GEISTERSAUGER', 'ROBO-BOSS 9000', 'SPINNE «NETZ»'],
    bossSkills: [['Smoothie-Pfützen', 'Hinterlässt nach dem Angriff eine klebrige Pfütze, die Helden bremst'], ['Werbepause', 'Jeder Angriff ruft einen Mini-Sauger (höchstens zwei)'],
      ['Klingeln', 'Trifft alle stehenden Helden gleichzeitig, je 1 ♥'], ['Seifenschaum', 'Schaum schluckt den ersten Treffer ganz. Wächst nach einem Angriff nach'],
      ['Sturm', 'Sein Angriff bläst alle Helden von ihm weg'], ['Versteckspiel', 'Verschwindet nach dem Angriff und taucht woanders auf'],
      ['Zweite Phase', 'Bei halber Stärke repariert er sich und greift öfter an'], ['Netz', 'Umspinnt den getroffenen Helden: er setzt einen Zug aus, wenn ihn kein Freund per Schuss befreit']],
    bossCries: ['WIRR-WIRR!', 'NICHT UMSCHALTEN!', 'RRRRING!', 'SCHLEUDERGANG!', 'FUUUSCH!', 'Huuuu!', 'TURBO-SAUGEN!', 'KRABBEL-KRABBEL!'],
    bossFx: ['Klebrig!', 'Werbung!', 'Klingeling!', 'Schaum!', 'Sturm!', 'Buh!', 'Zweite Phase!', 'Eingesponnen!'], skillLabel: 'Fähigkeit',
    bossWarn: 'ACHTUNG · BOSS NAHT', bossName: 'ROBO-BOSS 9000', 'stat.hp': 'Stärke', 'stat.atk': 'Schlag', 'stat.every': 'Angriff',
    'stat.everyN': n => `alle ${n} Züge`, bossHint: 'Triff den gelben Sensor: dreifacher Schaden', tapToStart: 'Tippen zum Starten',
    turn: n => `Zug ${n}`, hudWave: n => ` · Welle ${n}`, pullHint: 'Vom Helden zurückziehen und loslassen', par3: n => `3 Sterne: in ${n} Zügen oder weniger`,
    koCount: n => `k.o. · ${n}`, zoomReady: 'bereit · schieß', zoomTap: 'tippen: x2 Kraft', mischief: 'Unfug',
    homeHp: (a, b) => `Wohnungsstärke ${a} / ${b}`, typeBounce: 'Abprall', typePierce: 'Durchschlag',
    features: [['Wolle', 'Jeder Held zieht einen Faden. Kreuze einen alten Faden und der Knoten explodiert bei nahen Gegnern. Bis zu 2 Knoten pro Schuss.'],
      ['Laserpointer', 'Katzen lenken zum roten Punkt. Fang ihn für mehr Tempo und Unfug.'], ['Kartons', 'Rein in Karton A, raus aus Karton B.'],
      ['Unfug → Flitzen', 'Sammle Fisch und Pizza. Eine volle Leiste gibt einen Schuss mit doppelter Kraft.'], ['Waschbären', 'Bandit verzögert Gegnerangriffe, Nugget sorgt für Müllexplosionen.']],
    tagline: 'Katzen und Waschbären gegen den Saugroboter-Aufstand',
    howtoIntro: 'Zieh vom Helden zurück und lass los wie eine Schleuder. Die Zahl über einem Gegner zeigt die Züge bis zu seinem Angriff.',
    play: 'Spielen', hello: n => `Hallo, ${n}! Wähle ein Level`, pickLevel: 'Wähle ein Level', chStars: (a, b) => `${a} / ${b} Sterne`, boss: 'BOSS',
    howto: 'Anleitung', nightAfter: 'Nachtschicht · nach Level 4', levelDone: n => `Level ${n} geschafft!`, shiftOver: 'Schicht vorbei',
    vacWon: 'Die Sauger haben gewonnen', winSub: (t, p) => `${t} Züge · 3 Sterne bei ${p}`, survived: w => `Überstanden: ${w}`,
    allKo: 'Alle Helden k.o. Versuch es nochmal', waveTry: (a, b) => `Welle ${a} von ${b}. Versuch es nochmal`,
    'st.knots': 'Geknüpfte Knoten', 'st.lasers': 'Laser gefangen', 'st.crits': 'Sensor-Krits', 'st.portals': 'Teleports',
    newBestLevel: 'Neuer Rekord für dieses Level!', newBestNight: 'Neuer Nachtschicht-Rekord!', again: 'Nochmal', map: 'Karte', next: 'Weiter',
    toMap: 'Zur Karte', allDone: 'Wohnung gerettet! Alle Level geschafft', lang: 'Sprache',
    'ev.halloween': 'Halloween', 'ev.newyear': 'Neujahr', evSub: (d, n) => `Event: ${d}/${n} Level · Preis: ein Hut`, evLevel: (e, n) => `${e} · ${n}/3`,
    evDone: 'Event-Level geschafft!', evHat: 'Ein neuer Hut fürs Team!',
    'item.hat_pumpkin': 'Kürbishut', 'itemd.hat_pumpkin': 'Halloween-Preis', 'item.hat_santa': 'Weihnachtsmütze', 'itemd.hat_santa': 'Neujahrspreis',
    'hero.rex.name': 'Rex', 'hero.rex.skill': 'berührte Freunde bekommen +1 Herz', 'hero.rex.combo': 'Rettungseinsatz',
    'hero.homa.name': 'Hamsti', 'hero.homa.skill': 'je länger er rollt, desto härter trifft er', 'hero.homa.combo': 'Nussregen',
    'perk.rex.5': '+2 Herzen statt +1', 'perk.rex.10': 'Sein Kombo heilt auch die Wohnung um 800', 'perk.homa.5': 'Multiplikator bis ×3', 'perk.homa.10': '+20 % Tempo',
    'item.hero_rex': 'Rex', 'itemd.hero_rex': 'Heilt berührte Freunde',
    inShop: 'Im Shop', afterLvl: n => `Frei nach Level ${n}`, teamAdd: 'Dazu', teamRule: 'Ein Team hat 4–5 Helden',
    heroes: 'Helden', lvl: n => `Lv. ${n}`, xpOf: (a, b) => `${a} / ${b} EP`, maxLvl: 'Höchststufe', perAll: 'Jede Heldenstufe: +4 % Schaden', xpGain: n => `+${n} EP für jeden Helden`, lvlUp: s => `Aufstieg: ${s}`, 'knot.fire': 'Feuerknoten!', 'knot.purr': 'Schnurrknoten!', 'knot.trash': 'Müllknoten!', hardName: 'Herausforderung', hardDesc: n => `Gegner +40 % stärker, nur ${n} Züge. Doppelte EP und eine Krone`, hardLeft: n => `Herausforderung: noch ${n} Züge`, hardTurns: 'Keine Züge mehr. Versuch es nochmal', hardDone: n => `Herausforderung ${n} geschafft!`, 'perk.mochi.5': '+20 % pro Abprall', 'perk.mochi.10': '+25 % pro Abprall', 'perk.pixel.5': '+15 % Schaden beim Durchschlag', 'perk.pixel.10': 'Laserblick: 800 Schaden', 'perk.bandit.5': 'Mitternachtssnack heilt 700', 'perk.bandit.10': 'Treffer verzögern Angriffe um 2 Züge', 'perk.nugget.5': 'Größerer Explosionsradius', 'perk.nugget.10': 'Explosionen machen 320', 'perk.spark.5': 'Blitz macht 70 %', 'perk.spark.10': 'Blitz trifft zwei Gegner',
    daily: 'Täglich', dailyBonus: 'Login-Bonus', streak: n => `Serie: ${n} Tage`, dayShort: n => `T${n}`, challenge: 'Tagesaufgabe', 'ch.knots': n => `Gewinne das Level und knüpfe ${n} Knoten`, 'ch.lasers': n => `Gewinne das Level und fang den Laser ${n}-mal`, 'ch.noko': () => 'Gewinne das Level ohne ein einziges K.o.', 'ch.par': n => `Gewinne das Level in ${n} Zügen oder weniger`, 'ch.portals': n => `Gewinne das Level und flieg ${n}-mal durch Kartons`, reward: 'Belohnung', chDone: 'Erledigt ✓', chWon: r => `Tagesaufgabe geschafft! +1 ${r}`, invite: 'Freund einladen', inviteDesc: 'Kommt ein Freund über deinen Link, bekommt ihr beide +1 Herz und +1 Schnellstart', invited: n => `Eingeladen: ${n}`, inviteBtn: 'Einladen', inviteText: 'Katzen und Waschbären gegen Saugroboter! Spiel Pawsling mit mir 🐾', giftedMsg: 'Ein Freund hat dich eingeladen: +1 Herz und +1 Schnellstart!', dailyTgOnly: 'Boni und Belohnungen funktionieren, wenn das Spiel in Telegram geöffnet ist', boardWeek: 'Woche', weekLeft: (d, h) => `Endet in ${d} T ${h} Std.`, weekPrizes: 'die Top 3 bekommen am Montag Preise',
    shop: 'Shop',
    shopTgOnly: 'Der Shop funktioniert, wenn das Spiel in Telegram geöffnet ist',
    equip: 'Anziehen',
    unequip: 'Ablegen',
    inTeam: 'Im Team',
    startLvl: 'Start',
    cancel: 'Abbrechen',
    boosters: 'Booster für dieses Level',
    boostHeart: 'Herz+',
    boostHeartD: '+1 Herz für jeden Helden',
    boostMeter: 'Schnellstart',
    boostMeterD: 'Halbe Unfug-Leiste sofort',
    owned: n => `du hast: ${n}`,
    'item.heart3': 'Herz+ ×3', 'itemd.heart3': '+1 Herz für jeden Helden, 3 Level',
    'item.meter3': 'Schnellstart ×3', 'itemd.meter3': 'Halbe Unfug-Leiste zum Start, 3 Level',
    'item.hero_spark': 'Funke', 'itemd.hero_spark': 'Ihre Treffer springen als Blitz weiter',
    'item.hat_party': 'Partyhut', 'itemd.hat_party': 'Für das ganze Team',
    'item.hat_crown': 'Krone', 'itemd.hat_crown': 'Für das ganze Team',
    'item.hat_bow': 'Schleife', 'itemd.hat_bow': 'Für das ganze Team',
    'item.rainbow': 'Regenbogenwolle', 'itemd.rainbow': 'Fäden schimmern wie ein Regenbogen',
    'hero.spark.name': 'Funke', 'hero.spark.skill': 'jeder Treffer springt als Blitz auf den nächsten Gegner über', 'hero.spark.combo': 'Gewitterwolke', secondWind: 'Zweite Luft', secondWindSub: 'Volle Stärke und alle Helden wieder auf den Beinen', secondWindGo: 'Zweite Luft!', payWait: 'Zahlung wird geöffnet…', payFailed: 'Zahlung fehlgeschlagen. Versuch es nochmal', langAuto: 'Automatisch',
    aria: 'Pawsling. Zieh vom Helden zurück und lass los, um ihn wie mit einer Schleuder abzufeuern.',
    board: 'Rangliste', boardNight: 'Nachtschicht', boardStars: 'Sterne', boardYou: 'du', boardEmpty: 'Noch niemand hier. Sei der Erste!',
    boardLoading: 'Wird geladen…', boardError: 'Rangliste konnte nicht geladen werden. Prüfe die Verbindung und versuch es nochmal.',
    boardTgOnly: 'Die Rangliste funktioniert, wenn das Spiel in Telegram geöffnet ist.', boardRetry: 'Aktualisieren', boardPlayer: 'Spieler',
  },
  es: {
    'hero.mochi.name': 'Mochi', 'hero.mochi.skill': '+15 % de daño por cada rebote en la pared', 'hero.mochi.combo': 'Onda de ronroneo',
    'hero.pixel.name': 'Pixel', 'hero.pixel.skill': 'atraviesa a los enemigos', 'hero.pixel.combo': 'Mirada láser',
    'hero.bandit.name': 'Bandido', 'hero.bandit.skill': 'cada golpe retrasa el ataque enemigo un turno', 'hero.bandit.combo': 'Tentempié nocturno',
    'hero.nugget.name': 'Nugget', 'hero.nugget.skill': 'cada golpe explota sobre los enemigos cercanos', 'hero.nugget.combo': 'Tesoro de la basura',
    'room.kitchen': 'Cocina', 'room.living': 'Salón', 'room.bedroom': 'Dormitorio', 'room.bath': 'Baño', 'room.balcony': 'Balcón', 'room.attic': 'Desván', 'room.garage': 'Garaje', 'room.basement': 'Sótano', 'tip.basement': 'Sótano: todos los enemigos a la vez, más duros que nunca', 'tip.web': 'La araña atrapa a los héroes: golpea a un amigo atrapado para liberarlo', webStuck: '¡En la telaraña!', webFreed: '¡Liberado!',
    'tip.shield': 'Los escudobots protegen a sus vecinos: elimina primero al escudobot', 'tip.split': 'Los gemelos se parten en dos pequeños al destruirlos', shielded: 'escudo', 'cry.shield': '¡Clang!', 'cry.split': '¡Blop!', 'cry.mini': '¡Pip!',
    'tip.0': 'Tira hacia atrás desde un héroe y suelta', 'tip.1': 'Cruza un hilo viejo y el nudo explotará', 'tip.2': 'Los gatos persiguen el punto láser rojo',
    'tip.3': 'Golpea el sensor amarillo: daño triple', 'tip.4': 'Las fregonas tienen armadura: Pixel y Nugget les pegan el doble',
    'tip.12': 'Los cepillos curan a los enemigos cercanos, golpéalos primero', 'tip.18': 'Los ventiladores desvían a los héroes, apunta con margen',
    'tip.24': 'Los coches teledirigidos cambian de sitio cada turno',
    woke: '¡Despierto!', revived: '¡Arriba!', waves: n => `${n} ${one(n, 'oleada', 'oleadas')}`,
    newRoom: r => `Nueva habitación: ${r}`, record: v => `Récord: ${v}`, waveOf: (a, b) => `Oleada ${a} de ${b}`,
    night: 'Turno de noche', nightWave: n => `Turno de noche · oleada ${n}`, levelRoom: (n, r) => `Nivel ${n} · ${r}`,
    zoomies: '¡ZOOMIES!', armor: 'armadura', crit: '¡CRÍTICO!', plusTurn: '+1 turno', plusMischief: v => `+${v} travesura`, knot: '¡Nudo!', caught: '¡Atrapado!',
    whoosh: '¡Zas!', whooshFast: '¡Zas! +velocidad', vroom: '¡Brum!',
    'cry.boss': '¡TURBOASPIRADO!', 'cry.spray': '¡Psss!', 'cry.mop': '¡Plaf!', 'cry.vac': '¡Brrrum!', 'cry.brush': '¡Bzzzz!', 'cry.fan': '¡Fiuuu!', 'cry.rc': '¡Bip-bip!',
    ko: '¡K.O.!', koHint: 'Golpea a un amigo con un disparo para levantarlo', waveClear: '¡Oleada superada!', waveClearSub: h => `+${h} de resistencia y +1 ♥ para todos`,
    'tag.bounce': ['REBOTE', 'rebota en los enemigos'], 'tag.pierce': ['PERFORAR', 'atraviesa a los enemigos'],
    bossTitles: [['Terror de las migas', '¡Ni una miga en el suelo!'], ['Señor del mando', '¡Este sofá ahora es mío!'], ['Pesadilla nocturna', 'Hora de dormir... ¡para siempre!'],
      ['Barón del jabón', '¡Os mando por el desagüe!'], ['Tormentoso', '¡Os soplaré del balcón!'], ['Fantasma del desván', 'Aquí no vive nadie... ¡salvo yo!'],
      ['Mecánico de hierro', '¡Os desmonto tornillo a tornillo!'], ['Tejedor del sótano', '¡Nadie sale de mi sótano!']],
    bossNames: ['BATIDORA MEGAMIX', 'TELEJEFE 3000', 'DESPERTADOR CAMPANERO', 'LAVADORA TAMBOR', 'SOPLADOR VENDAVAL', 'ASPIRADORA FANTASMA', 'ROBO-JEFE 9000', 'ARAÑA «TELARAÑA»'],
    bossSkills: [['Charcos de batido', 'Tras atacar deja un charco pegajoso que frena a los héroes'], ['Anuncios', 'Cada ataque invoca una mini aspiradora (hasta dos a la vez)'],
      ['¡Ring!', 'Golpea a todos los héroes en pie a la vez, 1 ♥ a cada uno'], ['Espuma', 'La espuma absorbe del todo el primer golpe. Vuelve a crecer tras atacar'],
      ['Vendaval', 'Su ataque aleja de un soplido a todos los héroes'], ['Escondite', 'Tras atacar desaparece y reaparece en otro sitio'],
      ['Segunda fase', 'A media vida se repara y ataca más a menudo'], ['Telaraña', 'Envuelve al héroe que golpea: pierde un turno si un amigo no lo libera con un disparo']],
    bossCries: ['¡BRRR-BRRR!', '¡NO CAMBIES DE CANAL!', '¡RIIING!', '¡CENTRIFUGADO!', '¡FUUUSH!', '¡Buuuu!', '¡TURBOASPIRADO!', '¡TIC-TIC-TIC!'],
    bossFx: ['¡Pegajoso!', '¡Anuncio!', '¡Ring!', '¡Espuma!', '¡Vendaval!', '¡Bu!', '¡Segunda fase!', '¡Atrapado!'], skillLabel: 'Habilidad',
    bossWarn: 'ATENCIÓN · LLEGA EL JEFE', bossName: 'ROBO-JEFE 9000', 'stat.hp': 'Vida', 'stat.atk': 'Golpe', 'stat.every': 'Ataca',
    'stat.everyN': n => `cada ${n} turnos`, bossHint: 'Golpea el sensor amarillo: daño triple', tapToStart: 'Toca para empezar',
    turn: n => `Turno ${n}`, hudWave: n => ` · oleada ${n}`, pullHint: 'Tira hacia atrás desde un héroe y suelta', par3: n => `3 estrellas: termina en ${n} turnos o menos`,
    koCount: n => `K.O. · ${n}`, zoomReady: 'listo · dispara', zoomTap: 'toca: x2 poder', mischief: 'Travesura',
    homeHp: (a, b) => `Resistencia del piso ${a} / ${b}`, typeBounce: 'rebote', typePierce: 'perforar',
    features: [['Ovillo', 'Cada héroe deja un hilo. Cruza un hilo viejo y el nudo explota sobre los enemigos cercanos. Hasta 2 nudos por disparo.'],
      ['Puntero láser', 'Los gatos giran hacia el punto rojo. Atrápalo para ganar velocidad y travesura.'], ['Cajas', 'Entra en la caja A y sal por la caja B.'],
      ['Travesura → Zoomies', 'Recoge pescado y pizza. La barra llena da un disparo con doble poder.'], ['Mapaches', 'Bandido retrasa los ataques enemigos, Nugget provoca explosiones de basura.']],
    tagline: 'Gatos y mapaches contra la rebelión de las aspiradoras',
    howtoIntro: 'Tira hacia atrás desde un héroe y suelta, como un tirachinas. El número sobre un enemigo indica los turnos hasta su ataque.',
    play: 'Jugar', hello: n => `¡Hola, ${n}! Elige un nivel`, pickLevel: 'Elige un nivel', chStars: (a, b) => `${a} / ${b} estrellas`, boss: 'JEFE',
    howto: 'Cómo jugar', nightAfter: 'Turno de noche · tras el nivel 4', levelDone: n => `¡Nivel ${n} completado!`, shiftOver: 'Turno terminado',
    vacWon: 'Ganaron las aspiradoras', winSub: (t, p) => `${t} turnos · 3 estrellas con ${p}`, survived: w => `Resistido: ${w}`,
    allKo: 'Todos los héroes K.O. Inténtalo de nuevo', waveTry: (a, b) => `Oleada ${a} de ${b}. Inténtalo de nuevo`,
    'st.knots': 'Nudos atados', 'st.lasers': 'Láseres atrapados', 'st.crits': 'Críticos al sensor', 'st.portals': 'Teletransportes',
    newBestLevel: '¡Nuevo récord en este nivel!', newBestNight: '¡Nuevo récord del turno de noche!', again: 'Otra vez', map: 'Mapa', next: 'Siguiente',
    toMap: 'Al mapa', allDone: '¡Piso salvado! Todos los niveles completados', lang: 'Idioma',
    'ev.halloween': 'Halloween', 'ev.newyear': 'Año Nuevo', evSub: (d, n) => `Evento: ${d}/${n} niveles · premio: un sombrero`, evLevel: (e, n) => `${e} · ${n}/3`,
    evDone: '¡Nivel del evento completado!', evHat: '¡Un sombrero nuevo para el equipo!',
    'item.hat_pumpkin': 'Sombrero de calabaza', 'itemd.hat_pumpkin': 'Premio de Halloween', 'item.hat_santa': 'Gorro de Papá Noel', 'itemd.hat_santa': 'Premio de Año Nuevo',
    'hero.rex.name': 'Rex', 'hero.rex.skill': 'los aliados que toca reciben +1 corazón', 'hero.rex.combo': 'Misión de rescate',
    'hero.homa.name': 'Hamy', 'hero.homa.skill': 'cuanto más rueda, más fuerte golpea', 'hero.homa.combo': 'Lluvia de nueces',
    'perk.rex.5': '+2 corazones en vez de +1', 'perk.rex.10': 'Su combo también cura el piso 800', 'perk.homa.5': 'Multiplicador hasta ×3', 'perk.homa.10': '+20 % de velocidad',
    'item.hero_rex': 'Rex', 'itemd.hero_rex': 'Cura a los amigos que toca',
    inShop: 'En la tienda', afterLvl: n => `Se desbloquea tras el nivel ${n}`, teamAdd: 'Añadir', teamRule: 'Un equipo tiene 4–5 héroes',
    heroes: 'Héroes', lvl: n => `Nv. ${n}`, xpOf: (a, b) => `${a} / ${b} XP`, maxLvl: 'Nivel máximo', perAll: 'Cada nivel de héroe: +4 % de daño', xpGain: n => `+${n} XP para cada héroe`, lvlUp: s => `sube de nivel: ${s}`, 'knot.fire': '¡Nudo de fuego!', 'knot.purr': '¡Nudo ronroneante!', 'knot.trash': '¡Nudo de basura!', hardName: 'Desafío', hardDesc: n => `Enemigos +40 % más duros, solo ${n} turnos. XP doble y una corona`, hardLeft: n => `Desafío: quedan ${n} turnos`, hardTurns: 'Sin turnos. Inténtalo de nuevo', hardDone: n => `¡Desafío ${n} completado!`, 'perk.mochi.5': '+20 % por rebote', 'perk.mochi.10': '+25 % por rebote', 'perk.pixel.5': '+15 % de daño al perforar', 'perk.pixel.10': 'Mirada láser: 800 de daño', 'perk.bandit.5': 'Tentempié nocturno cura 700', 'perk.bandit.10': 'Los golpes retrasan ataques 2 turnos', 'perk.nugget.5': 'Mayor radio de explosión', 'perk.nugget.10': 'Las explosiones hacen 320', 'perk.spark.5': 'El rayo hace 70 %', 'perk.spark.10': 'El rayo alcanza a dos enemigos',
    daily: 'Diario', dailyBonus: 'Bono diario', streak: n => `Racha: ${n} días`, dayShort: n => `D${n}`, challenge: 'Reto del día', 'ch.knots': n => `Gana el nivel y ata ${n} nudos`, 'ch.lasers': n => `Gana el nivel y atrapa el láser ${n} veces`, 'ch.noko': () => 'Gana el nivel sin ningún K.O.', 'ch.par': n => `Gana el nivel en ${n} turnos o menos`, 'ch.portals': n => `Gana el nivel y atraviesa cajas ${n} veces`, reward: 'Premio', chDone: 'Hecho ✓', chWon: r => `¡Reto del día cumplido! +1 ${r}`, invite: 'Invita a un amigo', inviteDesc: 'Cuando un amigo entre con tu enlace, los dos recibiréis +1 corazón y +1 inicio rápido', invited: n => `Invitados: ${n}`, inviteBtn: 'Invitar', inviteText: '¡Gatos y mapaches contra aspiradoras robot! Juega Pawsling conmigo 🐾', giftedMsg: '¡Te invitó un amigo: +1 corazón y +1 inicio rápido!', dailyTgOnly: 'Los bonos y premios funcionan cuando el juego se abre en Telegram', boardWeek: 'Semana', weekLeft: (d, h) => `Termina en ${d} d ${h} h`, weekPrizes: 'el top 3 recibe premios el lunes',
    shop: 'Tienda',
    shopTgOnly: 'La tienda funciona cuando el juego se abre en Telegram',
    equip: 'Poner',
    unequip: 'Quitar',
    inTeam: 'En el equipo',
    startLvl: 'Empezar',
    cancel: 'Cancelar',
    boosters: 'Potenciadores para este nivel',
    boostHeart: 'Corazón+',
    boostHeartD: '+1 corazón para cada héroe',
    boostMeter: 'Inicio rápido',
    boostMeterD: 'Media barra de travesura desde el inicio',
    owned: n => `tienes: ${n}`,
    'item.heart3': 'Corazón+ ×3', 'itemd.heart3': '+1 corazón para cada héroe, 3 niveles',
    'item.meter3': 'Inicio rápido ×3', 'itemd.meter3': 'Media barra de travesura al empezar, 3 niveles',
    'item.hero_spark': 'Chispa', 'itemd.hero_spark': 'Sus golpes saltan como un rayo al vecino',
    'item.hat_party': 'Gorro de fiesta', 'itemd.hat_party': 'Para todo el equipo',
    'item.hat_crown': 'Corona', 'itemd.hat_crown': 'Para todo el equipo',
    'item.hat_bow': 'Lazo', 'itemd.hat_bow': 'Para todo el equipo',
    'item.rainbow': 'Hilo arcoíris', 'itemd.rainbow': 'Los hilos brillan como un arcoíris',
    'hero.spark.name': 'Chispa', 'hero.spark.skill': 'cada golpe salta como un rayo al enemigo más cercano', 'hero.spark.combo': 'Nube de tormenta', secondWind: 'Segundo aliento', secondWindSub: 'Resistencia completa y todos los héroes en pie', secondWindGo: '¡Segundo aliento!', payWait: 'Abriendo el pago…', payFailed: 'El pago falló. Inténtalo de nuevo', langAuto: 'Automático',
    aria: 'Pawsling. Tira hacia atrás desde un héroe y suelta para lanzarlo como con un tirachinas.',
    board: 'Clasificación', boardNight: 'Turno de noche', boardStars: 'Estrellas', boardYou: 'tú', boardEmpty: 'Aún no hay nadie. ¡Sé el primero!',
    boardLoading: 'Cargando…', boardError: 'No se pudo cargar la clasificación. Revisa la conexión e inténtalo de nuevo.',
    boardTgOnly: 'La clasificación funciona cuando el juego se abre en Telegram.', boardRetry: 'Actualizar', boardPlayer: 'Jugador',
  },
};
function tr(key, ...a) {
  const v = key in I18N[LANG] ? I18N[LANG][key] : key in I18N.en ? I18N.en[key] : key;
  return typeof v === 'function' ? v(...a) : v;
}
// shrink a font until the text fits
function fitFont(text, maxW, size, weight = 900, fam = FD) {
  let s = size;
  ctx.font = `${weight} ${s}px ${fam}`;
  while (ctx.measureText(text).width > maxW && s > 9) { s--; ctx.font = `${weight} ${s}px ${fam}`; }
}
// game data reads its text through the dictionary
for (const h of HEROES) for (const f of ['name', 'skill', 'combo']) Object.defineProperty(h, f, { get: () => tr(`hero.${h.id}.${f}`), enumerable: true, configurable: true });
for (const ch of CHAPTERS) Object.defineProperty(ch, 'name', { get: () => tr('room.' + ch.key), enumerable: true, configurable: true });
LEVELS.forEach((l, i) => {
  if (!l.tip) return;
  const key = typeof l.tip === 'string' && /^[a-z]+$/.test(l.tip) ? 'tip.' + l.tip : 'tip.' + i;
  Object.defineProperty(l, 'tip', { get: () => tr(key), enumerable: true, configurable: true });
});
cv.setAttribute('aria-label', tr('aria'));
document.documentElement.lang = LANG;

// ---------- progress ----------
const PKEY = 'pawsling-progress-v1';
let PROG = { unlocked: 1, stars: {}, best: {} };
function mergeProg(a, b) {
  const r = { unlocked: Math.max(a.unlocked || 1, b.unlocked || 1), stars: { ...(a.stars || {}) }, best: { ...(a.best || {}) } };
  for (const k in (b.stars || {})) r.stars[k] = Math.max(r.stars[k] || 0, b.stars[k]);
  for (const k in (b.best || {})) r.best[k] = r.best[k] ? Math.min(r.best[k], b.best[k]) : b.best[k];
  const done = Object.keys(r.stars).map(Number).filter(n => n > 0);
  if (done.length) r.unlocked = Math.max(r.unlocked, Math.max(...done) + 1);
  r.unlocked = Math.min(LEVELS.length, r.unlocked);
  r.endless = Math.max(a.endless || 0, b.endless || 0);
  // this week's best Night Shift (the weekly tournament); an older week's best is dropped
  const wa = a.wk || '', wb = b.wk || '';
  r.wk = wa > wb ? wa : wb;
  r.wkBest = Math.max(wa === r.wk ? a.wkBest || 0 : 0, wb === r.wk ? b.wkBest || 0 : 0);
  r.xp = { ...(a.xp || {}) };
  for (const k in (b.xp || {})) r.xp[k] = Math.max(r.xp[k] || 0, b.xp[k]);
  r.hard = { ...(a.hard || {}), ...(b.hard || {}) };
  r.team = a.team || b.team;
  r.ev = { ...(a.ev || {}) };
  for (const k in (b.ev || {})) r.ev[k] = Math.max(r.ev[k] || 0, b.ev[k]);
  r.hats = { ...(a.hats || {}), ...(b.hats || {}) };
  return r;
}
function loadProg() {
  const s = lsGet(PKEY);
  if (s) { try { PROG = mergeProg(PROG, JSON.parse(s)); } catch (e) {} }
  if (TG_CLOUD) {
    try {
      TG.CloudStorage.getItem(PKEY, (err, val) => {
        if (err || !val) return;
        try { PROG = mergeProg(PROG, JSON.parse(val)); lsSet(PKEY, JSON.stringify(PROG)); } catch (e) {}
      });
    } catch (e) {}
  }
}
function saveProg() {
  const s = JSON.stringify(PROG);
  lsSet(PKEY, s);
  if (TG_CLOUD) { try { TG.CloudStorage.setItem(PKEY, s, () => {}); } catch (e) {} }
}
const totalStars = () => Object.values(PROG.stars).reduce((a, b) => a + b, 0);

// ---------- rooms: one themed floor per chapter ----------
function seeded(s) { return () => (s = (s * 16807) % 2147483647) / 2147483647; }
// Room layers are painted once on the CPU (willReadFrequently) and then frozen into an ImageBitmap:
// on some Android GPUs (Adreno 618) painting them on the GPU left big patches of bright green and cyan.
function layer(fn) {
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const b = c.getContext('2d', { willReadFrequently: true }); b.scale(2, 2); fn(b); return c;
}
function freeze(list) {
  if (!window.createImageBitmap) return;
  list.forEach((c, i) => createImageBitmap(c).then(bm => { list[i] = bm; }).catch(() => {}));
}
const frac = v => v - Math.floor(v);
function beamPt(ch, u, v) {
  const [A, B, D] = ch.beam;
  return [A[0] + u * (B[0] - A[0]) + v * (D[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (D[1] - A[1])];
}
function windowLight(b, ch, alpha) {
  for (const [u0, u1] of [[0, .47], [.53, 1]]) for (const [v0, v1] of [[0, .47], [.53, 1]]) {
    b.beginPath();
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) { const p = beamPt(ch, u, v); b.lineTo(p[0], p[1]); }
    b.closePath(); b.fillStyle = `rgba(${ch.beamCol},${alpha})`; b.fill();
  }
}
function vignette(b, rgb, a) {
  const g = b.createRadialGradient(W / 2, (TOP + BOT) / 2, 150, W / 2, (TOP + BOT) / 2, 460);
  g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(1, `rgba(${rgb},${a})`);
  b.fillStyle = g; b.fillRect(0, TOP, W, BOT - TOP);
}
function hudBars(b, ch, deco) {
  b.fillStyle = ch.hud; b.fillRect(0, 0, W, TOP); b.fillRect(0, BOT, W, H - BOT);
  b.save(); b.beginPath(); b.rect(0, 0, W, TOP); b.rect(0, BOT, W, H - BOT); b.clip(); deco(b); b.restore();
  b.fillStyle = ch.line; b.fillRect(0, TOP - 2, W, 2); b.fillRect(0, BOT, W, 2);
}
function plant(b, x, y) {
  b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.arc(x + 4, y + 5, 24, 0, TAU); b.fill();
  b.fillStyle = '#7a4a36'; b.beginPath(); b.arc(x, y, 17, 0, TAU); b.fill();
  b.fillStyle = '#4a2c20'; b.beginPath(); b.arc(x, y, 13, 0, TAU); b.fill();
  for (let k = 0; k < 7; k++) {
    const a = k * TAU / 7 + .3;
    b.save(); b.translate(x + Math.cos(a) * 12, y + Math.sin(a) * 12); b.rotate(a);
    b.fillStyle = k % 2 ? '#2e6b4a' : '#3f8a5c'; b.beginPath(); b.ellipse(4, 0, 14, 7, 0, 0, TAU); b.fill();
    b.strokeStyle = 'rgba(200,255,210,.25)'; b.lineWidth = 1; b.beginPath(); b.moveTo(-6, 0); b.lineTo(15, 0); b.stroke();
    b.restore();
  }
}

function roomKitchen(b, ch) {
  const R = seeded(7), S = 45;
  for (let y = TOP, j = 0; y < BOT; y += S, j++) for (let x = 0, i = 0; x < W; x += S, i++) {
    b.fillStyle = (i + j) % 2 ? '#3e281b' : '#2b1b13'; b.fillRect(x, y, S, S);
    b.fillStyle = 'rgba(255,225,190,.05)'; b.fillRect(x + 2, y + 2, S - 4, 3);
    if (R() < .3) { b.fillStyle = 'rgba(0,0,0,.14)'; b.fillRect(x + 4 + R() * 26, y + 6 + R() * 30, 5 + R() * 9, 1.5); }
  }
  b.fillStyle = 'rgba(0,0,0,.42)';
  for (let y = TOP; y < BOT; y += S) b.fillRect(0, y - .75, W, 1.5);
  for (let x = 0; x <= W; x += S) b.fillRect(x - .75, TOP, 1.5, BOT - TOP);
  // braided rag rug
  b.save(); b.translate(225, 385);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.ellipse(5, 8, 178, 202, 0, 0, TAU); b.fill();
  const cols = ['#5c2f18', '#7a3f1e', '#924c22', '#6a361a', '#86461f'];
  for (let k = 0; k < 13; k++) {
    const rx = 176 - k * 13, ry = 200 - k * 15;
    b.fillStyle = cols[k % cols.length]; b.beginPath(); b.ellipse(0, 0, rx, ry, 0, 0, TAU); b.fill();
    b.strokeStyle = 'rgba(255,200,150,.13)'; b.lineWidth = 3; b.setLineDash([5, 5]); b.lineDashOffset = k * 3;
    b.beginPath(); b.ellipse(0, 0, rx - 6.5, ry - 7.5, 0, 0, TAU); b.stroke();
  }
  b.setLineDash([]); b.restore();
  windowLight(b, ch, .07);
  // counter along the top wall: cutting board and a two-burner stove
  const cy = TOP, chh = 30;
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, cy + chh, W, 6);
  b.fillStyle = '#5b3a24'; b.fillRect(0, cy, W, chh);
  b.fillStyle = 'rgba(0,0,0,.13)'; for (let i = 0; i < 4; i++) b.fillRect(0, cy + 5 + i * 6, W, 1);
  b.fillStyle = '#7a5134'; b.fillRect(0, cy + chh - 3, W, 3);
  b.fillStyle = '#c99a62'; rr(40, cy + 4, 84, 21, 5, b); b.fill();
  b.fillStyle = '#5b3a24'; b.beginPath(); b.arc(116, cy + 14.5, 3, 0, TAU); b.fill();
  b.fillStyle = '#ff8c2e'; b.beginPath(); b.moveTo(52, cy + 12); b.lineTo(90, cy + 9); b.lineTo(90, cy + 18); b.closePath(); b.fill();
  b.fillStyle = '#4caf50'; b.beginPath(); b.moveTo(90, cy + 10); b.lineTo(100, cy + 6); b.lineTo(98, cy + 13); b.lineTo(102, cy + 20); b.lineTo(90, cy + 17); b.closePath(); b.fill();
  b.fillStyle = '#1f1c1a'; rr(272, cy + 2, 126, 26, 5, b); b.fill();
  for (const bx of [305, 365]) {
    b.strokeStyle = '#4a4540'; b.lineWidth = 2.5; b.beginPath(); b.arc(bx, cy + 15, 9.5, 0, TAU); b.stroke();
    b.beginPath(); b.arc(bx, cy + 15, 4.5, 0, TAU); b.stroke();
  }
  // pet bowls
  for (const [x, rim, fill] of [[32, '#b8452e', '#6a2418'], [418, '#3f7fb8', '#7ec8e3']]) {
    b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.ellipse(x + 3, BOT - 26, 20, 16, 0, 0, TAU); b.fill();
    b.fillStyle = rim; b.beginPath(); b.ellipse(x, BOT - 30, 19, 15, 0, 0, TAU); b.fill();
    b.fillStyle = fill; b.beginPath(); b.ellipse(x, BOT - 30, 12, 9, 0, 0, TAU); b.fill();
  }
  b.fillStyle = '#a0612c'; for (const [dx, dy] of [[-4, -2], [3, -3], [0, 2], [5, 2], [-5, 3]]) { b.beginPath(); b.arc(32 + dx, BOT - 30 + dy, 2.2, 0, TAU); b.fill(); }
  b.fillStyle = 'rgba(255,255,255,.55)'; b.beginPath(); b.ellipse(414, BOT - 33, 4, 2, -.4, 0, TAU); b.fill();
  vignette(b, '20,8,2', .5);
  hudBars(b, ch, c => {
    c.fillStyle = 'rgba(255,190,120,.04)';
    for (let y = 0; y < H; y += 10) for (let x = (y / 10) % 2 * 10; x < W; x += 20) c.fillRect(x, y, 10, 10);
  });
}

function roomLiving(b, ch) {
  const R = seeded(11), C = 30, hh = 14, sl = 10;
  const pal = ['#3a2b49', '#34273f', '#3f2f4e', '#2f2339', '#382a45'];
  for (let c = 0, x = 0; x < W; x += C, c++) {
    const dir = c % 2 ? 1 : -1;
    for (let y = TOP - 30; y < BOT + 20; y += hh) {
      b.beginPath(); b.moveTo(x, y); b.lineTo(x + C, y + dir * sl); b.lineTo(x + C, y + dir * sl + hh); b.lineTo(x, y + hh); b.closePath();
      b.fillStyle = pal[Math.floor(R() * pal.length)]; b.fill();
      b.strokeStyle = 'rgba(0,0,0,.3)'; b.lineWidth = 1; b.stroke();
    }
  }
  // persian carpet
  const X = 40, Y = 138, CW = 370, CH = 470;
  b.fillStyle = 'rgba(0,0,0,.4)'; rr(X + 5, Y + 7, CW, CH, 6, b); b.fill();
  b.strokeStyle = 'rgba(217,196,255,.45)'; b.lineWidth = 1.5;
  for (let x = X + 8; x < X + CW - 6; x += 5) {
    b.beginPath(); b.moveTo(x, Y); b.lineTo(x + Math.sin(x) * 1.5, Y - 7); b.stroke();
    b.beginPath(); b.moveTo(x, Y + CH); b.lineTo(x + Math.cos(x) * 1.5, Y + CH + 7); b.stroke();
  }
  b.fillStyle = '#4b2a73'; rr(X, Y, CW, CH, 6, b); b.fill();
  b.fillStyle = '#5d3a8f'; b.fillRect(X + 6, Y + 6, CW - 12, CH - 12);
  b.fillStyle = '#34205a'; b.fillRect(X + 26, Y + 26, CW - 52, CH - 52);
  const dia = (x, y, s, col) => { b.fillStyle = col; b.beginPath(); b.moveTo(x, y - s); b.lineTo(x + s, y); b.lineTo(x, y + s); b.lineTo(x - s, y); b.closePath(); b.fill(); };
  for (let x = X + 16; x <= X + CW - 16; x += 17.4) { dia(x, Y + 16, 5, 'rgba(177,140,255,.55)'); dia(x, Y + CH - 16, 5, 'rgba(177,140,255,.55)'); }
  for (let y = Y + 33; y <= Y + CH - 33; y += 17.4) { dia(X + 16, y, 5, 'rgba(177,140,255,.55)'); dia(X + CW - 16, y, 5, 'rgba(177,140,255,.55)'); }
  b.strokeStyle = 'rgba(217,196,255,.3)'; b.lineWidth = 1.5;
  b.strokeRect(X + 6, Y + 6, CW - 12, CH - 12); b.strokeRect(X + 26, Y + 26, CW - 52, CH - 52);
  b.strokeStyle = 'rgba(177,140,255,.09)'; b.lineWidth = 1;
  for (let y = Y + 50; y < Y + CH - 40; y += 28) for (let x = X + 50 + ((y - Y) / 28 % 2) * 14; x < X + CW - 40; x += 28) {
    b.beginPath(); b.moveTo(x, y - 6); b.lineTo(x + 6, y); b.lineTo(x, y + 6); b.lineTo(x - 6, y); b.closePath(); b.stroke();
  }
  for (const [cx, cy, a0] of [[X + 26, Y + 26, 0], [X + CW - 26, Y + 26, Math.PI / 2], [X + CW - 26, Y + CH - 26, Math.PI], [X + 26, Y + CH - 26, Math.PI * 1.5]]) {
    b.fillStyle = 'rgba(93,58,143,.8)'; b.beginPath(); b.moveTo(cx, cy); b.arc(cx, cy, 36, a0, a0 + Math.PI / 2); b.closePath(); b.fill();
    b.fillStyle = 'rgba(177,140,255,.35)'; b.beginPath(); b.moveTo(cx, cy); b.arc(cx, cy, 20, a0, a0 + Math.PI / 2); b.closePath(); b.fill();
  }
  b.save(); b.translate(225, 373);
  dia(0, 0, 118, 'rgba(93,58,143,.75)'); dia(0, 0, 92, '#4b2a73');
  b.rotate(Math.PI / 4); b.fillStyle = 'rgba(123,82,181,.55)'; b.fillRect(-50, -50, 100, 100); b.rotate(-Math.PI / 4);
  b.fillStyle = 'rgba(123,82,181,.55)'; b.fillRect(-50, -50, 100, 100);
  dia(0, 0, 40, 'rgba(177,140,255,.45)'); dia(0, 0, 16, 'rgba(255,209,102,.5)');
  b.restore();
  windowLight(b, ch, .055);
  // TV on the left wall, lamp and plants in the corners
  b.fillStyle = '#0c0a14'; b.fillRect(0, 330, 10, 110);
  b.fillStyle = 'rgba(110,195,255,.7)'; b.fillRect(8, 334, 2, 102);
  plant(b, 28, TOP + 30); plant(b, W - 28, TOP + 30);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.arc(W - 22, BOT - 20, 20, 0, TAU); b.fill();
  b.fillStyle = '#e8d8b0'; b.beginPath(); b.arc(W - 26, BOT - 24, 17, 0, TAU); b.fill();
  b.strokeStyle = '#b8a47a'; b.lineWidth = 2; b.beginPath(); b.arc(W - 26, BOT - 24, 11, 0, TAU); b.stroke();
  vignette(b, '10,4,24', .55);
  hudBars(b, ch, c => {
    c.fillStyle = 'rgba(177,140,255,.06)';
    for (let y = 8; y < H; y += 16) for (let x = 8 + (y / 16 % 2) * 8; x < W; x += 16) { c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x + 3, y); c.lineTo(x, y + 3); c.lineTo(x - 3, y); c.fill(); }
  });
}

function crescent(c, x, y, r, col) {
  c.save(); c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
  c.beginPath(); c.rect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4); c.arc(x + r * .45, y - r * .3, r * .85, 0, TAU, true);
  c.fillStyle = col; c.fill(); c.restore();
}

function roomBedroom(b, ch) {
  const R = seeded(23), PH = 52;
  for (let y = TOP, j = 0; y < BOT; y += PH, j++) {
    b.fillStyle = j % 2 ? '#10242c' : '#0e1f27'; b.fillRect(0, y, W, PH);
    b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, y, W, 1.5);
    for (let x = (j * 131) % 170; x < W; x += 150 + R() * 80) b.fillRect(x, y, 1.5, PH);
    b.strokeStyle = 'rgba(160,220,230,.035)'; b.lineWidth = 1;
    for (let g = 0; g < 3; g++) { b.beginPath(); b.moveTo(0, y + 12 + g * 14); for (let gx = 0; gx <= W; gx += 25) b.lineTo(gx, y + 12 + g * 14 + Math.sin(gx * .04 + j + g) * 2.5); b.stroke(); }
  }
  windowLight(b, ch, .12);
  // fluffy round rug with a sleeping moon
  b.fillStyle = 'rgba(0,0,0,.4)'; b.beginPath(); b.ellipse(230, 398, 170, 190, 0, 0, TAU); b.fill();
  b.fillStyle = '#173a42'; b.beginPath(); b.ellipse(225, 390, 166, 186, 0, 0, TAU); b.fill();
  b.lineCap = 'round'; b.lineWidth = 2;
  const fur = ['#1e4a53', '#12313a', '#265c66', '#1a434c'];
  for (let i = 0; i < 2200; i++) {
    const a = R() * TAU, rr0 = Math.sqrt(R()) * 1.02, x = 225 + Math.cos(a) * 166 * rr0, y = 390 + Math.sin(a) * 186 * rr0, fa = R() * TAU, l = 3 + R() * 5;
    b.strokeStyle = fur[i % 4]; b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(fa) * l, y + Math.sin(fa) * l); b.stroke();
  }
  crescent(b, 215, 395, 62, 'rgba(92,225,198,.28)');
  b.globalAlpha = .45;
  for (const [x, y, r] of [[300, 320, 9], [150, 300, 6], [310, 460, 7], [135, 470, 5], [260, 250, 5]]) star(x, y, r, '#5ce1c6', null, b);
  b.globalAlpha = 1;
  // quilt at the foot of the bed
  b.fillStyle = 'rgba(0,0,0,.4)'; b.fillRect(0, TOP + 44, W, 8);
  for (let x = 0, i = 0; x < W; x += 30, i++) for (let y = TOP, j = 0; y < TOP + 44; y += 22, j++) {
    b.fillStyle = (i + j) % 2 ? '#1d4652' : '#245463'; b.fillRect(x, y, 30, 22);
  }
  b.strokeStyle = 'rgba(255,255,255,.14)'; b.lineWidth = 1; b.setLineDash([3, 3]);
  for (let x = 30; x < W; x += 30) { b.beginPath(); b.moveTo(x, TOP); b.lineTo(x, TOP + 44); b.stroke(); }
  b.beginPath(); b.moveTo(0, TOP + 22); b.lineTo(W, TOP + 22); b.stroke(); b.setLineDash([]);
  b.fillStyle = '#245463';
  for (let x = 0; x < W; x += 15) { b.beginPath(); b.arc(x + 7.5, TOP + 44, 7.5, 0, Math.PI); b.fill(); }
  // slippers and a night light
  for (const [x, y, a] of [[398, 566, -.25], [424, 580, -.05]]) {
    b.save(); b.translate(x, y); b.rotate(a);
    b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.ellipse(2, 3, 9, 16, 0, 0, TAU); b.fill();
    b.fillStyle = '#e8a0b4'; b.beginPath(); b.ellipse(0, 0, 9, 16, 0, 0, TAU); b.fill();
    b.fillStyle = '#f7d4de'; b.beginPath(); b.ellipse(0, 4, 5.5, 9, 0, 0, TAU); b.fill();
    b.fillStyle = '#fff'; b.beginPath(); b.arc(0, -11, 4, 0, TAU); b.fill();
    b.restore();
  }
  b.fillStyle = '#ffe8a3'; b.beginPath(); b.arc(22, BOT - 22, 8, 0, TAU); b.fill();
  vignette(b, '2,8,14', .7);
  hudBars(b, ch, c => {
    const r2 = seeded(5);
    for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(207,232,255,${.08 + r2() * .2})`; c.fillRect(r2() * W, r2() * H, 1.3, 1.3); }
  });
}
function roomBath(b, ch) {
  const R = seeded(31), S = 30;
  for (let y = TOP, j = 0; y < BOT; y += S, j++) for (let x = 0, i = 0; x < W; x += S, i++) {
    b.fillStyle = (i + j) % 2 ? '#16283a' : '#1a2f44'; b.fillRect(x, y, S, S);
    b.fillStyle = 'rgba(200,235,255,.05)'; b.fillRect(x + 2, y + 2, S - 4, 2);
  }
  b.fillStyle = 'rgba(0,0,0,.4)';
  for (let y = TOP; y < BOT; y += S) b.fillRect(0, y - .6, W, 1.2);
  for (let x = 0; x <= W; x += S) b.fillRect(x - .6, TOP, 1.2, BOT - TOP);
  // fluffy round bath mat
  b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.ellipse(230, 404, 150, 166, 0, 0, TAU); b.fill();
  b.fillStyle = '#1f4d6b'; b.beginPath(); b.ellipse(225, 396, 148, 162, 0, 0, TAU); b.fill();
  b.lineCap = 'round'; b.lineWidth = 2;
  const fur = ['#2a6189', '#1b4663', '#347199', '#23577a'];
  for (let i = 0; i < 1600; i++) {
    const a = R() * TAU, k = Math.sqrt(R()), x = 225 + Math.cos(a) * 148 * k, y = 396 + Math.sin(a) * 162 * k, fa = R() * TAU, l = 3 + R() * 4;
    b.strokeStyle = fur[i % 4]; b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(fa) * l, y + Math.sin(fa) * l); b.stroke();
  }
  b.lineWidth = 2.5;
  for (const [x, y, r] of [[190, 360, 26], [262, 420, 18], [230, 330, 10], [175, 440, 12], [285, 350, 8]]) {
    b.strokeStyle = 'rgba(191,230,255,.3)'; b.beginPath(); b.arc(x, y, r, 0, TAU); b.stroke();
    b.fillStyle = 'rgba(255,255,255,.25)'; b.beginPath(); b.arc(x - r * .35, y - r * .35, r * .18, 0, TAU); b.fill();
  }
  windowLight(b, ch, .06);
  // bathtub along the top wall, with foam and a rubber duck
  const ty = TOP;
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, ty + 46, W, 7);
  b.fillStyle = '#dfe9f2'; rr(-10, ty - 12, W + 20, 58, 18, b); b.fill();
  b.fillStyle = '#b9ccdc'; b.fillRect(0, ty + 40, W, 6);
  b.fillStyle = '#5fa4d6'; rr(16, ty + 2, W - 32, 32, 12, b); b.fill();
  b.fillStyle = 'rgba(255,255,255,.18)'; rr(22, ty + 5, W - 44, 8, 5, b); b.fill();
  for (let i = 0; i < 26; i++) { b.fillStyle = `rgba(255,255,255,${.5 + R() * .4})`; b.beginPath(); b.arc(40 + R() * 280, ty + 6 + R() * 22, 3 + R() * 6, 0, TAU); b.fill(); }
  b.fillStyle = '#c9d3dd'; rr(8, ty + 10, 20, 10, 4, b); b.fill(); b.fillStyle = '#9aa7b4'; b.fillRect(22, ty + 14, 10, 5);
  b.fillStyle = '#ffd23f'; b.beginPath(); b.ellipse(372, ty + 20, 15, 10, 0, 0, TAU); b.fill();
  b.beginPath(); b.arc(384, ty + 11, 8, 0, TAU); b.fill();
  b.fillStyle = '#ff8c2e'; b.beginPath(); b.moveTo(391, ty + 10); b.lineTo(399, ty + 12); b.lineTo(391, ty + 15); b.closePath(); b.fill();
  b.fillStyle = '#1b1b22'; b.beginPath(); b.arc(386, ty + 9, 1.6, 0, TAU); b.fill();
  // drain and a striped towel on the right wall
  b.fillStyle = '#8aa0b4'; b.beginPath(); b.arc(225, BOT - 38, 10, 0, TAU); b.fill();
  b.fillStyle = '#3a4a5a';
  for (const [dx, dy] of [[-3, -3], [3, -3], [0, 0], [-3, 3], [3, 3]]) { b.beginPath(); b.arc(225 + dx, BOT - 38 + dy, 1.4, 0, TAU); b.fill(); }
  for (let i = 0; i < 6; i++) { b.fillStyle = i % 2 ? '#f4efe6' : '#ff8fb1'; b.fillRect(W - 14, 300 + i * 22, 14, 22); }
  b.fillStyle = 'rgba(0,0,0,.3)'; b.fillRect(W - 18, 300, 4, 132);
  vignette(b, '2,8,18', .6);
  hudBars(b, ch, c => {
    const r2 = seeded(9); c.strokeStyle = 'rgba(110,195,255,.09)'; c.lineWidth = 1.2;
    for (let i = 0; i < 50; i++) { c.beginPath(); c.arc(r2() * W, r2() * H, 2 + r2() * 5, 0, TAU); c.stroke(); }
  });
}

function roomBalcony(b, ch) {
  const R = seeded(41), PW = 36;
  for (let x = 0, i = 0; x < W; x += PW, i++) {
    b.fillStyle = i % 2 ? '#3a2a1c' : '#33251a'; b.fillRect(x, TOP, PW, BOT - TOP);
    b.fillStyle = 'rgba(0,0,0,.45)'; b.fillRect(x, TOP, 2, BOT - TOP);
    for (let y = TOP + (i * 97) % 140; y < BOT; y += 160 + R() * 80) b.fillRect(x, y, PW, 1.5);
    b.strokeStyle = 'rgba(255,220,180,.04)'; b.lineWidth = 1;
    for (let g = 0; g < 3; g++) {
      b.beginPath(); b.moveTo(x + 8 + g * 9, TOP);
      for (let gy = TOP; gy <= BOT; gy += 30) b.lineTo(x + 8 + g * 9 + Math.sin(gy * .05 + i + g) * 2, gy);
      b.stroke();
    }
  }
  // night sky and the city behind the railing
  const sy = TOP, sh = 60;
  const sg = b.createLinearGradient(0, sy, 0, sy + sh); sg.addColorStop(0, '#0b1430'); sg.addColorStop(1, '#23305a');
  b.fillStyle = sg; b.fillRect(0, sy, W, sh);
  for (let i = 0; i < 30; i++) { b.fillStyle = `rgba(230,240,255,${.3 + R() * .6})`; b.fillRect(R() * W, sy + R() * 26, 1.3, 1.3); }
  for (let x = 0; x < W; x += 22 + R() * 18) {
    const bh = 14 + R() * 26, bw = 18 + R() * 16;
    b.fillStyle = '#121a33'; b.fillRect(x, sy + sh - bh, bw, bh);
    for (let wy = sy + sh - bh + 4; wy < sy + sh - 3; wy += 6) for (let wx = x + 3; wx < x + bw - 3; wx += 5) {
      if (R() < .35) { b.fillStyle = 'rgba(255,214,120,.7)'; b.fillRect(wx, wy, 2, 3); }
    }
  }
  b.fillStyle = '#6b4a30'; b.fillRect(0, sy + sh, W, 7);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, sy + sh + 7, W, 6);
  b.fillStyle = '#5a3d27'; for (let x = 6; x < W; x += 18) b.fillRect(x, sy, 4, sh);
  b.fillStyle = '#7a5638'; b.fillRect(0, sy, W, 4);
  // striped outdoor rug
  b.fillStyle = 'rgba(0,0,0,.4)'; rr(100, 256, 260, 262, 8, b); b.fill();
  for (let i = 0; i < 13; i++) { b.fillStyle = i % 2 ? '#2f5a3a' : '#3f7a4a'; b.fillRect(95, 250 + i * 20, 260, 20); }
  b.strokeStyle = 'rgba(232,255,208,.3)'; b.lineWidth = 1.5; b.strokeRect(101, 256, 248, 248);
  b.strokeStyle = 'rgba(232,255,208,.4)';
  for (let x = 100; x < 352; x += 5) { b.beginPath(); b.moveTo(x, 250); b.lineTo(x, 243); b.moveTo(x, 510); b.lineTo(x, 517); b.stroke(); }
  windowLight(b, ch, .04);
  plant(b, 30, BOT - 40); plant(b, W - 30, BOT - 40); plant(b, W - 30, TOP + 100);
  // deck chair
  b.save(); b.translate(46, 190); b.rotate(.12);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(-22, -38, 50, 84);
  for (let i = 0; i < 6; i++) { b.fillStyle = i % 2 ? '#f4efe6' : '#ff6b6b'; b.fillRect(-26, -42 + i * 14, 46, 14); }
  b.strokeStyle = '#8a6a48'; b.lineWidth = 3; b.strokeRect(-26, -42, 46, 84);
  b.restore();
  vignette(b, '4,10,4', .55);
  hudBars(b, ch, c => {
    const r2 = seeded(13); c.fillStyle = 'rgba(158,224,106,.07)';
    for (let i = 0; i < 40; i++) { c.save(); c.translate(r2() * W, r2() * H); c.rotate(r2() * TAU); c.beginPath(); c.ellipse(0, 0, 5, 2.2, 0, 0, TAU); c.fill(); c.restore(); }
  });
}

function crate(b, x, y, w, h, a) {
  b.save(); b.translate(x, y); b.rotate(a);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(-w / 2 + 5, -h / 2 + 6, w, h);
  b.fillStyle = '#b07a45'; b.fillRect(-w / 2, -h / 2, w, h);
  b.fillStyle = 'rgba(0,0,0,.15)'; b.fillRect(-w / 2, -h / 2 + h * .48, w, h * .04);
  b.fillStyle = '#d9b27a'; b.fillRect(-w * .1, -h / 2, w * .2, h);
  b.strokeStyle = 'rgba(0,0,0,.3)'; b.lineWidth = 1.5; b.strokeRect(-w / 2, -h / 2, w, h);
  b.restore();
}
function roomAttic(b, ch) {
  const R = seeded(53), PH = 40;
  for (let y = TOP, j = 0; y < BOT; y += PH, j++) {
    b.fillStyle = j % 2 ? '#2e2117' : '#2a1e15'; b.fillRect(0, y, W, PH);
    b.fillStyle = 'rgba(0,0,0,.4)'; b.fillRect(0, y, W, 1.5);
    for (let x = (j * 113) % 190; x < W; x += 170 + R() * 90) b.fillRect(x, y, 1.5, PH);
    for (let k = 0; k < 2; k++) { b.fillStyle = 'rgba(0,0,0,.2)'; b.beginPath(); b.ellipse(R() * W, y + 10 + R() * 20, 5, 2.5, 0, 0, TAU); b.fill(); }
  }
  // shadows of the roof beams
  b.fillStyle = 'rgba(0,0,0,.2)';
  for (let k = 0; k < 4; k++) {
    const x0 = -120 + k * 150;
    b.beginPath(); b.moveTo(x0, TOP); b.lineTo(x0 + 40, TOP); b.lineTo(x0 + 190, BOT); b.lineTo(x0 + 150, BOT); b.closePath(); b.fill();
  }
  windowLight(b, ch, .1);
  // oval rag rug
  b.save(); b.translate(225, 400);
  b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.ellipse(5, 7, 160, 150, 0, 0, TAU); b.fill();
  const cols = ['#5a3a2a', '#6e4a34', '#4e3224', '#7a5540'];
  for (let k = 0; k < 10; k++) { b.fillStyle = cols[k % 4]; b.beginPath(); b.ellipse(0, 0, 158 - k * 15, 148 - k * 14, 0, 0, TAU); b.fill(); }
  b.restore();
  // old trunk against the top wall, crates in the corners
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(152, TOP + 8, 150, 44);
  b.fillStyle = '#5a3a22'; rr(148, TOP + 2, 150, 42, 8, b); b.fill();
  b.fillStyle = '#b08850'; for (const x of [168, 218, 268]) b.fillRect(x, TOP + 2, 7, 42);
  b.fillStyle = '#d9b27a'; rr(214, TOP + 20, 15, 12, 3, b); b.fill();
  crate(b, 34, TOP + 40, 50, 46, -.08); crate(b, 44, TOP + 88, 40, 36, .1);
  crate(b, W - 36, BOT - 44, 52, 48, .06); crate(b, W - 84, BOT - 30, 38, 34, -.12);
  // cobwebs in the top corners
  b.strokeStyle = 'rgba(255,255,255,.1)'; b.lineWidth = 1;
  for (const [cx, sx] of [[0, 1], [W, -1]]) {
    for (let k = 0; k < 5; k++) { const a = k / 4 * Math.PI / 2; b.beginPath(); b.moveTo(cx, TOP); b.lineTo(cx + sx * Math.cos(a) * 70, TOP + Math.sin(a) * 70); b.stroke(); }
    for (const rad of [22, 40, 58]) { b.beginPath(); b.arc(cx, TOP, rad, sx > 0 ? 0 : Math.PI / 2, sx > 0 ? Math.PI / 2 : Math.PI); b.stroke(); }
  }
  vignette(b, '10,6,2', .65);
  hudBars(b, ch, c => {
    c.fillStyle = 'rgba(255,176,112,.05)';
    for (let y = 6; y < H; y += 14) for (let x = (y / 14 % 2) * 20; x < W; x += 40) c.fillRect(x, y, 26, 3);
  });
}
function roomGarage(b, ch) {
  const R = seeded(67);
  b.fillStyle = '#2a2d33'; b.fillRect(0, TOP, W, BOT - TOP);
  for (let i = 0; i < 2500; i++) { b.fillStyle = `rgba(${R() < .5 ? '255,255,255' : '0,0,0'},${.03 + R() * .05})`; b.fillRect(R() * W, TOP + R() * (BOT - TOP), 2, 2); }
  b.fillStyle = 'rgba(0,0,0,.35)';
  for (let y = TOP + 150; y < BOT; y += 150) b.fillRect(0, y, W, 2);
  b.fillRect(W / 2 - 1, TOP + 50, 2, BOT - TOP - 50);
  // parking bay
  b.fillStyle = 'rgba(255,209,102,.5)';
  b.fillRect(58, 170, 8, 380); b.fillRect(W - 66, 170, 8, 380);
  for (let x = 66; x < W - 66; x += 34) b.fillRect(x, 546, 20, 6);
  // oil stains
  for (const [x, y, rx, ry] of [[180, 330, 52, 30], [272, 420, 34, 22], [150, 470, 22, 14], [320, 250, 18, 12]]) {
    const g = b.createRadialGradient(x, y, 2, x, y, rx);
    g.addColorStop(0, 'rgba(8,8,12,.6)'); g.addColorStop(1, 'rgba(8,8,12,0)');
    b.fillStyle = g; b.beginPath(); b.ellipse(x, y, rx, ry, .3, 0, TAU); b.fill();
  }
  windowLight(b, ch, .05);
  // workbench with tools along the top wall
  const ty = TOP;
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, ty + 42, W, 7);
  b.fillStyle = '#6b4a30'; b.fillRect(0, ty, W, 42);
  b.fillStyle = '#7d5838'; b.fillRect(0, ty + 36, W, 6);
  b.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < 5; i++) b.fillRect(0, ty + 5 + i * 7, W, 1);
  b.strokeStyle = '#b9c3cf'; b.lineWidth = 5; b.lineCap = 'round';
  b.beginPath(); b.moveTo(52, ty + 12); b.lineTo(104, ty + 27); b.stroke();
  b.lineWidth = 3; b.beginPath(); b.arc(46, ty + 10, 7, .6, 5.6); b.stroke();
  b.fillStyle = '#c99a62'; b.save(); b.translate(150, ty + 20); b.rotate(-.3); b.fillRect(-4, -2, 44, 5); b.fillStyle = '#8a96a3'; b.fillRect(36, -8, 9, 17); b.restore();
  b.fillStyle = '#d9423f'; rr(300, ty + 6, 76, 28, 4, b); b.fill();
  b.fillStyle = '#a82e2b'; b.fillRect(300, ty + 16, 76, 3);
  b.strokeStyle = '#2a2d33'; b.lineWidth = 3; b.beginPath(); b.moveTo(326, ty + 6); b.lineTo(326, ty + 1); b.lineTo(350, ty + 1); b.lineTo(350, ty + 6); b.stroke();
  b.fillStyle = '#b9c3cf'; for (const [x, y] of [[220, 14], [232, 22], [245, 12], [258, 26]]) { b.beginPath(); b.arc(x, ty + y, 2.2, 0, TAU); b.fill(); }
  // stacked tyres and a jerry can
  for (let k = 0; k < 3; k++) {
    const x = W - 42 + k * 2, y = BOT - 46 - k * 5;
    b.fillStyle = 'rgba(0,0,0,.35)'; b.beginPath(); b.arc(x + 3, y + 5, 30, 0, TAU); b.fill();
    b.fillStyle = '#1b1b1f'; b.beginPath(); b.arc(x, y, 30, 0, TAU); b.fill();
    b.strokeStyle = '#2e2e35'; b.lineWidth = 3; b.beginPath(); b.arc(x, y, 24, 0, TAU); b.stroke();
    b.fillStyle = '#8a96a3'; b.beginPath(); b.arc(x, y, 12, 0, TAU); b.fill();
    b.fillStyle = '#5a6470'; b.beginPath(); b.arc(x, y, 5, 0, TAU); b.fill();
  }
  b.fillStyle = 'rgba(0,0,0,.35)'; rr(24, BOT - 76, 38, 50, 6, b); b.fill();
  b.fillStyle = '#c0392b'; rr(20, BOT - 80, 38, 50, 6, b); b.fill();
  b.strokeStyle = '#8e2a20'; b.lineWidth = 2; b.beginPath(); b.moveTo(24, BOT - 76); b.lineTo(54, BOT - 34); b.moveTo(54, BOT - 76); b.lineTo(24, BOT - 34); b.stroke();
  b.fillStyle = '#e8e8e8'; b.fillRect(44, BOT - 88, 8, 9);
  // hazard stripe along the door
  b.save(); b.beginPath(); b.rect(0, BOT - 10, W, 10); b.clip();
  b.fillStyle = '#ffc857'; b.fillRect(0, BOT - 10, W, 10);
  b.fillStyle = '#15122a';
  for (let x = -20; x < W + 20; x += 20) { b.beginPath(); b.moveTo(x, BOT); b.lineTo(x + 10, BOT); b.lineTo(x + 20, BOT - 10); b.lineTo(x + 10, BOT - 10); b.closePath(); b.fill(); }
  b.restore();
  vignette(b, '6,6,10', .6);
  hudBars(b, ch, c => {
    c.fillStyle = 'rgba(255,209,102,.05)';
    for (let x = -60; x < W + 60; x += 28) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 12, 0); c.lineTo(x + 12 + H * .3, H); c.lineTo(x + H * .3, H); c.fill(); }
  });
}
function roomBasement(b, ch) {
  const R = seeded(83);
  b.fillStyle = '#1c2019'; b.fillRect(0, TOP, W, BOT - TOP);
  // irregular flagstones
  for (let y = TOP, j = 0; y < BOT; y += 58, j++) {
    for (let x = -(j % 2) * 40, i = 0; x < W; i++) {
      const w = 70 + R() * 50, h = 54;
      const c = 30 + R() * 14 | 0;
      b.fillStyle = `rgb(${c},${c + 4},${c - 2})`; rr(x + 2, y + 2, w - 4, h - 4, 6, b); b.fill();
      b.fillStyle = 'rgba(255,255,255,.035)'; rr(x + 4, y + 4, w - 8, 5, 3, b); b.fill();
      if (R() < .35) { b.fillStyle = 'rgba(143,209,79,.06)'; b.beginPath(); b.ellipse(x + R() * w, y + R() * h, 10 + R() * 14, 5 + R() * 6, R() * 3, 0, TAU); b.fill(); }
      x += w;
    }
  }
  windowLight(b, ch, .07);
  // pipes and valves along the top wall
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, TOP + 30, W, 6);
  for (const [y, col] of [[TOP + 6, '#6b5a48'], [TOP + 20, '#586070']]) {
    b.fillStyle = col; b.fillRect(0, y, W, 9);
    b.fillStyle = 'rgba(255,255,255,.15)'; b.fillRect(0, y + 1, W, 2);
    for (let x = 40; x < W; x += 110) { b.fillStyle = '#3a3f4d'; b.fillRect(x, y - 2, 8, 13); }
  }
  for (const x of [120, 300]) {
    b.fillStyle = '#b83a3a'; b.beginPath(); b.arc(x, TOP + 24, 9, 0, TAU); b.fill();
    b.strokeStyle = '#7a2222'; b.lineWidth = 2; b.beginPath(); b.moveTo(x - 7, TOP + 24); b.lineTo(x + 7, TOP + 24); b.moveTo(x, TOP + 17); b.lineTo(x, TOP + 31); b.stroke();
  }
  // shelves with jars on the left, a boiler in the right corner
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(4, 250, 38, 150);
  b.fillStyle = '#5a4430'; for (const y of [250, 300, 350, 398]) b.fillRect(0, y, 40, 5);
  for (let k = 0; k < 9; k++) {
    const x = 6 + (k % 3) * 11, y = 262 + Math.floor(k / 3) * 50;
    b.fillStyle = ['rgba(255,160,60,.7)', 'rgba(160,220,90,.7)', 'rgba(200,60,80,.7)'][k % 3]; rr(x, y + 12, 9, 24, 3, b); b.fill();
    b.fillStyle = '#c9c2b0'; b.fillRect(x, y + 10, 9, 4);
  }
  b.fillStyle = 'rgba(0,0,0,.4)'; rr(W - 78, BOT - 150, 76, 132, 10, b); b.fill();
  b.fillStyle = '#4a5060'; rr(W - 82, BOT - 156, 76, 132, 10, b); b.fill();
  b.fillStyle = '#2a2d33'; rr(W - 72, BOT - 120, 56, 40, 6, b); b.fill();
  b.fillStyle = 'rgba(255,120,40,.55)'; rr(W - 66, BOT - 112, 44, 24, 4, b); b.fill();
  b.fillStyle = '#c9d3dd'; b.beginPath(); b.arc(W - 44, BOT - 138, 10, 0, TAU); b.fill();
  b.strokeStyle = '#2a2d33'; b.lineWidth = 2; b.beginPath(); b.moveTo(W - 44, BOT - 138); b.lineTo(W - 38, BOT - 144); b.stroke();
  // a big cobweb in the top-left corner
  b.strokeStyle = 'rgba(235,240,245,.16)'; b.lineWidth = 1;
  for (let k = 0; k < 7; k++) { const a = k / 6 * Math.PI / 2; b.beginPath(); b.moveTo(0, TOP + 36); b.lineTo(Math.cos(a) * 130, TOP + 36 + Math.sin(a) * 130); b.stroke(); }
  for (const rad of [30, 58, 86, 112]) { b.beginPath(); b.arc(0, TOP + 36, rad, 0, Math.PI / 2); b.stroke(); }
  vignette(b, '2,4,0', .75);
  hudBars(b, ch, c => {
    c.strokeStyle = 'rgba(143,209,79,.06)'; c.lineWidth = 1;
    for (let x = 0; x < W; x += 48) for (let y = 0; y < H; y += 48) { c.beginPath(); c.arc(x, y, 14, 0, TAU); c.stroke(); }
  });
}
const ROOMS = [roomKitchen, roomLiving, roomBedroom, roomBath, roomBalcony, roomAttic, roomGarage, roomBasement];
const BGS = CHAPTERS.map((ch, i) => layer(b => { b.fillStyle = ch.hud; b.fillRect(0, 0, W, H); ROOMS[i](b, ch); }));
freeze(BGS);

// animated room life: drawn under the actors (steam, TV glow, moonbeam) and over them (motes, fireflies)
function glowAt(x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function flick(t, k = 0) { return .5 + .25 * Math.sin(t * 9 + k) + .15 * Math.sin(t * 23 + k * 3) + .1 * Math.sin(t * 41 + k); }
function drawRoomUnder(c) {
  if (LOWFX) return;
  const t = RM ? 0 : T;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (c === 0) {
    for (const [bx, k] of [[305, 0], [365, 1.7]]) {
      const f = flick(t, k);
      glowAt(bx, TOP + 15, 30, '255,110,30', .45 * f);
      ctx.strokeStyle = `rgba(255,${120 + 60 * f | 0},50,${.45 + .45 * f})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx, TOP + 15, 9.5, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 8; k++) {
      const ph = frac(t * .3 + k / 8), x = (k % 2 ? 305 : 365) + Math.sin(ph * 6 + k) * 10 + ph * 18, y = TOP + 20 + ph * 80;
      ctx.fillStyle = `rgba(255,240,225,${.09 * Math.sin(ph * Math.PI)})`; circ(x, y, 5 + ph * 18);
    }
  } else if (c === 1) {
    const cols = ['110,195,255', '177,140,255', '255,143,177', '92,225,198'];
    const rgb = cols[Math.floor(t / 1.6) % 4], f = flick(t * .6);
    const g = ctx.createRadialGradient(10, 385, 0, 10, 385, 230);
    g.addColorStop(0, `rgba(${rgb},${.16 * f + .05})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(10, 330); ctx.lineTo(240, 230); ctx.lineTo(240, 540); ctx.lineTo(10, 440); ctx.closePath(); ctx.fill();
    glowAt(W - 26, BOT - 24, 70, '255,210,140', .16 + .03 * Math.sin(t * 2));
  } else if (c === 3) {
    for (let k = 0; k < 5; k++) {
      const x = 40 + frac(k * .31 + t * .05) * 330;
      ctx.fillStyle = `rgba(200,240,255,${.12 + .08 * Math.sin(t * 2 + k)})`; ctx.fillRect(x, TOP + 6 + (k % 3) * 8, 26, 2);
    }
    const ph = frac(t * .6);
    ctx.strokeStyle = `rgba(200,240,255,${.5 * (1 - ph)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(40, TOP + 24, 3 + ph * 14, 1.5 + ph * 5, 0, 0, TAU); ctx.stroke();
  } else if (c === 4) {
    const cols = ['255,209,102', '255,143,177', '158,224,106', '110,195,255'];
    for (let k = 0; k < 14; k++) {
      const x = 16 + k * 31, y = TOP + 64 + Math.sin(k * 1.3) * 4, tw = .55 + .45 * Math.sin(t * 2.1 + k * 1.7);
      glowAt(x, y, 16, cols[k % 4], .45 * tw);
      ctx.fillStyle = `rgba(${cols[k % 4]},${.6 + .4 * tw})`; circ(x, y, 2.6);
    }
  } else if (c === 5) {
    const f = .8 + .2 * flick(t * .5);
    glowAt(225, TOP + 150, 200, '255,200,130', .12 * f);
  } else if (c === 7) {
    // a bare bulb swinging on its cord, and the boiler's glow
    const sx = 225 + (RM ? 0 : Math.sin(t * .8) * 22), sy = TOP + 110;
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(20,20,20,.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(225, TOP + 36); ctx.lineTo(sx, sy - 8); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(sx, sy, 230, '255,220,150', .13);
    ctx.fillStyle = 'rgba(255,236,190,.9)'; circ(sx, sy, 5);
    glowAt(W - 44, BOT - 100, 90, '255,120,40', .12 + .05 * flick(t));
  } else if (c === 6) {
    const off = frac(t * .13) > .96 && Math.sin(t * 60) > 0;
    if (!off) glowAt(225, TOP + 70, 260, '220,235,255', .11);
    ctx.fillStyle = off ? 'rgba(200,210,220,.25)' : 'rgba(235,245,255,.8)'; ctx.fillRect(165, TOP + 46, 120, 4);
  } else {
    glowAt(22, BOT - 22, 60 + 6 * Math.sin(t * 1.5), '255,220,140', .22);
    for (let k = 0; k < 10; k++) {
      const p = beamPt(CHAPTERS[2], frac(k * .618), frac(k * .371 + .1)), tw = Math.max(0, Math.sin(t * 2.2 + k * 1.9));
      ctx.strokeStyle = `rgba(220,240,255,${.5 * tw})`; ctx.lineWidth = 1.2;
      const s = 2 + 3 * tw;
      ctx.beginPath(); ctx.moveTo(p[0] - s, p[1]); ctx.lineTo(p[0] + s, p[1]); ctx.moveTo(p[0], p[1] - s); ctx.lineTo(p[0], p[1] + s); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      const ph = frac(t * .22 + k / 3);
      ctx.fillStyle = `rgba(159,216,224,${.55 * Math.sin(ph * Math.PI)})`; ctx.font = `900 ${10 + ph * 10 | 0}px ${FD}`;
      ctx.fillText('z', 110 + k * 115 + Math.sin(ph * 5 + k) * 10, TOP + 28 + ph * 44);
    }
  }
  ctx.restore();
}
function drawRoomOver(c) {
  if (LOWFX) return;
  const t = RM ? 0 : T, ch = CHAPTERS[c];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (c === 3) {
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 10; k++) {
      const ph = frac(t * .09 * (1 + k % 3 * .3) + k * .137), x = 30 + frac(k * .618) * 390 + Math.sin(t * 1.3 + k) * 10, y = BOT - ph * (BOT - TOP), r = 3 + (k % 4) * 2;
      ctx.strokeStyle = `rgba(200,240,255,${.35 * Math.sin(ph * Math.PI)})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    }
  } else if (c === 4) {
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 7; k++) {
      const ph = frac(t * .06 * (1 + k % 3 * .4) + k * .19), x = frac(k * .618) * W + Math.sin(t * .9 + k * 2) * 30, y = TOP + ph * (BOT - TOP);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 1.5 + k); ctx.fillStyle = `rgba(${k % 2 ? '158,224,106' : '255,190,90'},${.5 * Math.sin(ph * Math.PI)})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.4, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
  } else if (c === 2) {
    for (let k = 0; k < 9; k++) {
      const x = 225 + Math.sin(t * .37 * (1 + k * .13) + k * 2.1) * 195, y = 370 + Math.sin(t * .29 * (1 + k * .11) + k * 1.3) * 260;
      const p = .5 + .5 * Math.sin(t * 2.3 + k * 1.7);
      glowAt(x, y, 16, '220,255,160', .35 * p);
      ctx.fillStyle = `rgba(244,255,207,${.3 + .7 * p})`; circ(x, y, 1.8);
    }
  } else {
    for (let k = 0; k < 16; k++) {
      const p = beamPt(ch, frac(k * .618 + t * .012 * (1 + k % 3)), frac(k * .377 + Math.sin(t * .25 + k) * .04 + t * .006));
      const a = .25 + .25 * Math.sin(t * 1.7 + k * 2.3);
      ctx.fillStyle = `rgba(${ch.beamCol},${a})`; circ(p[0], p[1], k % 3 ? 1.1 : 1.7);
    }
  }
  ctx.restore();
}

function chIcon(c, x, y, s, col) {
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (c === 0) {
    circ(x - s * .15, y + s * .05, s * .42);
    ctx.lineWidth = s * .16; ctx.beginPath(); ctx.moveTo(x + s * .2, y + s * .05); ctx.lineTo(x + s * .62, y - s * .2); ctx.stroke();
    ctx.lineWidth = s * .08; ctx.globalAlpha = .8;
    for (const dx of [-.3, 0]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y - s * .45); ctx.quadraticCurveTo(x + dx * s + s * .12, y - s * .6, x + dx * s, y - s * .75); ctx.stroke(); }
  } else if (c === 1) {
    ctx.lineWidth = s * .12;
    rr(x - s * .55, y - s * .3, s * 1.1, s * .75, s * .14); ctx.stroke();
    ctx.globalAlpha = .45; rr(x - s * .42, y - s * .18, s * .84, s * .5, s * .06); ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = s * .08; ctx.beginPath(); ctx.moveTo(x - s * .2, y - s * .62); ctx.lineTo(x, y - s * .32); ctx.lineTo(x + s * .22, y - s * .64); ctx.stroke();
  } else if (c === 2) {
    crescent(ctx, x - s * .08, y + s * .04, s * .5, col);
    star(x + s * .42, y - s * .38, s * .2, col);
  } else if (c === 3) {
    ctx.beginPath(); ctx.ellipse(x - s * .08, y + s * .18, s * .45, s * .26, 0, 0, TAU); ctx.fill();
    circ(x + s * .22, y - s * .2, s * .22);
    ctx.beginPath(); ctx.moveTo(x + s * .4, y - s * .24); ctx.lineTo(x + s * .66, y - s * .16); ctx.lineTo(x + s * .4, y - s * .08); ctx.fill();
  } else if (c === 4) {
    for (let k = 0; k < 5; k++) { const a = k * TAU / 5 - Math.PI / 2; circ(x + Math.cos(a) * s * .3, y - s * .08 + Math.sin(a) * s * .3, s * .18); }
    ctx.lineWidth = s * .09; ctx.beginPath(); ctx.moveTo(x, y + s * .15); ctx.lineTo(x, y + s * .62); ctx.stroke();
  } else if (c === 5) {
    ctx.lineWidth = s * .11;
    ctx.beginPath(); ctx.moveTo(x - s * .6, y + s * .1); ctx.lineTo(x, y - s * .5); ctx.lineTo(x + s * .6, y + s * .1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * .4, y - s * .05); ctx.lineTo(x - s * .4, y + s * .5); ctx.lineTo(x + s * .4, y + s * .5); ctx.lineTo(x + s * .4, y - s * .05); ctx.stroke();
    ctx.fillRect(x - s * .12, y + s * .08, s * .24, s * .24);
  } else if (c === 7) {
    ctx.lineWidth = s * .07;
    for (const a of [2.6, 3.0, 3.4, 3.8, .54, .14, -.26, -.66]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * s * .62, y + Math.sin(a) * s * .5 + s * .08); ctx.stroke(); }
    circ(x, y - s * .02, s * .26); circ(x, y - s * .32, s * .16);
  } else {
    ctx.lineWidth = s * .17;
    ctx.beginPath(); ctx.moveTo(x - s * .45, y + s * .45); ctx.lineTo(x + s * .12, y - s * .12); ctx.stroke();
    ctx.lineWidth = s * .14; ctx.beginPath(); ctx.arc(x + s * .28, y - s * .28, s * .24, .9, 5.5); ctx.stroke();
  }
  ctx.restore();
}

// ---------- screens & UI buttons ----------
let SCREEN = 'map', G = null, drag = null, UI = [];
function setScreen(s) {
  SCREEN = s; drag = null;
  if (s === 'map') MAP.focus = true;
  if (TG && tgv('6.1')) { try { if (s === 'map') TG.BackButton.hide(); else TG.BackButton.show(); } catch (e) {} }
  if (s === 'game' && G) Amb.start(G.lvl.ch); else Amb.stop();
  const col = s === 'game' && G ? G.ch.hud : '#110e22';
  document.body.style.backgroundColor = col;
  if (TG && tgv('6.1')) { try { TG.setHeaderColor(col); TG.setBackgroundColor(col); } catch (e) {} }
}
function goMap() { G = null; setScreen('map'); }
function closeHowto() { lsSet('pawsling-seen', '1'); setScreen('map'); }

function uiBtn(x, y, w, h, label, cb, primary) {
  UI.push({ x, y, w, h, cb });
  ctx.fillStyle = primary ? '#b8791f' : '#0d0b1d'; rr(x, y + 4, w, h, 14); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, primary ? '#ffd87a' : '#2e2859'); g.addColorStop(1, primary ? '#ffb938' : '#1f1a40');
  ctx.fillStyle = g; rr(x, y, w, h, 14); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)'; rr(x + 6, y + 4, w - 12, h * .32, 10); ctx.fill();
  if (!primary) { ctx.strokeStyle = '#4a4278'; ctx.lineWidth = 2; rr(x, y, w, h, 14); ctx.stroke(); }
  ctx.fillStyle = primary ? '#15122a' : '#f4efe6';
  fitFont(label, w - 18, h > 48 ? 20 : 16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
}
function iconBtn(x, y, kind, cb) {
  UI.push({ x: x - 4, y: y - 4, w: 42, h: 42, cb });
  ctx.fillStyle = '#0d0b1d'; rr(x, y + 3, 34, 34, 10); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + 34);
  g.addColorStop(0, '#2e2859'); g.addColorStop(1, '#1f1a40');
  ctx.fillStyle = g; rr(x, y, 34, 34, 10); ctx.fill();
  ctx.strokeStyle = '#4a4278'; ctx.lineWidth = 1.5; rr(x, y, 34, 34, 10); ctx.stroke();
  const cx = x + 17, cy = y + 17;
  ctx.fillStyle = '#f4efe6'; ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  if (kind === 'back') {
    ctx.beginPath(); ctx.moveTo(cx + 3, cy - 7); ctx.lineTo(cx - 4, cy); ctx.lineTo(cx + 3, cy + 7); ctx.stroke();
  } else if (kind === 'paw') {
    paw(cx, cy + 3, 15, '#ffc857');
  } else if (kind === 'bag') {
    ctx.fillStyle = '#ff8fb1'; rr(cx - 8, cy - 3, 16, 12, 3); ctx.fill();
    ctx.strokeStyle = '#ff8fb1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy - 3, 5, Math.PI, 0); ctx.stroke();
    star(cx + 7, cy - 8, 4.5, '#ffd166');
  } else if (kind === 'trophy') {
    ctx.fillStyle = '#ffc857'; ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 7, cy - 8); ctx.lineTo(cx + 7, cy - 8);
    ctx.quadraticCurveTo(cx + 7, cy + 3, cx, cy + 3); ctx.quadraticCurveTo(cx - 7, cy + 3, cx - 7, cy - 8); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - 7, cy - 4, 3.5, Math.PI * .5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 7, cy - 4, 3.5, -Math.PI * .5, Math.PI * .5); ctx.stroke();
    ctx.fillRect(cx - 1.5, cy + 3, 3, 4); ctx.fillRect(cx - 6, cy + 7, 12, 2.5);
  } else {
    ctx.beginPath(); ctx.moveTo(cx - 9, cy - 3); ctx.lineTo(cx - 5, cy - 3); ctx.lineTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.lineTo(cx - 5, cy + 3); ctx.lineTo(cx - 9, cy + 3); ctx.closePath(); ctx.fill();
    if (Snd.on) {
      ctx.beginPath(); ctx.arc(cx + 1, cy, 5, -.9, .9); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 1, cy, 9, -.9, .9); ctx.stroke();
    } else {
      ctx.strokeStyle = '#ff6b85';
      ctx.beginPath(); ctx.moveTo(cx + 3, cy - 5); ctx.lineTo(cx + 10, cy + 5); ctx.moveTo(cx + 10, cy - 5); ctx.lineTo(cx + 3, cy + 5); ctx.stroke();
    }
  }
}

// ---------- run state ----------
function newRun(li) {
  G = {
    li, lvl: LEVELS[li], ch: CHAPTERS[LEVELS[li].ch],
    state: 'banner', wave: 0, turn: 1, hp: 12000, maxHp: 12000, meter: 0, zoomArmed: false, cur: 0,
    heroes: teamDefs().map((d, i, team) => {
      const hearts = d.id === 'bandit' ? 4 : 3, [sx, sy] = startPos(i, team.length), lvl = heroLevel(d.id).L;
      return { ...d, x: sx, y: sy, vx: 0, vy: 0, hearts, maxHearts: hearts, ko: 0, lvl, dmg: Math.round(d.dmg * (1 + .04 * (lvl - 1))) };
    }),
    enemies: [], boxes: [], snacks: [], trails: [], parts: [], rings: [], texts: [], beams: [],
    laser: null, shot: null, attackQueue: [], timer: 0, shake: 0, banner: null, hitstop: 0, flash: null, confetti: [], hpLag: 12000,
    stats: { knots: 0, lasers: 0, crits: 0, portals: 0 }, stars: 0, newBest: false, loseReason: null, koTaught: false,
  };
}

// ---------- hearts, knockouts, targeting ----------
const KO_TURNS = 2;
// enemies strike the closest hero who is still on their feet
function targetOf(e) {
  let best = null, bd = 1e9;
  for (const h of G.heroes) {
    if (h.ko) continue;
    const d = dist(e.x, e.y, h.x, h.y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function wake(h, hearts, text) {
  h.ko = 0; h.hearts = Math.min(h.maxHearts, hearts); h.happy = .9;
  ftext(h.x, h.y - h.r - 18, text, '#5ce1c6', 15);
  burst(h.x, h.y, '#5ce1c6', 12);
}
// next hero in rotation; knocked-out heroes lose their turn and count down to waking up
function advanceHero() {
  let n = G.cur;
  for (let i = 0; i < G.heroes.length; i++) {
    n = (n + 1) % G.heroes.length;
    const h = G.heroes[n];
    if (h.webbed && !h.ko) { h.webbed = false; ftext(h.x, h.y - h.r - 20, tr('webStuck'), '#e8ecf2', 15); continue; }
    if (!h.ko) break;
    if (--h.ko === 0) wake(h, 1, tr('woke'));
  }
  G.cur = n;
}
function startLevel(li) { newRun(li); setScreen('game'); setupWave(0); }

// ---------- night shift: endless waves ----------
const ENDLESS_UNLOCK = 5; // opens once level 4 (the first boss) is beaten
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const wavesWord = n => tr('waves', n);
function startEndless() {
  newRun(0);
  G.li = -1;
  G.lvl = { ch: 0, endless: true, waves: [] };
  G.ch = CHAPTERS[0];
  setScreen('game');
  setupWave(0);
}
// wave n: more and tougher enemies, a boss every 5th wave, a new room every 5 waves
function genWave(n) {
  if (n % 5 === 4) {
    const minion = n >= 9 ? 'mop' : 'vac';
    return [['boss', 225, 240], [minion, 85, 440], [minion, 365, 440]];
  }
  const types = ['vac'];
  if (n >= 1) types.push('spray');
  if (n >= 3) types.push('mop');
  if (n >= 5) types.push('brush');
  if (n >= 7) types.push('fan');
  if (n >= 9) types.push('rc');
  if (n >= 11) types.push('shield');
  if (n >= 12) types.push('split');
  const count = Math.min(6, 2 + Math.floor(n / 2));
  const out = [];
  for (let k = 0; k < count; k++) {
    let x, y, tries = 0;
    do { x = rnd(60, W - 60); y = rnd(TOP + 80, 470); tries++; }
    while (tries < 60 && out.some(o => dist(x, y, o[1], o[2]) < 85));
    out.push([types[Math.floor(Math.random() * types.length)], Math.round(x), Math.round(y)]);
  }
  return out;
}
function endEndless() {
  G.newBest = G.wave > (PROG.endless || 0);
  if (G.newBest) { PROG.endless = G.wave; saveProg(); }
  gainXp(G.wave * 4);
  const wk = weekKey();
  if (PROG.wk !== wk) { PROG.wk = wk; PROG.wkBest = 0; }
  if (G.wave > PROG.wkBest) { PROG.wkBest = G.wave; saveProg(); }
  submitScores();
}

function burst(x, y, col, n = 12, sp = 180, shape) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = rnd(sp * .3, sp);
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(.4, .8), max: .8, col, size: rnd(2, 4.5),
      shape, rot: rnd(0, TAU), vr: rnd(-12, 12) });
  }
}
// chapter-flavoured debris: soap bubbles in the kitchen, confetti in the living room, stars in the bedroom
function themeBurst(x, y, n = 14, sp = 220) {
  const ch = G.ch;
  for (let i = 0; i < n; i++) burst(x, y, ch.fx[i % ch.fx.length], 1, sp, ch.shape);
}
function sparks(x, y, n = 8, col = '#fff6d0') {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = rnd(280, 520);
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(.15, .3), max: .3, col, size: 2, shape: 'spark' });
  }
}
function flash(col, a) { if (!RM) G.flash = { col, a, max: a }; }
function ring(x, y, r, col) { G.rings.push({ x, y, r, col, life: .45, max: .45 }); }
function ftext(x, y, text, col = '#fff', size = 16) { G.texts.push({ x, y, text: String(text), col, size, life: .9, max: .9 }); }
function addMeter(v) {
  const was = G.meter;
  G.meter = Math.min(100, G.meter + v);
  if (was < 100 && G.meter >= 100) { Snd.play('zoom'); haptic('medium'); }
}
function clampHero(h) {
  h.x = Math.max(h.r, Math.min(W - h.r, h.x));
  h.y = Math.max(TOP + h.r, Math.min(BOT - h.r, h.y));
}

function freeSpot(m) {
  for (let k = 0; k < 40; k++) {
    const x = rnd(40, W - 40), y = rnd(TOP + 40, BOT - 70);
    let ok = true;
    for (const e of G.enemies) if (e.alive && dist(x, y, e.x, e.y) < e.r + m) ok = false;
    for (const h of G.heroes) if (dist(x, y, h.x, h.y) < h.r + m) ok = false;
    for (const b of G.boxes) if (dist(x, y, b.x, b.y) < 30 + m) ok = false;
    for (const s of G.snacks) if (dist(x, y, s.x, s.y) < m) ok = false;
    if (ok) return { x, y };
  }
  return { x: rnd(40, W - 40), y: rnd(TOP + 40, BOT - 70) };
}
function spawnSnack() {
  const p = freeSpot(28);
  G.snacks.push({ ...p, kind: Math.random() < .5 ? 'fish' : 'pizza', ph: Math.random() * 6, taken: false });
}
function placeLaser() {
  const p = freeSpot(45);
  G.laser = { bx: p.x, by: p.y, x: p.x, y: p.y, caught: false };
}
function pickBoxes(n) {
  if (G.lvl.noBoxes) return [];
  for (let k = 0; k < BOXSETS.length; k++) {
    const set = BOXSETS[(Math.max(0, G.li) + n + k) % BOXSETS.length];
    const ok = set.every(([x, y]) =>
      G.enemies.every(e => dist(x, y, e.x, e.y) > e.r + 45) && START.concat(START5).every(([sx, sy]) => dist(x, y, sx, sy) > 55));
    if (ok) return set.map(([x, y]) => ({ x, y }));
  }
  return [];
}

function makeEnemy(type, x, y, i) {
  const d = ENEMY[type], m = G.mul;
  // a boss belongs to its room: G.lvl.ch picks which of the seven it is
  const kind = type === 'boss' ? G.lvl.ch % BOSS_COUNT : undefined;
  const bossHp = kind === 1 ? .85 : 1, bossAtk = kind === 2 ? .8 : kind === 7 ? .75 : 1; // the spider also takes turns away with its web
  const hp = Math.round(d.hp * m.hp * (type === 'boss' ? m.boss * bossHp : 1) / 50) * 50;
  return { type, kind, x, y, r: d.r, hp, maxHp: hp, timer: d.timer + (i % 2), maxTimer: d.timer, atk: Math.round(d.atk * m.atk * bossAtk / 50) * 50,
    alive: true, flash: 0, ph: Math.random() * 6, weak: Math.PI / 2, weakT: Math.PI / 2, foam: kind === 3, fade: 0 };
}
const shieldedBy = e => G.enemies.find(o => o.alive && o.type === 'shield' && o !== e && dist(o.x, o.y, e.x, e.y) < SHIELD_R + e.r);

function setupWave(n) {
  G.wave = n;
  const endless = G.lvl.endless;
  if (endless) {
    const c = Math.floor(n / 5) % CHAPTERS.length;
    if (c !== G.lvl.ch) { G.lvl.ch = c; G.ch = CHAPTERS[c]; setScreen('game'); }
  }
  const waves = G.lvl.waves, ch = G.ch;
  const list = endless ? genWave(n) : waves[n];
  G.mul = { hp: endless ? 1 + n * .14 : G.lvl.hpMul || ch.hp, atk: endless ? 1 + n * .07 : G.lvl.atkMul || ch.atk, boss: endless ? .5 : (G.lvl.boss || 1) };
  if (G.hard) G.mul.hp *= 1.4;
  G.enemies = list.map(([type, x, y], i) => makeEnemy(type, x, y, i));
  G.boxes = pickBoxes(n);
  G.heroes.forEach((h, i) => { [h.x, h.y] = startPos(i, G.heroes.length); h.vx = h.vy = 0; h.webbed = false; });
  G.trails = []; G.snacks = []; G.puddles = [];
  for (let i = 0; i < 3; i++) spawnSnack();
  placeLaser();
  const boss = G.enemies.find(e => e.type === 'boss');
  if (boss) { startBossIntro(boss); return; }
  G.state = 'banner';
  const sub = endless ? (n > 0 && n % 5 === 0 ? tr('newRoom', ch.name) : tr('record', wavesWord(PROG.endless || 0)))
    : n === 0 && G.lvl.tip ? G.lvl.tip : tr('waveOf', n + 1, waves.length);
  G.banner = { title: endless ? tr('nightWave', n + 1) : G.lvl.event ? tr('evLevel', tr('ev.' + G.lvl.event.id), G.lvl.evIdx + 1) : tr('levelRoom', G.li + 1, ch.name), sub, t: n === 0 && G.lvl.tip ? 2.2 : 1.5, max: n === 0 && G.lvl.tip ? 2.2 : 1.5, done: () => { G.state = 'aim'; announceHero(); } };
  Snd.play('wave');
}

// ---------- shooting ----------
function launch(dx, dy) {
  const h = G.heroes[G.cur];
  const len = Math.hypot(dx, dy);
  const zoom = G.zoomArmed;
  const sp = h.speed * (zoom ? 1.1 : 1) * (h.id === 'homa' && h.lvl >= 10 ? 1.2 : 1);
  h.vx = dx / len * sp; h.vy = dy / len * sp;
  const s = { hero: h, bounces: 0, touching: new Set(), delayed: new Set(), combos: new Set(), zoom, portalCd: .25, lastKnot: null, knots: 0, time: 0 };
  s.trail = { pts: [[h.x, h.y]], color: h.yarn, turn: G.turn, gold: zoom, used: new Set(), shot: s };
  G.trails.push(s.trail);
  G.shot = s;
  if (zoom) { G.meter = 0; G.zoomArmed = false; ftext(h.x, h.y - 40, tr('zoomies'), '#ffd166', 22); Snd.play('zoom'); flash('#ffd166', .35); ring(h.x, h.y, 90, '#ffd166'); }
  burst(h.x, h.y, h.yarn, 8, 160);
  Snd.play('launch'); haptic('medium');
  G.state = 'moving';
}

function damageEnemy(e, amt, crit) {
  if (!e.alive) return;
  if (e.foam) {
    e.foam = false; e.flash = .12;
    burst(e.x, e.y, '#ffffff', 18, 220, 'bubble');
    ftext(e.x, e.y - e.r - 10, tr('bossFx')[3], '#bfe9ff', 18);
    Snd.play('foam');
    return;
  }
  if (shieldedBy(e)) { amt *= .35; ftext(e.x, e.y - e.r - 28, tr('shielded'), '#6ec3ff', 12); }
  amt = Math.round(amt);
  e.hp -= amt; e.flash = .12;
  ftext(e.x + rnd(-12, 12), e.y - e.r - 6, crit ? amt + '!' : amt, crit ? '#ffe066' : '#fff', crit ? 24 : 16);
  if (e.type === 'boss' && e.kind === 6 && !e.phase2 && e.hp > 0 && e.hp <= e.maxHp / 2) {
    e.phase2 = true;
    e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * .25));
    e.maxTimer = 2; e.timer = Math.min(e.timer, 2);
    ftext(e.x, e.y - e.r - 36, tr('bossFx')[6], '#ff4d6d', 22);
    ring(e.x, e.y, e.r * 2.4, '#ff4d6d'); flash('#ff3b5c', .4);
    G.shake = Math.max(G.shake, 12);
    Snd.play('boss');
  }
  if (e.hp <= 0) {
    e.alive = false; e.hp = 0;
    burst(e.x, e.y, '#c9ced6', 18, 260);
    themeBurst(e.x, e.y, e.type === 'boss' ? 40 : 18, e.type === 'boss' ? 340 : 240);
    sparks(e.x, e.y, 10, G.ch.col);
    ring(e.x, e.y, e.r * 2, '#ffc857');
    ring(e.x, e.y, e.r * 3.2, G.ch.col);
    G.shake = Math.max(G.shake, e.type === 'boss' ? 18 : 6);
    G.hitstop = Math.max(G.hitstop, e.type === 'boss' ? .14 : .05);
    if (e.type === 'boss') flash('#fff', .7);
    if (e.type !== 'boss') addMeter(6);
    if (e.type === 'split') {
      for (const sd of [-1, 1]) {
        const m = makeEnemy('mini', Math.max(30, Math.min(W - 30, e.x + sd * 32)), e.y, 0);
        m.timer = 2; G.enemies.push(m); burst(m.x, m.y, '#ffd9a8', 8, 160);
      }
      ftext(e.x, e.y - 34, tr('cry.split'), '#ffd166', 16);
    }
    Snd.play('kill'); haptic(e.type === 'boss' ? 'heavy' : 'rigid');
  }
}

function hitEnemy(e, nx, ny) {
  const s = G.shot, h = s.hero;
  let dmg = h.dmg * rnd(.9, 1.1);
  if (h.id === 'mochi') dmg *= 1 + bounceBonus(h) * s.bounces;
  if (h.id === 'pixel' && h.lvl >= 5) dmg *= 1.15;
  if (h.id === 'homa') {
    const roll = Math.min(h.lvl >= 5 ? 3 : 2.5, 1 + (s.dist || 0) / 600);
    dmg *= roll;
    if (roll > 1.2) ftext(h.x, h.y - h.r - 24, '×' + roll.toFixed(1), h.yarn, 13);
  }
  if (s.zoom) dmg *= 2;
  let crit = false;
  if (e.type === 'mop') {
    if (h.type === 'pierce') { dmg *= 2; crit = true; }
    else { dmg *= .5; ftext(e.x, e.y - e.r - 30, tr('armor'), '#9fb3c8', 13); Snd.play('armor'); }
  }
  if (e.type === 'boss' && angDiff(Math.atan2(h.y - e.y, h.x - e.x), e.weak) < .6) {
    dmg *= 3; crit = true; G.stats.crits++;
    ftext(e.x, e.y - e.r - 34, tr('crit'), '#ffe066', 18);
  }
  burst(h.x - nx * h.r, h.y - ny * h.r, '#fff', 6, 150);
  sparks(h.x - nx * h.r, h.y - ny * h.r, crit ? 12 : 6, crit ? '#ffe066' : '#fff6d0');
  if (crit) G.hitstop = Math.max(G.hitstop, .035);
  Snd.play(crit ? 'crit' : 'hit'); haptic(crit ? 'heavy' : 'light');
  damageEnemy(e, dmg, crit);
  if (h.id === 'bandit' && e.alive && !s.delayed.has(e)) {
    s.delayed.add(e); e.timer += h.lvl >= 10 ? 2 : 1;
    ftext(e.x + e.r, e.y + 4, tr('plusTurn'), '#5ce1c6', 14);
  }
  if (h.id === 'nugget') {
    const nr = h.lvl >= 5 ? 110 : 90, nd = h.lvl >= 10 ? 320 : 220;
    ring(e.x, e.y, nr, '#c9a86a');
    for (const o of G.enemies) if (o !== e && o.alive && dist(e.x, e.y, o.x, o.y) < nr + o.r) damageEnemy(o, nd * (s.zoom ? 2 : 1));
  }
  if (h.id === 'spark') {
    const near = G.enemies.filter(o => o !== e && o.alive && dist(e.x, e.y, o.x, o.y) < 220)
      .sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y)).slice(0, h.lvl >= 10 ? 2 : 1);
    for (const o of near) {
      G.beams.push({ x1: e.x, y1: e.y, x2: o.x, y2: o.y, life: .3, max: .3, col: '#ffe14d', w: 5 });
      sparks(o.x, o.y, 8, '#ffe14d');
      damageEnemy(o, dmg * (h.lvl >= 5 ? .7 : .5));
    }
  }
}

function triggerCombo(o) {
  const z = G.shot.zoom ? 2 : 1;
  ftext(o.x, o.y - o.r - 14, o.combo, o.yarn, 14);
  o.happy = .9;
  Snd.play('combo'); haptic('light');
  if (o.id === 'mochi') {
    ring(o.x, o.y, 130, o.yarn);
    for (const e of G.enemies) if (e.alive && dist(o.x, o.y, e.x, e.y) < 130 + e.r) damageEnemy(e, 350 * z);
  } else if (o.id === 'pixel') {
    let best = null, bd = 1e9;
    for (const e of G.enemies) if (e.alive) { const d = dist(o.x, o.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    if (best) {
      G.beams.push({ x1: o.x, y1: o.y, x2: best.x, y2: best.y, life: .35, max: .35, col: '#ffd23f', w: 7 });
      damageEnemy(best, (o.lvl >= 10 ? 800 : 550) * z);
    }
  } else if (o.id === 'bandit') {
    const v = (o.lvl >= 5 ? 700 : 500) * z;
    G.hp = Math.min(G.maxHp, G.hp + v);
    ftext(o.x, o.y - o.r - 32, '+' + v + ' HP', '#5ce1c6', 16);
    burst(o.x, o.y, '#5ce1c6', 12);
    Snd.play('heal');
  } else if (o.id === 'rex') {
    for (const h of G.heroes) if (!h.ko && h.hearts < h.maxHearts) { h.hearts++; ftext(h.x, h.y - h.r - 26, '+♥', '#ff5d7a', 14); }
    if (o.lvl >= 10) { G.hp = Math.min(G.maxHp, G.hp + 800 * z); ftext(o.x, o.y - o.r - 46, '+' + 800 * z + ' HP', '#5ce1c6', 16); }
    burst(o.x, o.y, '#ff6b6b', 16); Snd.play('heal');
  } else if (o.id === 'homa') {
    const alive = G.enemies.filter(e => e.alive);
    for (let k = 0; k < 5 && alive.length; k++) {
      const e = alive[Math.floor(Math.random() * alive.length)];
      G.beams.push({ x1: o.x, y1: o.y, x2: e.x, y2: e.y, life: .3, max: .3, col: '#c47f2e', w: 3 });
      damageEnemy(e, 150 * z);
    }
  } else if (o.id === 'spark') {
    const alive = G.enemies.filter(e => e.alive).sort(() => Math.random() - .5).slice(0, 3);
    for (const e of alive) {
      G.beams.push({ x1: e.x, y1: TOP, x2: e.x, y2: e.y, life: .4, max: .4, col: '#ffe14d', w: 6 });
      damageEnemy(e, 300 * z);
    }
    flash('#ffe14d', .2);
  } else {
    addMeter(12 * z);
    ftext(o.x, o.y - o.r - 32, tr('plusMischief', 12 * z), '#ff8fb1', 14);
    burst(o.x, o.y, '#ff8fb1', 14);
  }
}

// a knot tied by two different heroes is special: cat + raccoon burns (x1.5), two cats purr wider,
// two raccoons scatter trash that delays the enemies' attacks
const KNOT_COL = { fire: '#ff7a3c', purr: '#b18cff', trash: '#9ee06a' };
function knot(p, gold, h1, h2) {
  const combo = !h1 || !h2 || h1 === h2 ? null : h1.kind !== h2.kind ? 'fire' : h1.kind === 'cat' ? 'purr' : 'trash';
  const dmg = (gold ? 900 : 450) * (combo === 'fire' ? 1.5 : 1), R = combo === 'purr' ? 105 : 75;
  const col = combo ? KNOT_COL[combo] : gold ? '#ffd166' : '#ff8fb1';
  G.stats.knots++;
  ring(p[0], p[1], R, col);
  ring(p[0], p[1], 40, '#fff');
  burst(p[0], p[1], col, combo ? 22 : 14, 220);
  themeBurst(p[0], p[1], 10, 200);
  flash(col, combo ? .28 : .18);
  ftext(p[0], p[1] - 16, combo ? tr('knot.' + combo) : tr('knot'), col, combo ? 20 : 18);
  addMeter(10);
  G.shake = Math.max(G.shake, combo ? 8 : 5);
  Snd.play('knot'); haptic('heavy');
  for (const e of G.enemies) {
    if (!e.alive || dist(p[0], p[1], e.x, e.y) >= R + e.r) continue;
    damageEnemy(e, dmg);
    if (combo === 'trash' && e.alive) { e.timer++; ftext(e.x + e.r, e.y + 4, tr('plusTurn'), '#9ee06a', 13); }
  }
}

function checkKnots(a, b) {
  const s = G.shot;
  for (const t of G.trails) {
    if (t.shot === s) continue;
    const P = t.pts;
    for (let i = 1; i < P.length; i++) {
      if (t.used.has(i)) continue;
      const pt = segX(a, b, P[i - 1], P[i]);
      if (!pt) continue;
      t.used.add(i);
      if (s.knots < (s.zoom ? 4 : 2) && (!s.lastKnot || dist(pt[0], pt[1], s.lastKnot[0], s.lastKnot[1]) > 30)) {
        s.lastKnot = pt; s.knots++;
        knot(pt, t.gold || s.zoom, s.hero, t.shot && t.shot.hero);
      }
    }
  }
}

function stepShot(dt) {
  const s = G.shot, h = s.hero, N = 4, sd = dt / N;
  s.time += dt;
  for (let k = 0; k < N; k++) {
    if (!G.shot) return;
    if (s.portalCd > 0) s.portalCd -= sd;

    const L = G.laser;
    if (h.kind === 'cat' && L && !L.caught) {
      const dx = L.x - h.x, dy = L.y - h.y, d = Math.hypot(dx, dy) || 1;
      if (d < 150) {
        const sp = Math.hypot(h.vx, h.vy);
        h.vx += dx / d * 1100 * sd; h.vy += dy / d * 1100 * sd;
        const ns = Math.hypot(h.vx, h.vy) || 1;
        h.vx *= sp / ns; h.vy *= sp / ns;
      }
      if (d < h.r + 8) {
        L.caught = true; G.stats.lasers++;
        addMeter(15);
        const sp = Math.hypot(h.vx, h.vy) || 1, ns = Math.min(sp * 1.25, h.speed * 1.3);
        h.vx *= ns / sp; h.vy *= ns / sp;
        burst(L.x, L.y, '#ff3b5c', 18);
        ftext(L.x, L.y - 20, tr('caught'), '#ff6b85', 16);
        Snd.play('meow'); haptic('medium');
      }
    }

    for (const e of G.enemies) {
      if (!e.alive || e.type !== 'fan') continue;
      const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (d < FAN_R) { const f = 2600 * (1 - d / FAN_R) * sd; h.vx += dx / d * f; h.vy += dy / d * f; }
    }
    h.x += h.vx * sd; h.y += h.vy * sd;
    s.dist = (s.dist || 0) + Math.hypot(h.vx, h.vy) * sd;

    let wb = false;
    if (h.x < h.r) { h.x = h.r; h.vx = Math.abs(h.vx); wb = true; }
    if (h.x > W - h.r) { h.x = W - h.r; h.vx = -Math.abs(h.vx); wb = true; }
    if (h.y < TOP + h.r) { h.y = TOP + h.r; h.vy = Math.abs(h.vy); wb = true; }
    if (h.y > BOT - h.r) { h.y = BOT - h.r; h.vy = -Math.abs(h.vy); wb = true; }
    if (wb) {
      s.bounces++;
      burst(h.x, h.y, h.yarn, 4, 90);
      burst(h.x, h.y, G.ch.fx[s.bounces % G.ch.fx.length], 3, 110, G.ch.shape);
      Snd.play('wall');
      if (h.id === 'mochi') ftext(h.x, h.y - 26, '+' + Math.round(bounceBonus(h) * 100) + '%', h.yarn, 12);
    }

    for (const e of G.enemies) {
      if (!e.alive) continue;
      const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || .001, rsum = h.r + e.r;
      if (d < rsum) {
        const nx = dx / d, ny = dy / d;
        if (!s.touching.has(e)) { s.touching.add(e); hitEnemy(e, nx, ny); }
        if (h.type === 'bounce' && e.alive) {
          h.x = e.x + nx * rsum; h.y = e.y + ny * rsum;
          const vn = h.vx * nx + h.vy * ny;
          if (vn < 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
        }
      } else if (d > rsum + 3) s.touching.delete(e);
    }

    for (const o of G.heroes) {
      if (o === h || s.combos.has(o)) continue;
      if (dist(h.x, h.y, o.x, o.y) >= h.r + o.r) continue;
      s.combos.add(o);
      if (o.webbed) { o.webbed = false; ftext(o.x, o.y - o.r - 40, tr('webFreed'), '#e8ecf2', 15); burst(o.x, o.y, '#e8ecf2', 12); }
      if (h.id === 'rex' && !o.ko && o.hearts < o.maxHearts) {
        o.hearts = Math.min(o.maxHearts, o.hearts + (h.lvl >= 5 ? 2 : 1));
        ftext(o.x, o.y - o.r - 30, '+♥', '#ff5d7a', 16); Snd.play('heal');
      }
      if (o.ko) { wake(o, 2, tr('revived')); Snd.play('heal'); haptic('success'); }
      else triggerCombo(o);
    }

    if (s.portalCd <= 0) {
      for (let i = 0; i < G.boxes.length; i++) {
        const b = G.boxes[i];
        if (dist(h.x, h.y, b.x, b.y) >= 24) continue;
        const o = G.boxes[1 - i], sp = Math.hypot(h.vx, h.vy) || 1;
        burst(b.x, b.y, '#c68a4f', 10);
        h.x = o.x + h.vx / sp * 40; h.y = o.y + h.vy / sp * 40;
        clampHero(h);
        if (h.kind === 'cat') { h.vx *= 1.15; h.vy *= 1.15; }
        s.portalCd = .4; G.stats.portals++;
        burst(o.x, o.y, '#ffc857', 12);
        ftext(o.x, o.y - 32, h.kind === 'cat' ? tr('whooshFast') : tr('whoosh'), '#ffc857', 14);
        Snd.play('portal'); haptic('light');
        s.trail = { pts: [[h.x, h.y]], color: h.yarn, turn: G.turn, gold: s.zoom, used: new Set(), shot: s };
        G.trails.push(s.trail);
        break;
      }
    }

    for (const sn of G.snacks) {
      if (sn.taken || dist(h.x, h.y, sn.x, sn.y) > h.r + 12) continue;
      sn.taken = true;
      const bonus = h.kind === 'raccoon' ? 16 : 8;
      addMeter(bonus);
      burst(sn.x, sn.y, sn.kind === 'fish' ? '#7ec8e3' : '#ffd166', 10, 120);
      ftext(sn.x, sn.y - 18, tr('plusMischief', bonus), '#ff8fb1', 13);
      Snd.play('snack');
    }

    const trail = s.trail, lp = trail.pts[trail.pts.length - 1];
    if (dist(h.x, h.y, lp[0], lp[1]) > 10) {
      const np = [h.x, h.y];
      checkKnots(lp, np);
      trail.pts.push(np);
    }

    for (const pd of G.puddles || []) {
      if (dist(h.x, h.y, pd.x, pd.y) > pd.r) continue;
      const k = Math.exp(-3.2 * sd); h.vx *= k; h.vy *= k;
      if (!s.stuck) { s.stuck = true; ftext(pd.x, pd.y - 22, tr('bossFx')[0], '#ff8fb1', 15); Snd.play('splat'); }
      if (Math.random() < .25) burst(h.x, h.y + h.r * .6, '#ff8fb1', 1, 60, 'bubble');
    }

    const sp = Math.hypot(h.vx, h.vy);
    const kf = s.zoom ? .45 : .75, lin = s.zoom ? 60 : 95;
    const ns = Math.max(0, sp * Math.exp(-kf * sd) - lin * sd);
    if (sp > 0) { h.vx *= ns / sp; h.vy *= ns / sp; }
  }
  G.snacks = G.snacks.filter(x => !x.taken);
  if (Math.hypot(h.vx, h.vy) < 30 || s.time > 12) { h.vx = h.vy = 0; endShot(); }
}

function endShot() {
  const s = G.shot, h = s.hero;
  G.shot = null;
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const d = dist(h.x, h.y, e.x, e.y) || 1, rsum = h.r + e.r;
    if (d < rsum) { h.x = e.x + (h.x - e.x) / d * rsum; h.y = e.y + (h.y - e.y) / d * rsum; }
  }
  clampHero(h);
  if (!G.enemies.some(e => e.alive)) { waveClear(); return; }
  G.attackQueue = [];
  for (const e of G.enemies) if (e.alive) { e.timer--; if (e.timer <= 0) G.attackQueue.push(e); }
  brushHeal();
  G.state = 'enemy';
  G.timer = G.attackQueue.length ? .35 : .05;
}

function brushHeal() {
  let any = false;
  for (const b of G.enemies) {
    if (!b.alive || b.type !== 'brush') continue;
    let healed = false;
    for (const e of G.enemies) {
      if (!e.alive || e.hp >= e.maxHp || dist(b.x, b.y, e.x, e.y) > HEAL_R + e.r) continue;
      const v = Math.min(e.maxHp - e.hp, Math.round(e.maxHp * .012) * 10);
      e.hp += v; healed = true;
      ftext(e.x, e.y - e.r - 20, '+' + v, '#3dd68c', 14);
      if (e !== b) G.beams.push({ x1: b.x, y1: b.y, x2: e.x, y2: e.y, life: .4, max: .4, col: '#3dd68c', w: 3 });
    }
    if (healed) { ring(b.x, b.y, HEAL_R, '#3dd68c'); any = true; }
  }
  if (any) Snd.play('heal');
}
// RC cars pick a new free spot at the start of each hero turn and drive there
function driveCars() {
  for (const e of G.enemies) {
    if (!e.alive || e.type !== 'rc') continue;
    for (let k = 0; k < 30; k++) {
      const q = freeSpot(55);
      if (dist(q.x, q.y, e.x, e.y) > 90 && q.y < BOT - 150) {
        e.tx = q.x; e.ty = q.y; e.ang = Math.atan2(q.y - e.y, q.x - e.x);
        ftext(e.x, e.y - e.r - 18, tr('vroom'), '#ffb070', 12);
        break;
      }
    }
  }
}

function nextAttack() {
  const e = G.attackQueue.shift();
  if (!e) { nextTurn(); return; }
  if (!e.alive) { G.timer = 0; return; }
  const t = targetOf(e);
  if (!t) { G.timer = 0; return; }
  const boss = e.type === 'boss', ringAll = boss && e.kind === 2;
  const targets = ringAll ? G.heroes.filter(h => !h.ko) : [t];
  G.hp = Math.max(0, G.hp - e.atk);
  ftext(t.x, t.y - 30, '-' + e.atk, '#ff6b85', 20);
  const cry = boss ? tr('bossCries')[e.kind] : tr('cry.' + e.type);
  ftext(e.x, e.y - e.r - 22, cry, '#ffc857', 14);
  G.shake = boss ? 14 : 7;
  flash('#ff3b5c', boss ? .55 : .35);
  Snd.play(boss ? 'boss' : 'attack'); haptic('error');
  if (ringAll) { Snd.play('bells'); ring(e.x, e.y, 260, '#ffc857'); ftext(e.x, e.y - e.r - 44, tr('bossFx')[2], '#ffc857', 18); }
  const loss = boss && !ringAll ? 2 : 1;
  for (const h of targets) {
    h.hurt = .7;
    G.beams.push({ x1: e.x, y1: e.y, x2: h.x, y2: h.y, life: .45, max: .45, col: e.type === 'spray' ? '#6ec3ff' : ringAll ? '#ffc857' : '#ff3b5c', w: boss ? 12 : 6 });
    burst(h.x, h.y, '#ff6b85', 14);
    h.hearts = Math.max(0, h.hearts - loss);
    ftext(h.x, h.y - 52, '-' + loss + ' ♥', '#ff5d7a', 16);
    if (h.hearts === 0) {
      G.everKo = true;
      h.ko = KO_TURNS;
      ftext(h.x, h.y + h.r + 18, tr('ko'), '#ffc857', 18);
      if (!G.koTaught) { G.koTaught = true; ftext(W / 2, BOT - 40, tr('koHint'), '#5ce1c6', 15); }
      haptic('heavy');
    }
  }
  e.timer = e.maxTimer;
  if (boss) bossAfterAttack(e, t);
  G.timer = .6;
  const allKo = G.heroes.every(h => h.ko);
  if (G.hp <= 0 || allKo) { G.loseReason = allKo ? 'ko' : 'hp'; G.state = 'lose'; if (G.lvl.endless) endEndless(); Amb.duck(.25); Snd.play('lose'); haptic('error'); }
}

function nextTurn() {
  G.turn++;
  if (G.hard && G.turn > G.lvl.par) { G.loseReason = 'turns'; G.state = 'lose'; Amb.duck(.25); Snd.play('lose'); haptic('error'); return; }
  advanceHero();
  G.trails = G.trails.filter(t => t.turn >= G.turn - 2);
  driveCars();
  placeLaser();
  if (G.snacks.length < 4 && Math.random() < .7) spawnSnack();
  for (const e of G.enemies) if (e.type === 'boss') e.weakT += 1.3;
  G.state = 'aim';
  announceHero();
}

function waveClear() {
  if (!G.lvl.endless && G.wave >= G.lvl.waves.length - 1) {
    G.state = 'win';
    const par = G.lvl.par;
    G.stars = G.turn <= par ? 3 : G.turn <= Math.round(par * 1.5) ? 2 : 1;
    if (G.lvl.event) eventWin();
    else {
    const key = String(G.li + 1);
    const prevBest = PROG.best[key];
    G.newBest = !prevBest || G.turn < prevBest;
    PROG.best[key] = prevBest ? Math.min(prevBest, G.turn) : G.turn;
    PROG.stars[key] = Math.max(PROG.stars[key] || 0, G.stars);
    PROG.unlocked = Math.min(LEVELS.length, Math.max(PROG.unlocked, G.li + 2));
    checkChallenge();
    if (G.hard) PROG.hard = { ...(PROG.hard || {}), [String(G.li + 1)]: 1 };
    gainXp((20 + 5 * G.lvl.ch + 5 * G.stars) * (G.hard ? 2 : 1));
    saveProg();
    submitScores();
    }
    for (let i = 0; i < (RM ? 0 : 110); i++) {
      const pal = G.ch.fx.concat('#ffc857');
      const up = G.ch.shape === 'bubble';
      G.confetti.push({ x: rnd(0, W), y: up ? rnd(H + 10, H + 420) : rnd(-420, -10), vx: rnd(-25, 25), vy: rnd(70, 170) * (up ? -1 : 1),
        rot: rnd(0, TAU), vr: rnd(-6, 6), col: pal[i % pal.length], size: rnd(3.5, 6.5), shape: G.ch.shape });
    }
    Amb.duck(.25); playWin(G.lvl.ch, G.stars); haptic('success');
    return;
  }
  const heal = Math.round(G.maxHp * .15);
  G.hp = Math.min(G.maxHp, G.hp + heal);
  for (const h of G.heroes) { if (h.ko) { h.ko = 0; h.hearts = 1; } else h.hearts = Math.min(h.maxHearts, h.hearts + 1); }
  G.state = 'banner';
  G.banner = { title: tr('waveClear'), sub: tr('waveClearSub', heal), t: 1.5, max: 1.5,
    done: () => { G.turn++; advanceHero(); setupWave(G.wave + 1); } };
  playRound(G.lvl.ch);
}

// ---------- update ----------
function update(dt) {
  if (SCREEN === 'map') updateMap(dt);
  if (SCREEN !== 'game' || !G) return;
  const L = G.laser;
  if (L && !L.caught) { L.x = L.bx + Math.cos(T * 1.3) * 12; L.y = L.by + Math.sin(T * 1.7) * 10; }
  if (G.state === 'moving') { if (G.hitstop > 0) G.hitstop -= dt; else stepShot(dt); }
  else if (G.state === 'enemy') { G.timer -= dt; if (G.timer <= 0) nextAttack(); }
  else if (G.state === 'banner') {
    G.banner.t -= dt;
    if (G.banner.t <= 0) { const d = G.banner.done; G.banner = null; d(); }
  }
  else if (G.state === 'bossintro') updateBossIntro(dt);
  const drag0 = Math.pow(.05, dt);
  for (const p of G.parts) {
    const d = p.shape === 'spark' ? Math.pow(.2, dt) : drag0;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= d; p.vy *= d; p.life -= dt;
    if (p.vr) p.rot += p.vr * dt;
    if (p.shape === 'bubble') p.vy -= 60 * dt;
  }
  for (const c of G.confetti) { c.x += (c.vx + Math.sin(T * 2 + c.rot) * 30) * dt; c.y += c.vy * dt; c.rot += c.vr * dt; }
  G.confetti = G.confetti.filter(c => c.vy > 0 ? c.y < H + 20 : c.y > -20);
  if (G.flash) { G.flash.a -= dt * 1.6; if (G.flash.a <= 0) G.flash = null; }
  G.parts = G.parts.filter(p => p.life > 0);
  for (const t of G.texts) { t.y -= 40 * dt; t.life -= dt; }
  G.texts = G.texts.filter(t => t.life > 0);
  for (const r of G.rings) r.life -= dt;
  G.rings = G.rings.filter(r => r.life > 0);
  for (const b of G.beams) b.life -= dt;
  G.beams = G.beams.filter(b => b.life > 0);
  for (const h of G.heroes) { if (h.hurt > 0) h.hurt -= dt; if (h.happy > 0) h.happy -= dt; }
  if (G.typeTag && G.state === 'aim') { G.typeTag.life -= dt; if (G.typeTag.life <= 0) G.typeTag = null; }
  G.hpLag = G.hpLag > G.hp ? G.hpLag + (G.hp - G.hpLag) * Math.min(1, dt * 2.5) : G.hp;
  for (const e of G.enemies) {
    if (e.flash > 0) e.flash -= dt;
    if (e.fade > 0) e.fade = Math.max(0, e.fade - dt * 1.8);
    if (e.type === 'boss') e.weak += (e.weakT - e.weak) * Math.min(1, dt * 4);
    if (e.tx != null) {
      const k = Math.min(1, dt * 4);
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
      if (Math.hypot(e.tx - e.x, e.ty - e.y) < .5) e.tx = e.ty = null;
    }
  }
  G.shake = Math.max(0, G.shake - dt * 30);
}

// ---------- drawing: actors ----------
const HIDX = { mochi: 0, pixel: 1, bandit: 2, nugget: 3, spark: 4, rex: 5, homa: 6 };
function paw(x, y, s, col) {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, y + s * .25, s * .5, s * .42, 0, 0, TAU); ctx.fill();
  for (const [dx, dy] of [[-.5, -.35], [-.18, -.62], [.18, -.62], [.5, -.35]]) circ(x + dx * s, y + dy * s, s * .19);
}

function heroTail(h, r, t, k) {
  const sw = Math.sin(t * 2.6 + k * 1.7) * r * .2;
  if (h.kind === 'cat') {
    ctx.beginPath(); ctx.moveTo(r * .5, r * .55);
    ctx.bezierCurveTo(r * 1.4, r * .8, r * 1.3 + sw * .4, -r * .1, r * 1.05 + sw, -r * .6);
    ctx.lineCap = 'round';
    ctx.strokeStyle = h.yarn; ctx.lineWidth = r * .34 + 4; ctx.stroke();
    ctx.strokeStyle = h.fur; ctx.lineWidth = r * .34; ctx.stroke();
    if (h.id === 'mochi') { ctx.strokeStyle = h.dark; ctx.setLineDash([r * .1, r * .22]); ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = h.yarn; circ(r * 1.05 + sw, -r * .6, r * .1); }
  } else {
    for (const pass of [0, 1]) for (let i = 0; i < 6; i++) {
      const u = i / 5, px = r * (.55 + u * .72) + sw * u, py = r * (.6 - u * 1.1), rad = r * (.3 - u * .05);
      ctx.fillStyle = pass ? (i % 2 ? h.dark : h.fur) : h.yarn;
      circ(px, py, pass ? rad : rad + 1.8);
    }
  }
}

function heroEyes(h, r, o, mood) {
  const id = h.id, k = HIDX[id], t = RM ? 1 : T;
  const blink = !mood && !RM && frac(t * .21 + k * .37) < .035;
  const lk = o.look || [0, 0], lx = lk[0] * r * .07, ly = lk[1] * r * .06;
  for (const s of [-1, 1]) {
    const ex = s * r * .36, ey = -r * .06;
    if (mood === 'happy' || blink) {
      ctx.strokeStyle = id === 'pixel' ? h.eye : '#1b1b22'; ctx.lineWidth = Math.max(1.5, r * .08); ctx.lineCap = 'round';
      ctx.beginPath();
      if (mood === 'happy') { ctx.moveTo(ex - r * .15, ey + r * .05); ctx.quadraticCurveTo(ex, ey - r * .16, ex + r * .15, ey + r * .05); }
      else { ctx.moveTo(ex - r * .16, ey); ctx.quadraticCurveTo(ex, ey + r * .09, ex + r * .16, ey); }
      ctx.stroke(); continue;
    }
    if (mood === 'hurt') {
      ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = Math.max(1.5, r * .08); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - s * r * .13, ey - r * .11); ctx.lineTo(ex + s * r * .1, ey); ctx.lineTo(ex - s * r * .13, ey + r * .11); ctx.stroke();
      continue;
    }
    if (h.kind === 'raccoon') {
      const er = id === 'nugget' ? r * .22 : r * .19;
      ctx.fillStyle = '#fff'; circ(ex, ey, er);
      ctx.fillStyle = id === 'nugget' ? '#3a2a1e' : '#1b1b22'; circ(ex + lx, ey + ly, er * .6);
      ctx.fillStyle = '#fff'; circ(ex + lx + er * .22, ey + ly - er * .25, er * .22);
      if (id === 'nugget') circ(ex + lx - er * .22, ey + ly + er * .22, er * .1);
    } else {
      const er = id === 'mochi' ? r * .23 : r * .21;
      if (id === 'pixel') { ctx.shadowColor = h.eye; ctx.shadowBlur = 10; }
      ctx.fillStyle = h.eye; circ(ex, ey, er); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(ex, ey, er, .15 * Math.PI, .85 * Math.PI); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(ex + lx, ey + ly, er * (id === 'pixel' ? .16 : .36), er * .78, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; circ(ex + lx + er * .32, ey + ly - er * .36, er * .24); circ(ex + lx - er * .25, ey + ly + er * .3, er * .1);
      if (id === 'pixel') {
        ctx.fillStyle = h.fur; ctx.beginPath(); ctx.ellipse(ex, ey - er * .62, er * 1.25, er * .62, s * .18, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0d0b16'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(ex, ey - er * .62, er * 1.25, er * .62, s * .18, .1 * Math.PI, .9 * Math.PI); ctx.stroke();
      }
    }
  }
  if (mood === 'sad') { ctx.fillStyle = '#7ec8e3'; ctx.beginPath(); ctx.moveTo(r * .42, r * .08); ctx.quadraticCurveTo(r * .52, r * .26, r * .42, r * .3); ctx.quadraticCurveTo(r * .32, r * .26, r * .42, r * .08); ctx.fill(); }
}

// ---------- the seven bosses ----------
// One per room, in room order: blender, TV, alarm clock, washing machine, leaf blower, ghost vacuum
// and the Robo-Boss 9000 in the garage. Each keeps the yellow sensor and adds its own ability.
const BOSS_COUNT = 8;
const BOSS_COL = ['#ff8fb1', '#6ec3ff', '#ffc857', '#bfe9ff', '#9ee06a', '#c9b8ff', '#ff4d6d', '#8fd14f'];
const bossName = e => (tr('bossNames') || [])[e.kind] || tr('bossName');
function heroFreeSpot(x, y, e) {
  for (const o of G.enemies) {
    if (!o.alive) continue;
    const d = dist(x, y, o.x, o.y) || 1, m = o.r + 26;
    if (d < m) { x = o.x + (x - o.x) / d * m; y = o.y + (y - o.y) / d * m; }
  }
  return [Math.max(26, Math.min(W - 26, x)), Math.max(TOP + 26, Math.min(BOT - 26, y))];
}
function bossAfterAttack(e, t) {
  const fx = tr('bossFx')[e.kind], col = BOSS_COL[e.kind];
  if (e.kind === 0) {
    // a sticky smoothie puddle between the blender and the hero it hit
    const u = rnd(.45, .7);
    const x = Math.max(56, Math.min(W - 56, e.x + (t.x - e.x) * u + rnd(-30, 30)));
    const y = Math.max(TOP + 70, Math.min(BOT - 100, e.y + (t.y - e.y) * u + rnd(-20, 20)));
    G.puddles.push({ x, y, r: 46, ph: Math.random() * 6 });
    if (G.puddles.length > 3) G.puddles.shift();
    burst(x, y, col, 14, 160, 'bubble'); ftext(x, y - 30, fx, col, 16); Snd.play('splat');
  } else if (e.kind === 1) {
    // a commercial break: a small vacuum drives out of the screen
    if (G.enemies.filter(o => o.alive && o.minion).length >= 2) return;
    let p = null;
    for (let k = 0; k < 30 && !p; k++) {
      const ang = rnd(0, TAU), d = rnd(e.r + 40, e.r + 90), x = e.x + Math.cos(ang) * d, y = e.y + Math.sin(ang) * d;
      if (x < 40 || x > W - 40 || y < TOP + 40 || y > BOT - 170) continue;
      if (G.enemies.some(o => o.alive && dist(x, y, o.x, o.y) < o.r + 34)) continue;
      if (G.heroes.some(h => dist(x, y, h.x, h.y) < h.r + 40)) continue;
      p = [x, y];
    }
    if (!p) return;
    const m = makeEnemy('vac', p[0], p[1], 0);
    m.minion = true; m.timer = m.maxTimer + 1;
    m.hp = m.maxHp = Math.round(m.maxHp * .6 / 50) * 50;
    G.enemies.push(m);
    G.beams.push({ x1: e.x, y1: e.y, x2: m.x, y2: m.y, life: .4, max: .4, col, w: 6 });
    ring(m.x, m.y, 50, col); burst(m.x, m.y, col, 12, 160);
    ftext(m.x, m.y - 36, fx, col, 16); Snd.play('tvad');
  } else if (e.kind === 3) {
    if (!e.foam) { e.foam = true; burst(e.x, e.y, '#ffffff', 16, 180, 'bubble'); Snd.play('foam'); }
  } else if (e.kind === 4) {
    // a gale pushes every hero away from the blower
    for (const h of G.heroes) {
      const d = dist(h.x, h.y, e.x, e.y) || 1, push = 90;
      const nx = (h.x - e.x) / d, ny = (h.y - e.y) / d;
      for (let i = 0; i < 6; i++) G.parts.push({ x: h.x - nx * rnd(10, 60), y: h.y - ny * rnd(10, 60), vx: nx * rnd(260, 420), vy: ny * rnd(260, 420), life: .35, max: .35, col: '#e8fff0', size: 2, shape: 'spark' });
      [h.x, h.y] = heroFreeSpot(h.x + nx * push, h.y + ny * push);
    }
    ftext(e.x, e.y - e.r - 44, fx, col, 18); G.shake = Math.max(G.shake, 8); Snd.play('gust');
  } else if (e.kind === 5) {
    // hide and seek: vanish in a puff of dust and appear somewhere else
    let p = null;
    for (let k = 0; k < 40 && !p; k++) {
      const x = rnd(80, W - 80), y = rnd(TOP + 90, TOP + 330);
      if (dist(x, y, e.x, e.y) < 120) continue;
      if (G.enemies.some(o => o !== e && o.alive && dist(x, y, o.x, o.y) < o.r + e.r + 20)) continue;
      if (G.heroes.some(h => dist(x, y, h.x, h.y) < h.r + e.r + 20)) continue;
      p = [x, y];
    }
    if (!p) return;
    burst(e.x, e.y, '#c9b8ff', 22, 220); burst(e.x, e.y, '#8f88b5', 14, 160);
    e.x = p[0]; e.y = p[1]; e.fade = 1;
    ring(e.x, e.y, e.r * 1.8, col); ftext(e.x, e.y - e.r - 30, fx, col, 18); Snd.play('boo');
  } else if (e.kind === 7) {
    // a web strand pins the hero it hit: that hero loses its next turn unless an ally frees it with a shot
    if (t.ko) return;
    t.webbed = true;
    G.beams.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, life: .6, max: .6, col: '#e8ecf2', w: 3 });
    ftext(t.x, t.y - t.r - 34, fx, col, 18); Snd.play('armor');
  }
}
function drawPuddles() {
  for (const pd of G.puddles || []) {
    const t = RM ? 0 : T;
    ctx.save(); ctx.translate(pd.x, pd.y);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(3, 5, pd.r, pd.r * .62, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8588a'; ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = i / 24 * TAU, w = 1 + .1 * Math.sin(a * 3 + pd.ph) + .04 * Math.sin(t * 2 + a * 5);
      ctx.lineTo(Math.cos(a) * pd.r * w, Math.sin(a) * pd.r * .62 * w);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8fb1'; ctx.beginPath(); ctx.ellipse(-4, -3, pd.r * .72, pd.r * .4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-pd.r * .35, -pd.r * .2, pd.r * .18, pd.r * .07, -.3, 0, TAU); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const ph = frac(t * .5 + k / 3 + pd.ph);
      ctx.strokeStyle = `rgba(255,220,235,${.7 * (1 - ph)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(Math.cos(k * 2 + pd.ph) * pd.r * .4, Math.sin(k * 2) * pd.r * .2, 2 + ph * 5, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------- boss intro ----------
// Before a boss wave: warning stripes, the boss drops in with a thud, then its name, a room-specific
// nickname and catchphrase, its stats and the sensor hint. A tap skips it after a moment.
const INTRO_LEN = 4.2, INTRO_LAND = .9;
function startBossIntro(boss) {
  G.state = 'bossintro';
  G.intro = { t: 0, boss, landed: false };
  Amb.duck(.3);
  playBossIntro();
}
function endBossIntro() {
  G.intro = null;
  Amb.duck(1);
  G.state = 'aim';
  announceHero();
}
function updateBossIntro(dt) {
  const I = G.intro;
  I.t += dt;
  if (!I.landed && I.t >= INTRO_LAND) {
    I.landed = true;
    G.shake = Math.max(G.shake, 16);
    haptic('heavy');
  }
  if (I.t >= INTRO_LEN) endBossIntro();
}
function playBossIntro() {
  if (!Snd.c || !Snd.on) return;
  const s = Snd;
  try {
    for (let i = 0; i < 3; i++) s.tone(520, .24, 'sawtooth', .05, 800, i * .28, 1800);
    s.tone(55, 1.2, 'sawtooth', .13, 36, INTRO_LAND, 420);
    s.noise(.9, .25, 320, 80, INTRO_LAND, 'lowpass');
    s.seq(100, [[1.9, 43, 2, 'brass', 1.2], [1.9, 46, 2, 'brass', 1], [1.9, 50, 2, 'brass', .9], [1.9, 31, 2, 'bass'],
      [1.9, null, 0, 'crash'], [1.9, null, 0, 'kick'], [2.4, null, 0, 'kick', .7], [2.9, null, 0, 'kick', .7]]);
  } catch (e) {}
}
function hazardBand(y, h, off) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
  ctx.fillStyle = '#ffc857'; ctx.fillRect(0, y, W, h);
  ctx.fillStyle = '#15122a';
  for (let x = -h * 2 + (off % (h * 1.6)); x < W + h; x += h * 1.6) {
    ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + h * .8, y + h); ctx.lineTo(x + h * 1.6, y); ctx.lineTo(x + h * .8, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawBossIntro() {
  const I = G.intro;
  if (!I || G.state !== 'bossintro') return;
  const t = I.t, c = G.lvl.ch, ch = G.ch, e = I.boss;
  const fadeOut = Math.min(1, (INTRO_LEN - t) / .3), a = Math.min(1, t / .25, fadeOut);
  const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(8,6,18,.9)'; ctx.fillRect(0, 0, W, H);
  // warning stripes sliding in from both sides
  const band = ease(t / .35);
  ctx.save(); ctx.translate((1 - band) * -W, 0); hazardBand(84, 30, RM ? 0 : T * 60); ctx.restore();
  ctx.save(); ctx.translate((1 - band) * W, 0); hazardBand(706, 30, RM ? 0 : -T * 60); ctx.restore();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (t < INTRO_LAND + .4 || Math.sin(T * 10) > -.2) {
    ctx.fillStyle = '#ff4d6d'; ctx.font = `900 16px ${FD}`;
    fitFont(tr('bossWarn'), W - 40, 16); ctx.fillText(tr('bossWarn'), W / 2, 138);
  }
  // the boss drops in and lands with a shockwave
  const by = 258, R = 94, bc = BOSS_COL[e.kind == null ? 6 : e.kind];
  const k = RM ? 1 : Math.min(1, t / INTRO_LAND), y = RM ? by : -R + (by + R) * k * k;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glowAt(W / 2, by, 210, hexRgb(bc), (I.landed ? .3 + .1 * Math.sin(T * 5) : .12) * a);
  ctx.restore();
  if (I.landed && !RM) {
    const s = t - INTRO_LAND;
    if (s < .6) {
      ctx.strokeStyle = `rgba(255,200,87,${1 - s / .6})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(W / 2, by + R * .85, R * (1 + s * 3), R * (.3 + s), 0, 0, TAU); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(W / 2, by + R * 1.0, R * (.5 + .45 * k), R * .22 * k, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(W / 2, y); drawBoss(e, R, RM ? 0 : T); ctx.restore();
  // name, nickname and catchphrase
  const nameK = ease((t - 1.05) / .35);
  if (nameK > 0) {
    ctx.globalAlpha = a * nameK;
    ctx.save(); ctx.translate(W / 2, 404); ctx.scale(.7 + .3 * nameK, .7 + .3 * nameK);
    ctx.shadowColor = bc; ctx.shadowBlur = 18;
    ctx.fillStyle = bc; fitFont(bossName(e), W - 50, 32); ctx.fillText(bossName(e), 0, 0);
    ctx.restore();
    const [title, quote] = tr('bossTitles')[c % tr('bossTitles').length];
    ctx.fillStyle = ch.col; fitFont(`«${title}»`, W - 60, 18); ctx.fillText(`«${title}»`, W / 2, 438);
    ctx.fillStyle = '#c9c2e6'; ctx.font = `italic 800 14px ${FB}`; fitFont(`„${quote}“`, W - 60, 14, 'italic 800', FB); ctx.fillText(`„${quote}“`, W / 2, 463);
  }
  // stats chips
  const statK = ease((t - 1.4) / .3);
  if (statK > 0) {
    ctx.globalAlpha = a * statK;
    const chips = [[tr('stat.hp'), e.maxHp], [tr('stat.atk'), e.atk], [tr('stat.every'), tr('stat.everyN', e.maxTimer)]];
    const cw = 128, gap = 10, x0 = W / 2 - (cw * 3 + gap * 2) / 2;
    chips.forEach(([label, val], i) => {
      const x = x0 + i * (cw + gap), yy = 488 + (1 - statK) * 14;
      ctx.fillStyle = '#231e44'; rr(x, yy, cw, 46, 12); ctx.fill();
      ctx.strokeStyle = '#3b3563'; ctx.lineWidth = 1.5; rr(x, yy, cw, 46, 12); ctx.stroke();
      ctx.fillStyle = '#8f88b5'; ctx.font = `800 11px ${FB}`; ctx.fillText(label, x + cw / 2, yy + 14);
      ctx.fillStyle = '#f4efe6'; fitFont(String(val), cw - 12, typeof val === 'number' ? 18 : 13); ctx.fillText(String(val), x + cw / 2, yy + 32);
    });
  }
  // its ability
  const skK = ease((t - 1.7) / .3);
  if (skK > 0) {
    ctx.globalAlpha = a * skK;
    const [sName, sDesc] = tr('bossSkills')[e.kind == null ? 6 : e.kind], sy = 546;
    ctx.fillStyle = 'rgba(35,30,68,.95)'; rr(30, sy, W - 60, 58, 14); ctx.fill();
    ctx.strokeStyle = bc; ctx.lineWidth = 2; rr(30, sy, W - 60, 58, 14); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8f88b5'; ctx.font = `800 11px ${FB}`; ctx.fillText(tr('skillLabel').toUpperCase(), 46, sy + 16);
    const lw = ctx.measureText(tr('skillLabel').toUpperCase()).width;
    ctx.fillStyle = bc; fitFont(sName, W - 120 - lw, 15); ctx.fillText(sName, 54 + lw, sy + 16);
    ctx.fillStyle = '#f4efe6'; fitFont(sDesc, W - 92, 13, 800, FB); ctx.fillText(sDesc, 46, sy + 40);
    ctx.textAlign = 'center';
  }
  // how to beat it
  const hintK = ease((t - 2.0) / .3);
  if (hintK > 0) {
    ctx.globalAlpha = a * hintK;
    const hy = 614;
    ctx.fillStyle = 'rgba(255,224,102,.12)'; rr(30, hy, W - 60, 40, 14); ctx.fill();
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5; rr(30, hy, W - 60, 40, 14); ctx.stroke();
    const p = 1 + Math.sin(T * 6) * .15;
    ctx.fillStyle = 'rgba(255,224,102,.35)'; circ(56, hy + 20, 12 * p);
    ctx.fillStyle = '#ffe066'; circ(56, hy + 20, 7); ctx.fillStyle = '#fff'; circ(56, hy + 20, 3);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffe066';
    fitFont(tr('bossHint'), W - 120, 14, 900, FB); ctx.fillText(tr('bossHint'), 76, hy + 21);
    ctx.textAlign = 'center';
  }
  if (t > 2.4) {
    ctx.globalAlpha = a * (.55 + .45 * Math.sin(T * 4));
    ctx.fillStyle = '#c9c2e6'; ctx.font = `800 13px ${FB}`; ctx.fillText(tr('tapToStart'), W / 2, 682);
  }
  ctx.restore();
}

function announceHero() { G.typeTag = { life: 1.6, max: 1.6 }; }
function drawTypeTag() {
  const tg = G.typeTag;
  if (!tg || G.state !== 'aim' || drag) return;
  const h = G.heroes[G.cur], k = tg.life / tg.max;
  const a = Math.min(1, k * 3, (1 - k) * 8), rise = (1 - k) * 10;
  const [title, sub] = tr('tag.' + h.type);
  const y = Math.max(TOP + 34, h.y - h.r - 44 - rise);
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `900 15px ${FD}`;
  const w = Math.max(ctx.measureText(title).width, 120) + 26;
  const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, h.x));
  ctx.fillStyle = 'rgba(21,18,42,.92)'; rr(x - w / 2, y - 20, w, 40, 12); ctx.fill();
  ctx.strokeStyle = h.yarn; ctx.lineWidth = 2; rr(x - w / 2, y - 20, w, 40, 12); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = h.yarn; ctx.fillText(title, x, y - 6);
  ctx.fillStyle = '#c9c2e6'; ctx.font = `800 10px ${FB}`; ctx.fillText(sub, x, y + 10);
  ctx.restore();
}

function heart(x, y, s, fill) {
  ctx.fillStyle = fill; ctx.beginPath();
  ctx.moveTo(x, y + s * .9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * .1, x - s * .6, y - s * 1.1, x, y - s * .35);
  ctx.bezierCurveTo(x + s * .6, y - s * 1.1, x + s * 1.4, y - s * .1, x, y + s * .9);
  ctx.fill();
}
function heartsRow(h, cx, y, s) {
  const gap = s * 2.6, x0 = cx - (h.maxHearts - 1) * gap / 2;
  for (let i = 0; i < h.maxHearts; i++) heart(x0 + i * gap, y, s, i < h.hearts ? '#ff5d7a' : 'rgba(59,53,99,.9)');
}
// dashed line from each enemy about to strike to the hero it will hit
function drawThreats() {
  if (G.state !== 'aim' && G.state !== 'moving') return;
  for (const e of G.enemies) {
    if (!e.alive || e.timer > 1) continue;
    const t = targetOf(e);
    if (!t) continue;
    ctx.save();
    ctx.globalAlpha = .45 + .25 * Math.sin(T * 8);
    ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = RM ? 0 : -T * 30;
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 13, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

function drawHat(kind, r) {
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 1.5;
  if (kind === 'party') {
    ctx.translate(r * .1, -r * .82); ctx.rotate(.12);
    ctx.fillStyle = '#ff8fb1'; ctx.strokeStyle = '#c2466e';
    ctx.beginPath(); ctx.moveTo(-r * .38, 0); ctx.lineTo(r * .38, 0); ctx.lineTo(0, -r * .95); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#ffd166';
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-r * .5, -r * (.1 + k * .3)); ctx.lineTo(r * .5, -r * (.26 + k * .3)); ctx.lineTo(r * .5, -r * (.36 + k * .3)); ctx.lineTo(-r * .5, -r * (.2 + k * .3)); ctx.fill(); }
    ctx.restore(); ctx.stroke();
    ctx.fillStyle = '#fff'; circ(0, -r * .95, r * .13);
  } else if (kind === 'crown') {
    ctx.translate(0, -r * .86);
    ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#b8892a';
    ctx.beginPath(); ctx.moveTo(-r * .5, r * .12); ctx.lineTo(-r * .5, -r * .3); ctx.lineTo(-r * .25, -r * .08); ctx.lineTo(0, -r * .42);
    ctx.lineTo(r * .25, -r * .08); ctx.lineTo(r * .5, -r * .3); ctx.lineTo(r * .5, r * .12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e5484d'; circ(0, -r * .02, r * .08);
    ctx.fillStyle = '#4fc3f7'; circ(-r * .3, r * .02, r * .06); circ(r * .3, r * .02, r * .06);
  } else if (kind === 'pumpkin') {
    ctx.translate(0, -r * .92);
    ctx.fillStyle = '#ff8a3c'; ctx.strokeStyle = '#b8521a';
    ctx.beginPath(); ctx.ellipse(0, 0, r * .5, r * .32, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, r * .2, r * .32, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#3f8a3c'; ctx.fillRect(-r * .05, -r * .5, r * .1, r * .2);
    ctx.beginPath(); ctx.ellipse(r * .14, -r * .42, r * .12, r * .06, -.5, 0, TAU); ctx.fill();
  } else if (kind === 'santa') {
    ctx.translate(-r * .05, -r * .8); ctx.rotate(-.15);
    ctx.fillStyle = '#e5484d'; ctx.beginPath(); ctx.moveTo(-r * .45, 0); ctx.quadraticCurveTo(-r * .1, -r * .95, r * .58, -r * .55); ctx.lineTo(r * .42, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; rr(-r * .5, -r * .08, r * .98, r * .2, r * .1); ctx.fill(); circ(r * .6, -r * .55, r * .13);
  } else {
    ctx.translate(-r * .55, -r * .8); ctx.rotate(-.3);
    ctx.fillStyle = '#ff5d8f'; ctx.strokeStyle = '#b8325e';
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sd * r * .42, -r * .22); ctx.lineTo(sd * r * .42, r * .22); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#ff8fb1'; ctx.beginPath(); ctx.arc(0, 0, r * .12, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Each hero is a little character: Mochi a fluffy tabby with a bell, Pixel a cool black cat with shades,
// Bandit a raccoon in a bandana, Nugget a chubby raccoon crowned with a bottle cap.
function drawCritter(h, x, y, r, glow, o) {
  const dog = h.kind === 'dog', t = RM ? 0 : T;
  const mood = o.mood || (h.hurt > 0 ? 'hurt' : h.happy > 0 ? 'happy' : null);
  ctx.save(); ctx.translate(x, y);
  if (mood === 'hurt' && !RM) ctx.translate(Math.sin(T * 60) * 1.5, 0);
  if (glow) { ctx.fillStyle = glow; ctx.globalAlpha = .35 + .15 * Math.sin(T * 8); circ(0, 0, r * 1.6); ctx.globalAlpha = 1; }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = h.yarn; ctx.lineWidth = 2;
  if (dog) {
    // wagging tail, floppy ears
    const wag = Math.sin(t * 10) * r * .15;
    ctx.fillStyle = h.fur; ctx.beginPath(); ctx.ellipse(r * .95 + wag * .3, r * .3, r * .14, r * .38, .6 + wag / r, 0, TAU); ctx.fill(); ctx.stroke();
    for (const sd of [-1, 1]) { ctx.fillStyle = h.dark; ctx.beginPath(); ctx.ellipse(sd * r * .85, -r * .05, r * .28, r * .55, sd * .35, 0, TAU); ctx.fill(); ctx.stroke(); }
  } else {
    for (const sd of [-1, 1]) { ctx.fillStyle = h.dark; circ(sd * r * .62, -r * .78, r * .26); ctx.fillStyle = '#f7a1b5'; circ(sd * r * .62, -r * .78, r * .13); }
  }
  // head
  ctx.fillStyle = h.fur; ctx.beginPath(); ctx.ellipse(0, 0, r * (dog ? .92 : 1.05), r * (dog ? .98 : .92), 0, 0, TAU); ctx.fill(); ctx.stroke();
  const sg = ctx.createRadialGradient(-r * .35, -r * .45, r * .1, 0, 0, r * 1.05);
  sg.addColorStop(0, 'rgba(255,255,255,.2)'); sg.addColorStop(.55, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(0, 0, r * (dog ? .92 : 1.05), r * (dog ? .98 : .92), 0, 0, TAU); ctx.fill();
  if (dog) { ctx.fillStyle = h.dark; ctx.beginPath(); ctx.ellipse(r * .35, -r * .4, r * .28, r * .22, .3, 0, TAU); ctx.fill(); }
  else { ctx.fillStyle = h.muzzle; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * r * .55, r * .3, r * .38, r * .32, 0, 0, TAU); ctx.fill(); } }
  // muzzle
  ctx.fillStyle = h.muzzle; ctx.beginPath(); ctx.ellipse(0, r * .38, r * (dog ? .42 : .3), r * (dog ? .32 : .22), 0, 0, TAU); ctx.fill();
  // eyes
  const lk = o.look || [0, 0];
  for (const sd of [-1, 1]) {
    const ex = sd * r * .34 + lk[0] * r * .05, ey = -r * .1 + lk[1] * r * .05;
    if (mood === 'happy') { ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = r * .08; ctx.beginPath(); ctx.arc(ex, ey + r * .04, r * .12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    else if (mood === 'hurt') { ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = r * .07; ctx.beginPath(); ctx.moveTo(ex - r * .1, ey - r * .1); ctx.lineTo(ex + r * .1, ey + r * .1); ctx.moveTo(ex + r * .1, ey - r * .1); ctx.lineTo(ex - r * .1, ey + r * .1); ctx.stroke(); }
    else { ctx.fillStyle = '#1b1b22'; circ(ex, ey, r * .14); ctx.fillStyle = '#fff'; circ(ex + r * .05, ey - r * .05, r * .05); }
  }
  // nose, mouth
  ctx.fillStyle = dog ? '#1b1b22' : '#ff8fb1';
  ctx.beginPath(); ctx.ellipse(0, r * (dog ? .24 : .26), r * (dog ? .14 : .08), r * (dog ? .1 : .06), 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = Math.max(1.2, r * .05);
  ctx.beginPath(); ctx.moveTo(-r * .12, r * .42); ctx.quadraticCurveTo(0, r * .5, r * .12, r * .42); ctx.stroke();
  if (dog) { ctx.fillStyle = '#ff7a9c'; ctx.beginPath(); ctx.ellipse(r * .06, r * .54, r * .09, r * .13, 0, 0, TAU); ctx.fill(); }
  else { ctx.fillStyle = '#fff'; ctx.fillRect(-r * .07, r * .45, r * .06, r * .1); ctx.fillRect(r * .01, r * .45, r * .06, r * .1); }
  // accessories: a red rescue collar with a cross / a sunflower seed
  if (dog) {
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = r * .14; ctx.beginPath(); ctx.arc(0, 0, r * .9, .28 * Math.PI, .72 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#fff'; circ(0, r * .98, r * .15);
    ctx.fillStyle = '#e5484d'; ctx.fillRect(-r * .03, r * .88, r * .06, r * .2); ctx.fillRect(-r * .1, r * .95, r * .2, r * .06);
  } else {
    ctx.save(); ctx.translate(r * .5, r * .8); ctx.rotate(-.5);
    ctx.fillStyle = '#3a3226'; ctx.beginPath(); ctx.ellipse(0, 0, r * .12, r * .2, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -r * .15); ctx.lineTo(0, r * .15); ctx.stroke();
    ctx.restore();
  }
  const hat = o.hat === false ? null : activeHat();
  if (hat) drawHat(hat, r);
  ctx.restore();
}
function drawHero(h, x, y, r, glow, o = {}) {
  if (h.kind === 'dog' || h.kind === 'hamster') { drawCritter(h, x, y, r, glow, o); return; }
  const cat = h.kind === 'cat', id = h.id, k = HIDX[id], t = RM ? 0 : T;
  const mood = o.mood || (h.hurt > 0 ? 'hurt' : h.happy > 0 ? 'happy' : null);
  ctx.save(); ctx.translate(x, y);
  if (mood === 'hurt' && !RM) ctx.translate(Math.sin(T * 60) * 1.5, 0);
  if (glow) { ctx.fillStyle = glow; ctx.globalAlpha = .35 + .15 * Math.sin(T * 8); circ(0, 0, r * 1.6); ctx.globalAlpha = 1; }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  heroTail(h, r, t, k);
  // ears
  for (const s of [-1, 1]) {
    ctx.lineWidth = 2; ctx.strokeStyle = h.yarn;
    if (cat) {
      const tall = id === 'pixel' ? 1.34 : 1.16, twitch = id === 'mochi' && s === 1 && frac(t * .3) < .04 ? .12 : 0;
      ctx.fillStyle = h.fur;
      ctx.beginPath(); ctx.moveTo(s * r * .95, -r * .2); ctx.lineTo(s * r * (.66 + twitch), -r * tall); ctx.lineTo(s * r * .1, -r * .8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = id === 'pixel' ? '#6d4fb0' : '#f7a1b5';
      ctx.beginPath(); ctx.moveTo(s * r * .74, -r * .42); ctx.lineTo(s * r * (.64 + twitch), -r * (tall - .24)); ctx.lineTo(s * r * .32, -r * .74); ctx.closePath(); ctx.fill();
      if (id === 'mochi') {
        ctx.strokeStyle = h.muzzle; ctx.lineWidth = 1.2;
        for (const d of [-.06, .06]) { ctx.beginPath(); ctx.moveTo(s * r * .58, -r * .5); ctx.lineTo(s * r * (.56 + d), -r * .78); ctx.stroke(); }
      }
      if (id === 'pixel' && s === 1) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(r * .86, -r * .5, r * .11, 0, TAU); ctx.stroke(); }
    } else {
      ctx.fillStyle = h.dark;
      ctx.beginPath(); ctx.arc(s * r * .62, -r * .72, r * .36, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = id === 'bandit' ? '#f1ece4' : '#e8c9a8'; circ(s * r * .62, -r * .72, r * .22);
      ctx.fillStyle = id === 'bandit' ? '#555a66' : '#c79a7a'; circ(s * r * .62, -r * .68, r * .12);
    }
  }
  // cheek fluff
  if (id !== 'pixel') {
    ctx.fillStyle = id === 'bandit' ? '#e4e1dc' : h.fur; ctx.strokeStyle = h.yarn; ctx.lineWidth = 2;
    const wd = id === 'nugget' ? 1.1 : 1;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * .8 * wd, -r * .1); ctx.lineTo(s * r * 1.17 * wd, r * .1); ctx.lineTo(s * r * .98 * wd, r * .24);
      ctx.lineTo(s * r * 1.12 * wd, r * .42); ctx.lineTo(s * r * .72 * wd, r * .62); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // head
  const hw = id === 'nugget' ? 1.08 : 1, hh = id === 'nugget' ? .94 : .97;
  ctx.fillStyle = h.fur; ctx.strokeStyle = h.yarn; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0, 0, r * hw, r * hh, 0, 0, TAU); ctx.fill(); ctx.stroke();
  const sg = ctx.createRadialGradient(-r * .35, -r * .45, r * .1, 0, 0, r * 1.05);
  sg.addColorStop(0, 'rgba(255,255,255,.2)'); sg.addColorStop(.55, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(0,0,0,.2)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(0, 0, r * hw, r * hh, 0, 0, TAU); ctx.fill();
  // markings
  if (id === 'mochi') {
    ctx.strokeStyle = h.dark; ctx.lineWidth = r * .09;
    ctx.beginPath(); ctx.moveTo(-r * .32, -r * .52); ctx.lineTo(-r * .18, -r * .82); ctx.lineTo(0, -r * .6); ctx.lineTo(r * .18, -r * .82); ctx.lineTo(r * .32, -r * .52); ctx.stroke();
    for (const s of [-1, 1]) for (const dy of [-.02, .16]) { ctx.beginPath(); ctx.moveTo(s * r * .97, r * dy); ctx.lineTo(s * r * .72, r * (dy + .03)); ctx.stroke(); }
  } else if (id === 'pixel') {
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = r * .08; ctx.beginPath(); ctx.arc(0, 0, r * .8, -2.5, -1.7); ctx.stroke();
  } else if (id === 'bandit') {
    ctx.fillStyle = h.dark;
    ctx.beginPath(); ctx.moveTo(-r * .13, -r * .97); ctx.lineTo(r * .13, -r * .97); ctx.lineTo(0, -r * .35); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 1.02, -r * .18); ctx.quadraticCurveTo(0, -r * .48, r * 1.02, -r * .18);
    ctx.lineTo(r * .72, r * .2); ctx.quadraticCurveTo(0, r * .02, -r * .72, r * .2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = h.muzzle;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * .38, -r * .43, r * .19, r * .065, s * .28, 0, TAU); ctx.fill(); }
  } else if (id === 'spark') {
    ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#d4a800'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-r * .02, -r * .9); ctx.lineTo(-r * .2, -r * .55); ctx.lineTo(-r * .02, -r * .58);
    ctx.lineTo(-r * .12, -r * .3); ctx.lineTo(r * .16, -r * .68); ctx.lineTo(-r * .01, -r * .65); ctx.lineTo(r * .12, -r * .9); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(122,100,80,.85)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * .37, -r * .04, r * .33, r * .25, s * .35, 0, TAU); ctx.fill(); }
    ctx.fillStyle = h.dark; ctx.beginPath(); ctx.ellipse(0, -r * .62, r * .07, r * .2, 0, 0, TAU); ctx.fill();
  }
  // muzzle
  ctx.fillStyle = h.muzzle;
  if (cat) { circ(-r * .16, r * .36, r * .22); circ(r * .16, r * .36, r * .22); }
  else { ctx.beginPath(); ctx.ellipse(0, r * .42, r * .46, r * .3, 0, 0, TAU); ctx.fill(); }
  if (id === 'mochi' || id === 'nugget') {
    ctx.fillStyle = 'rgba(255,110,140,.35)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * .64, r * .28, r * .15, r * .08, 0, 0, TAU); ctx.fill(); }
  }
  if (id === 'nugget') { ctx.fillStyle = '#8a6a52'; for (const s of [-1, 1]) for (const [dx, dy] of [[.55, .16], [.66, .2], [.6, .26]]) circ(s * r * dx, r * dy, r * .03 + .4); }
  heroEyes(h, r, o, mood);
  // nose & mouth
  ctx.lineWidth = Math.max(1.2, r * .06); ctx.strokeStyle = '#1b1b22';
  if (cat) {
    ctx.fillStyle = id === 'pixel' ? '#b18cff' : '#ff7a9c';
    ctx.beginPath(); ctx.moveTo(-r * .1, r * .2); ctx.lineTo(r * .1, r * .2); ctx.lineTo(0, r * .31); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    if (id === 'mochi') { ctx.moveTo(-r * .16, r * .36); ctx.quadraticCurveTo(-r * .08, r * .46, 0, r * .33); ctx.quadraticCurveTo(r * .08, r * .46, r * .16, r * .36); }
    else { ctx.moveTo(-r * .1, r * .4); ctx.quadraticCurveTo(r * .06, r * .44, r * .17, r * .33); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
    for (const s of [-1, 1]) for (const kk of (id === 'mochi' ? [-1, 0, 1] : [-1, 1])) {
      ctx.beginPath(); ctx.moveTo(s * r * .32, r * .36); ctx.lineTo(s * r * 1.18, r * (.3 + kk * .12)); ctx.stroke();
    }
  } else {
    ctx.fillStyle = id === 'nugget' ? '#ff8fb1' : '#1b1b22';
    ctx.beginPath(); ctx.ellipse(0, r * .25, r * .13, r * .085, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)'; circ(-r * .04, r * .22, r * .03);
    ctx.beginPath();
    if (id === 'bandit') { ctx.moveTo(-r * .16, r * .47); ctx.quadraticCurveTo(0, r * .55, r * .2, r * .42); ctx.stroke(); }
    else {
      ctx.moveTo(-r * .15, r * .42); ctx.quadraticCurveTo(0, r * .5, r * .15, r * .42); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(-r * .075, r * .45, r * .07, r * .09); ctx.fillRect(r * .005, r * .45, r * .07, r * .09);
    }
  }
  // accessories
  if (id === 'mochi') {
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = r * .14; ctx.beginPath(); ctx.arc(0, 0, r * .9, .28 * Math.PI, .72 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; circ(0, r * .95, r * .14);
    ctx.fillStyle = '#b8892a'; ctx.fillRect(-r * .1, r * .95, r * .2, r * .03);
    ctx.fillStyle = '#fff'; circ(-r * .05, r * .9, r * .04);
  } else if (id === 'pixel') {
    ctx.save(); ctx.translate(0, -r * .6); ctx.rotate(-.08);
    ctx.fillStyle = '#0d0b16';
    for (const s of [-1, 1]) rr(s * r * .26 - r * .19, -r * .1, r * .38, r * .2, r * .04), ctx.fill();
    ctx.fillRect(-r * .08, -r * .06, r * .16, r * .05);
    ctx.fillStyle = '#b18cff';
    for (const s of [-1, 1]) { ctx.fillRect(s * r * .26 - r * .12, -r * .06, r * .06, r * .06); ctx.fillRect(s * r * .26 - r * .06, -r * .0, r * .05, r * .05); }
    ctx.restore();
  } else if (id === 'bandit') {
    const fl = Math.sin(t * 7) * r * .08;
    ctx.fillStyle = h.yarn;
    ctx.beginPath(); ctx.moveTo(-r * .72, r * .68); ctx.quadraticCurveTo(0, r * .82, r * .72, r * .68); ctx.lineTo(0, r * 1.14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * .66, r * .66); ctx.lineTo(r * 1.08, r * .5 + fl); ctx.lineTo(r * 1.0, r * .78 + fl); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; for (const [dx, dy] of [[-.35, .78], [0, .86], [.35, .78], [-.1, 1.0], [.12, .96]]) circ(r * dx, r * dy, r * .035 + .3);
    ctx.fillStyle = '#3fb8a0'; circ(r * .68, r * .66, r * .1);
  } else if (id === 'spark') {
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = r * .14; ctx.beginPath(); ctx.arc(0, 0, r * .9, .28 * Math.PI, .72 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.moveTo(r * .04, r * .86); ctx.lineTo(-r * .1, r * 1.04); ctx.lineTo(0, r * 1.02); ctx.lineTo(-r * .05, r * 1.16); ctx.lineTo(r * .1, r * .96); ctx.lineTo(0, r * .98); ctx.closePath(); ctx.fill();
  } else if (!(o.hat !== false && activeHat())) {
    ctx.save(); ctx.translate(r * .16, -r * .9); ctx.rotate(.25);
    ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#b8892a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-r * .32, r * .08);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-r * .32 + i * r * .107, i % 2 ? -r * .2 : -r * .05);
    ctx.lineTo(r * .32, r * .08); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff8fb1'; circ(0, r * .01, r * .075);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; circ(-r * .02, -r * .01, r * .025);
    ctx.restore();
  }
  const hat = o.hat === false ? null : activeHat();
  if (hat) drawHat(hat, r);
  // front paws
  const px = id === 'bandit' ? .6 : .46, pc = cat ? h.fur : h.dark;
  for (const s of [-1, 1]) {
    ctx.fillStyle = pc; ctx.strokeStyle = h.yarn; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(s * r * px, r * .92, r * .2, r * .14, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
    for (const d of [-.06, .06]) { ctx.beginPath(); ctx.moveTo(s * r * px + r * d, r * .86); ctx.lineTo(s * r * px + r * d, r * .96); ctx.stroke(); }
  }
  ctx.restore();
}

function angryEyes(cx, cy, w, col) {
  ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(cx + s * w * .28, cy); ctx.rotate(-s * .35);
    ctx.fillRect(-w * .16, -w * .065, w * .32, w * .13);
    ctx.restore();
  }
  ctx.shadowBlur = 0;
}
function frown(y, w, col) { ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, y + w, w, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke(); }

function drawVac(e, r, t) {
  const g = ctx.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r);
  g.addColorStop(0, '#f4f6fa'); g.addColorStop(1, '#a3aabb');
  ctx.fillStyle = g; circ(0, 0, r);
  ctx.strokeStyle = '#5d6475'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const cx = s * r * .74, cy = -r * .7;
    ctx.fillStyle = '#4a5162'; circ(cx, cy, r * .09);
    ctx.strokeStyle = '#3a3f4d'; ctx.lineWidth = Math.max(1.6, r * .06);
    for (let i = 0; i < 3; i++) { const a = t * 9 * s + i * 2.09; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * .4, cy + Math.sin(a) * r * .4); ctx.stroke(); }
  }
  ctx.strokeStyle = '#2f3440'; ctx.lineWidth = r * .17; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(0, 0, r * .9, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r * .66, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#1b1e27'; rr(-r * .56, -r * .36, r * 1.12, r * .38, r * .19); ctx.fill();
  angryEyes(0, -r * .17, r * .62, '#ff3b5c');
  ctx.save(); rr(-r * .34, r * .18, r * .68, r * .36, r * .12); ctx.fillStyle = 'rgba(40,48,64,.9)'; ctx.fill(); ctx.clip();
  ctx.fillStyle = 'rgba(210,195,170,.85)';
  for (let i = 0; i < 7; i++) { const a = t * 4 + i * .9; circ(Math.cos(a) * r * .22, r * .36 + Math.sin(a * 1.3) * r * .1, 1.2); }
  ctx.restore();
  ctx.fillStyle = e.timer <= 1 ? (Math.sin(T * 12) > 0 ? '#ff3b5c' : '#5a1020') : '#3dd68c'; circ(r * .62, r * .32, 2.3);
}

function drawSpray(e, r, t) {
  ctx.save(); rr(-r * .6, -r * .45, r * 1.2, r * 1.42, r * .34);
  const bg = ctx.createLinearGradient(-r * .6, 0, r * .6, 0);
  bg.addColorStop(0, '#a9d6ff'); bg.addColorStop(.5, '#63adf2'); bg.addColorStop(1, '#3b7fcc');
  ctx.fillStyle = bg; ctx.fill(); ctx.clip();
  const lv = r * .12 + Math.sin(t * 3 + e.ph) * r * .05;
  ctx.fillStyle = 'rgba(25,100,210,.7)'; ctx.beginPath(); ctx.moveTo(-r, r * 1.2); ctx.lineTo(-r, lv);
  for (let x = -r; x <= r; x += r * .2) ctx.lineTo(x, lv + Math.sin(x * .3 + t * 5) * 1.6);
  ctx.lineTo(r, r * 1.2); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 4; i++) { const p = frac(t * .6 + i * .27 + e.ph); ctx.fillStyle = `rgba(255,255,255,${.6 * (1 - p)})`; circ(-r * .3 + i * r * .2, r * .92 - p * r * .75, 1.4); }
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(-r * .46, -r * .36, r * .1, r * 1.1);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.94)'; rr(-r * .44, -r * .08, r * .88, r * .56, r * .12); ctx.fill();
  angryEyes(0, r * .1, r * .55, '#e03050');
  frown(r * .36, r * .13, '#e03050');
  ctx.fillStyle = '#e8e8f0'; ctx.fillRect(-r * .22, -r * .62, r * .44, r * .2);
  ctx.strokeStyle = '#f25f5c'; ctx.lineWidth = r * .13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(r * .12, -r * .62); ctx.quadraticCurveTo(r * .58, -r * .55, r * .44, -r * .2); ctx.stroke();
  const hg = ctx.createLinearGradient(0, -r * 1.08, 0, -r * .6);
  hg.addColorStop(0, '#ff7b77'); hg.addColorStop(1, '#d9423f');
  ctx.fillStyle = hg; rr(-r * .42, -r * 1.08, r * .84, r * .48, r * .14); ctx.fill();
  ctx.fillStyle = '#b53633'; ctx.fillRect(r * .36, -r * .98, r * .42, r * .18);
  const mp = frac(t * .45 + e.ph * .1);
  if (mp < .35) {
    const q = mp / .35;
    for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(190,230,255,${(1 - q) * .55})`; circ(r * .82 + q * r * .9 + i * 2, -r * .9 + (i - 2) * q * 4, 1.5 + q * 3); }
  }
}

function drawBrush(e, r, t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glowAt(0, 0, r * 2.2, '61,214,140', .12 + .06 * Math.sin(t * 3 + e.ph)); ctx.restore();
  const g = ctx.createLinearGradient(-r * .5, 0, r * .5, 0);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9d3e6');
  ctx.fillStyle = g; rr(-r * .45, -r * .5, r * .9, r * 1.45, r * .4); ctx.fill();
  ctx.strokeStyle = '#6f8aa0'; ctx.lineWidth = 2; rr(-r * .45, -r * .5, r * .9, r * 1.45, r * .4); ctx.stroke();
  ctx.fillStyle = '#3dd68c'; rr(-r * .45, r * .32, r * .9, r * .22, r * .1); ctx.fill();
  const vib = RM ? 0 : Math.sin(t * 40) * 1.2;
  ctx.fillStyle = '#dfe9f2'; ctx.fillRect(-r * .14 + vib, -r * .95, r * .28, r * .5);
  ctx.fillStyle = '#6ec3ff'; rr(-r * .32 + vib, -r * 1.2, r * .64, r * .32, r * .1); ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) ctx.fillRect(-r * .28 + i * r * .13 + vib, -r * 1.36, r * .07, r * .18);
  angryEyes(0, -r * .12, r * .55, '#e03050');
  frown(r * .1, r * .12, '#6f8aa0');
  ctx.fillStyle = '#3dd68c'; ctx.fillRect(r * .5, -r * .72, r * .3, r * .1); ctx.fillRect(r * .6, -r * .82, r * .1, r * .3);
}

function drawFan(e, r, t) {
  // how far the wind reaches
  ctx.strokeStyle = 'rgba(200,240,255,.14)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]); ctx.lineDashOffset = -t * 20;
  ctx.beginPath(); ctx.arc(0, 0, FAN_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  for (let k = 0; k < 3; k++) {
    const ph = frac(t * .8 + k / 3);
    ctx.strokeStyle = `rgba(200,240,255,${.2 * (1 - ph)})`; ctx.beginPath(); ctx.arc(0, 0, r + ph * (FAN_R - r), 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = '#e8eef4'; circ(0, 0, r);
  ctx.strokeStyle = '#7d8a99'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.save(); ctx.rotate(t * 14);
  ctx.fillStyle = 'rgba(158,224,106,.9)';
  for (let k = 0; k < 3; k++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.ellipse(0, -r * .45, r * .2, r * .42, .4, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(90,100,115,.7)'; ctx.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .3, Math.sin(a) * r * .3); ctx.lineTo(Math.cos(a) * r * .95, Math.sin(a) * r * .95); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#2f3440'; circ(0, 0, r * .32);
  angryEyes(0, -r * .02, r * .5, '#ff3b5c');
}

function drawRc(e, r, t) {
  ctx.save(); ctx.rotate((e.ang || -Math.PI / 2) + Math.PI / 2);
  ctx.fillStyle = '#1b1b22';
  for (const [x, y] of [[-r * .62, -r * .5], [r * .62, -r * .5], [-r * .62, r * .5], [r * .62, r * .5]]) { rr(x - r * .16, y - r * .24, r * .32, r * .48, r * .08); ctx.fill(); }
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#ff7a5c'); g.addColorStop(1, '#c9402a');
  ctx.fillStyle = g; rr(-r * .55, -r * .95, r * 1.1, r * 1.9, r * .35); ctx.fill();
  ctx.strokeStyle = '#8a2a1c'; ctx.lineWidth = 2; rr(-r * .55, -r * .95, r * 1.1, r * 1.9, r * .35); ctx.stroke();
  ctx.fillStyle = '#2b3a55'; rr(-r * .42, -r * .5, r * .84, r * .46, r * .12); ctx.fill();
  angryEyes(0, -r * .28, r * .5, '#ff3b5c');
  ctx.fillStyle = '#ffd166'; ctx.fillRect(-r * .1, r * .2, r * .2, r * .6);
  ctx.restore();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r * .3, -r * .3); ctx.lineTo(r * .55, -r * 1.15); ctx.stroke();
  ctx.fillStyle = Math.sin(t * 10 + e.ph) > 0 ? '#ff3b5c' : '#5a1020'; circ(r * .55, -r * 1.15, 2.5);
}

function drawShield(e, r, t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glowAt(0, 0, r * 2, '110,195,255', .15 + .05 * Math.sin(t * 3 + e.ph)); ctx.restore();
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
  g.addColorStop(0, '#e6f0fa'); g.addColorStop(1, '#7d8ea3');
  ctx.fillStyle = g; circ(0, 0, r);
  ctx.strokeStyle = '#4a5a70'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#6ec3ff'; ctx.beginPath(); ctx.arc(0, -r * .5, r * .34, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 1.5;
  for (let k = 0; k < 2; k++) {
    const ph = frac(t * .9 + k * .5);
    ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.arc(0, -r * .5, r * .34 + ph * r * .9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1b1e27'; rr(-r * .56, -r * .08, r * 1.12, r * .38, r * .19); ctx.fill();
  angryEyes(0, r * .11, r * .62, '#6ec3ff');
}

function drawSplit(e, r, t) {
  const wob = RM ? 0 : Math.sin(t * 4 + e.ph) * 1.5;
  for (const sd of [-1, 1]) {
    const cx = sd * (r * .32 + wob * .3);
    const g = ctx.createRadialGradient(cx - r * .25, -r * .3, r * .1, cx, 0, r * .75);
    g.addColorStop(0, '#ffe0b0'); g.addColorStop(1, '#d98f3d');
    ctx.fillStyle = g; circ(cx, 0, r * .72);
    ctx.strokeStyle = '#8a5a20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, 0, r * .72, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, -r * .62); ctx.lineTo(0, r * .62); ctx.stroke(); ctx.setLineDash([]);
  for (const sd of [-1, 1]) angryEyes(sd * r * .36, -r * .08, r * .42, '#ff3b5c');
}

// shield bots: a faint range and a link to every enemy they protect
function drawShields() {
  for (const sb of G.enemies) {
    if (!sb.alive || sb.type !== 'shield') continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(110,195,255,.12)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 7]);
    ctx.beginPath(); ctx.arc(sb.x, sb.y, SHIELD_R, 0, TAU); ctx.stroke();
    ctx.lineDashOffset = RM ? 0 : -T * 25; ctx.setLineDash([5, 6]);
    for (const e of G.enemies) {
      if (!e.alive || e === sb || dist(sb.x, sb.y, e.x, e.y) >= SHIELD_R + e.r) continue;
      ctx.strokeStyle = 'rgba(110,195,255,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sb.x, sb.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = `rgba(110,195,255,${.45 + .2 * Math.sin(T * 4 + e.ph)})`; ctx.lineWidth = 2.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, 0, TAU); ctx.stroke(); ctx.setLineDash([5, 6]);
    }
    ctx.restore();
  }
}

function drawMop(e, r, t) {
  ctx.strokeStyle = '#9fb3c8'; ctx.lineWidth = 5; ctx.globalAlpha = .7 + .3 * Math.sin(T * 4);
  ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = '#e3ebf3';
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + .2; circ(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), 1.8); }
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
  g.addColorStop(0, '#ffe38f'); g.addColorStop(1, '#dc9f22');
  ctx.fillStyle = g; circ(0, 0, r - 3);
  ctx.strokeStyle = '#b8892a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r - 3, 0, TAU); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r * .72, 0, TAU); ctx.clip();
  ctx.fillStyle = '#4aa3e0'; ctx.beginPath(); ctx.ellipse(0, -r * .2, r * .64, r * .34, 0, 0, TAU); ctx.fill();
  const rp = frac(t * .8 + e.ph);
  ctx.strokeStyle = `rgba(255,255,255,${.5 * (1 - rp)})`; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(-r * .2, -r * .22, r * .1 + rp * r * .3, (r * .1 + rp * r * .3) * .5, 0, 0, TAU); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#7b8494'; rr(-r * .78, -r * .64, r * .52, r * .26, r * .06); ctx.fill();
  ctx.strokeStyle = '#5b6372'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-r * .78 + i * r * .13, -r * .62); ctx.lineTo(-r * .78 + i * r * .13, -r * .4); ctx.stroke(); }
  ctx.strokeStyle = '#b98a57'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(r * .15, -r * .3); ctx.lineTo(r * .62, -r * 1.3); ctx.stroke();
  ctx.strokeStyle = '#ece6da'; ctx.lineWidth = 3;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(r * .15 + i * r * .05, -r * .32);
    ctx.quadraticCurveTo(r * .1 + i * r * .16 + Math.sin(t * 5 + i) * 2, -r * .05, r * .05 + i * r * .15, r * .12 + Math.abs(i) * r * .03);
    ctx.stroke();
  }
  angryEyes(0, r * .4, r * .5, '#e03050');
  frown(r * .62, r * .1, '#a0431e');
}

function drawBoss(e, r, t) {
  [drawBlender, drawTvBoss, drawClockBoss, drawWasher, drawBlower, drawGhostVac, drawRoboBoss, drawSpiderBoss][e.kind == null ? 6 : e.kind](e, r, t);
  drawSensor(e, r);
}
function drawSensor(e, r) {
  const wx = Math.cos(e.weak) * r, wy = Math.sin(e.weak) * r, p = 1 + Math.sin(T * 6) * .15;
  ctx.fillStyle = 'rgba(255,224,102,.35)'; circ(wx, wy, 18 * p);
  ctx.fillStyle = '#ffe066'; circ(wx, wy, 10);
  ctx.fillStyle = '#fff'; circ(wx, wy, 4);
}
function drawBlender(e, r, t) {
  ctx.fillStyle = '#3a3f4d'; rr(-r * .78, r * .38, r * 1.56, r * .62, r * .16); ctx.fill();
  ctx.fillStyle = '#23262f'; rr(-r * .6, r * .5, r * 1.2, r * .36, r * .1); ctx.fill();
  angryEyes(0, r * .68, r * .62, '#ff3b5c');
  ctx.fillStyle = e.timer <= 1 ? (Math.sin(T * 12) > 0 ? '#ff3b5c' : '#5a1020') : '#3dd68c'; circ(r * .66, r * .9, r * .06);
  const jar = () => { ctx.beginPath(); ctx.moveTo(-r * .72, -r * .82); ctx.lineTo(r * .72, -r * .82); ctx.lineTo(r * .56, r * .4); ctx.lineTo(-r * .56, r * .4); ctx.closePath(); };
  ctx.save(); jar(); ctx.clip();
  ctx.fillStyle = 'rgba(200,230,255,.22)'; ctx.fillRect(-r, -r, 2 * r, 2 * r);
  const lv = -r * .28 + Math.sin(t * 3) * r * .05;
  ctx.fillStyle = '#ff6f9a'; ctx.beginPath(); ctx.moveTo(-r, r); ctx.lineTo(-r, lv);
  for (let x = -r; x <= r; x += r * .2) ctx.lineTo(x, lv + Math.sin(x * .12 + t * 8) * r * .04);
  ctx.lineTo(r, r); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,235,.6)'; ctx.lineWidth = r * .05;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, r * .1, r * (.14 + .13 * k), t * 6 + k * 2, t * 6 + k * 2 + 2); ctx.stroke(); }
  ctx.fillStyle = '#ffd166'; circ(Math.cos(t * 5) * r * .3, r * .05 + Math.sin(t * 5) * r * .12, r * .07);
  ctx.fillStyle = '#9ee06a'; circ(Math.cos(t * 5 + 2) * r * .28, r * .12 + Math.sin(t * 5 + 2) * r * .1, r * .06);
  ctx.save(); ctx.translate(0, r * .3); ctx.scale(1, .35); ctx.rotate(t * 20);
  ctx.strokeStyle = '#dfe7f0'; ctx.lineWidth = r * .08;
  ctx.beginPath(); ctx.moveTo(-r * .4, 0); ctx.lineTo(r * .4, 0); ctx.moveTo(0, -r * .4); ctx.lineTo(0, r * .4); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-r * .56, -r * .8, r * .12, r * 1.1);
  ctx.restore();
  jar(); ctx.strokeStyle = '#cfe3f5'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#cfe3f5'; ctx.lineWidth = r * .1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(r * .68, -r * .6); ctx.quadraticCurveTo(r * 1.05, -r * .3, r * .6, r * .1); ctx.stroke();
  ctx.fillStyle = '#3a3f4d'; rr(-r * .82, -r * 1.02, r * 1.64, r * .26, r * .1); ctx.fill();
  ctx.fillStyle = '#ff6f9a'; rr(-r * .16, -r * 1.16, r * .32, r * .18, r * .06); ctx.fill();
}
function drawTvBoss(e, r, t) {
  ctx.strokeStyle = '#8a91a1'; ctx.lineWidth = r * .05; ctx.lineCap = 'round';
  for (const sd of [-1, 1]) {
    const tx = sd * r * .55, ty = -r * 1.2 + Math.sin(t * 3 + sd) * r * .05;
    ctx.beginPath(); ctx.moveTo(sd * r * .1, -r * .74); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = '#ff4d6d'; circ(tx, ty, r * .08);
  }
  ctx.fillStyle = '#2a2233'; ctx.fillRect(-r * .66, r * .7, r * .14, r * .26); ctx.fillRect(r * .52, r * .7, r * .14, r * .26);
  const g = ctx.createLinearGradient(0, -r * .78, 0, r * .76);
  g.addColorStop(0, '#7a5642'); g.addColorStop(1, '#4a3226');
  ctx.fillStyle = g; rr(-r, -r * .78, r * 2, r * 1.52, r * .22); ctx.fill();
  ctx.strokeStyle = '#2f2019'; ctx.lineWidth = 2.5; rr(-r, -r * .78, r * 2, r * 1.52, r * .22); ctx.stroke();
  ctx.save(); rr(-r * .82, -r * .6, r * 1.28, r * 1.16, r * .26); ctx.clip();
  const sg = ctx.createRadialGradient(-r * .2, -r * .05, r * .1, -r * .2, 0, r);
  sg.addColorStop(0, '#2a5a86'); sg.addColorStop(1, '#0b1624');
  ctx.fillStyle = sg; ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.fillStyle = 'rgba(110,195,255,.1)';
  for (let y = -r + ((t * 40) % 6); y < r; y += 6) ctx.fillRect(-r, y, r * 2, 2);
  const noisy = e.timer <= 1 ? 60 : 18;
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < noisy; i++) ctx.fillRect(-r * .82 + Math.random() * r * 1.28, -r * .6 + Math.random() * r * 1.16, 2, 1.5);
  angryEyes(-r * .18, -r * .14, r * .62, '#6ec3ff');
  ctx.strokeStyle = '#6ec3ff'; ctx.lineWidth = r * .05; ctx.beginPath();
  for (let i = 0; i <= 6; i++) ctx.lineTo(-r * .5 + i * r * .11, r * .24 + (i % 2 ? -r * .06 : r * .04));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#2a2233'; rr(r * .54, -r * .6, r * .34, r * 1.16, r * .08); ctx.fill();
  for (const [ky, k] of [[-r * .36, 0], [-r * .04, 1]]) {
    ctx.fillStyle = '#c9b27a'; circ(r * .71, ky, r * .1);
    ctx.strokeStyle = '#2a2233'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r * .71, ky); ctx.lineTo(r * .71 + Math.cos(t * (k ? -1 : 1.5)) * r * .09, ky + Math.sin(t * (k ? -1 : 1.5)) * r * .09); ctx.stroke();
  }
  ctx.fillStyle = '#4a3f55'; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) circ(r * .64 + j * r * .14, r * .24 + i * r * .1, r * .03);
}
function drawClockBoss(e, r, t) {
  const shaking = e.timer <= 1;
  ctx.save(); if (shaking && !RM) ctx.rotate(Math.sin(T * 40) * .06);
  ctx.strokeStyle = '#8a2230'; ctx.lineWidth = r * .1; ctx.lineCap = 'round';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * r * .45, r * .66); ctx.lineTo(sd * r * .64, r * 1.0); ctx.stroke(); }
  for (const sd of [-1, 1]) {
    ctx.fillStyle = '#ffc857'; ctx.beginPath(); ctx.arc(sd * r * .55, -r * .7, r * .34, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c9962e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#c9962e'; circ(sd * r * .55, -r * 1.06, r * .06);
  }
  ctx.save(); ctx.translate(0, -r * .78); ctx.rotate(Math.sin(t * (shaking ? 40 : 4)) * .45);
  ctx.strokeStyle = '#8a91a1'; ctx.lineWidth = r * .06; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * .34); ctx.stroke();
  ctx.fillStyle = '#c9ced6'; circ(0, -r * .36, r * .08);
  ctx.restore();
  const g = ctx.createRadialGradient(-r * .25, -r * .3, r * .1, 0, 0, r * .85);
  g.addColorStop(0, '#ff7b7b'); g.addColorStop(1, '#c92a3a');
  ctx.fillStyle = g; circ(0, 0, r * .84);
  ctx.strokeStyle = '#8a2230'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r * .84, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#fff5e6'; circ(0, 0, r * .66);
  ctx.strokeStyle = '#5a4a40'; ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .56, Math.sin(a) * r * .56); ctx.lineTo(Math.cos(a) * r * (i % 3 ? .6 : .52), Math.sin(a) * r * (i % 3 ? .6 : .52)); ctx.stroke(); }
  ctx.strokeStyle = '#2a2233'; ctx.lineCap = 'round';
  ctx.lineWidth = r * .06; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(t * .6 - 1.5) * r * .3, Math.sin(t * .6 - 1.5) * r * .3); ctx.stroke();
  ctx.lineWidth = r * .04; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(t * 6 - 1.5) * r * .46, Math.sin(t * 6 - 1.5) * r * .46); ctx.stroke();
  ctx.fillStyle = '#2a2233'; circ(0, 0, r * .06);
  angryEyes(0, -r * .24, r * .52, '#e03050');
  ctx.restore();
}
function drawWasher(e, r, t) {
  ctx.fillStyle = '#eef2f7'; rr(-r * .86, -r * .9, r * 1.72, r * 1.8, r * .18); ctx.fill();
  ctx.strokeStyle = '#9aa6b8'; ctx.lineWidth = 2.5; rr(-r * .86, -r * .9, r * 1.72, r * 1.8, r * .18); ctx.stroke();
  ctx.fillStyle = '#cfd8e3'; rr(-r * .86, -r * .9, r * 1.72, r * .34, r * .16); ctx.fill();
  ctx.fillStyle = '#6ec3ff'; circ(-r * .56, -r * .73, r * .1);
  ctx.fillStyle = '#1d3b5a'; rr(-r * .3, -r * .82, r * .56, r * .18, r * .04); ctx.fill();
  ctx.fillStyle = '#5ce1c6'; ctx.font = `900 ${Math.round(r * .14)}px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(e.timer <= 1 ? 'SPIN' : '0:0' + Math.max(0, e.timer), -r * .02, -r * .72);
  ctx.fillStyle = '#9aa6b8'; circ(r * .5, -r * .73, r * .06); circ(r * .66, -r * .73, r * .06);
  ctx.fillStyle = '#8a96a8'; circ(0, r * .14, r * .58);
  ctx.save(); ctx.beginPath(); ctx.arc(0, r * .14, r * .47, 0, TAU); ctx.clip();
  ctx.fillStyle = '#3a7fc4'; ctx.fillRect(-r, -r, r * 2, r * 2);
  const spin = t * (e.timer <= 1 ? 9 : 3);
  for (const [col, off] of [['#ff8fb1', 0], ['#ffd166', 2.1], ['#9ee06a', 4.2]]) {
    ctx.save(); ctx.translate(0, r * .14); ctx.rotate(spin + off);
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(r * .26, 0, r * .14, r * .07, .5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let i = 0; i < 6; i++) circ(Math.cos(i + spin * .3) * r * .35, r * .14 + r * .3 + Math.sin(i * 2) * r * .06, r * .07);
  angryEyes(0, r * .06, r * .52, '#ff3b5c');
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(-r * .2, -r * .08, r * .12, r * .06, -.6, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#6b7689'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, r * .14, r * .52, 0, TAU); ctx.stroke();
  if (e.foam) {
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU, rad = r * (1.02 + .06 * Math.sin(i * 3 + t * 2)), br = r * (.13 + .05 * Math.sin(i * 1.7));
      ctx.fillStyle = 'rgba(255,255,255,.88)'; circ(Math.cos(a) * rad, Math.sin(a) * rad, br);
      ctx.strokeStyle = 'rgba(160,205,240,.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(Math.cos(a) * rad, Math.sin(a) * rad, br, 0, TAU); ctx.stroke();
    }
  }
}
function drawBlower(e, r, t) {
  ctx.fillStyle = '#3d5a2c'; rr(-r * .15, r * .35, r * .3, r * .95, r * .1); ctx.fill();
  ctx.fillStyle = '#2b4020'; rr(-r * .2, r * 1.2, r * .4, r * .14, r * .05); ctx.fill();
  ctx.strokeStyle = '#e8fff0'; ctx.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const ph = frac(t * 1.6 + k / 6), y = r * 1.35 + ph * r * .9, xo = (k % 3 - 1) * r * .18 * (1 + ph);
    ctx.save(); ctx.globalAlpha *= 1 - ph; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(xo, y); ctx.lineTo(xo, y + r * .22); ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, -r * .05, r * .85);
  g.addColorStop(0, '#c4f58c'); g.addColorStop(1, '#4f9a2c');
  ctx.fillStyle = g; circ(0, -r * .05, r * .82);
  ctx.strokeStyle = '#2f5a1c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -r * .05, r * .82, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#2f5a1c'; ctx.lineWidth = r * .1;
  ctx.beginPath(); ctx.arc(0, -r * .82, r * .3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  ctx.fillStyle = '#233a17'; circ(0, r * .18, r * .42);
  ctx.save(); ctx.translate(0, r * .18); ctx.rotate(t * 25);
  ctx.fillStyle = '#9ee06a';
  for (let i = 0; i < 5; i++) { ctx.rotate(TAU / 5); ctx.beginPath(); ctx.ellipse(r * .2, 0, r * .18, r * .07, .4, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#c9ced6'; circ(0, r * .18, r * .07);
  angryEyes(0, -r * .5, r * .5, '#ff3b5c');
}
function drawGhostVac(e, r, t) {
  ctx.save();
  ctx.globalAlpha *= (.8 + .15 * Math.sin(t * 3)) * (1 - e.fade * .9);
  ctx.translate(0, Math.sin(t * 2) * r * .06);
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#f5f1ff'); g.addColorStop(1, '#a998dc');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.arc(0, -r * .1, r * .82, Math.PI, 0);
  ctx.lineTo(r * .82, r * .7);
  for (let i = 0; i < 5; i++) {
    const x0 = r * .82 - i * r * .328, wob = Math.sin(t * 4 + i) * r * .06;
    ctx.quadraticCurveTo(x0 - r * .164, r * (i % 2 ? .72 : 1.0) + wob, x0 - r * .328, r * .75);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,100,180,.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#8f7fc2'; ctx.lineWidth = r * .16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, r * .25); ctx.quadraticCurveTo(r * .1, r * .75, r * .7 + Math.sin(t * 2) * r * .05, r * .9); ctx.stroke();
  ctx.fillStyle = '#5a4a8a'; rr(r * .6, r * .82, r * .3, r * .16, r * .05); ctx.fill();
  for (const sd of [-1, 1]) {
    ctx.fillStyle = '#2a1f45'; ctx.beginPath(); ctx.ellipse(sd * r * .3, -r * .2, r * .17, r * .22, 0, 0, TAU); ctx.fill();
  }
  angryEyes(0, -r * .2, r * .62, '#ff5d7a');
  ctx.fillStyle = '#2a1f45'; ctx.beginPath(); ctx.ellipse(0, r * .15, r * .1, r * .13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(200,190,230,.6)';
  for (let i = 0; i < 6; i++) { const ph = frac(t * .4 + i / 6); circ(Math.cos(i * 2.1) * r * (.9 + ph * .4), -r * .2 + Math.sin(i * 1.3) * r * .5 - ph * r * .4, 2); }
  ctx.restore();
}
function drawSpiderBoss(e, r, t) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // eight legs, stepping in turn
  [2.5, 2.9, 3.3, 3.7, .64, .24, -.16, -.56].forEach((a0, i) => {
    const a = a0 + (RM ? 0 : Math.sin(t * 6 + i * 1.3) * .08);
    const kx = Math.cos(a) * r * 1.25, ky = Math.sin(a) * r * 1.25 - r * .35, fx = Math.cos(a) * r * 1.62, fy = Math.sin(a) * r * 1.62 + r * .25;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .6, Math.sin(a) * r * .6); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy);
    ctx.strokeStyle = '#15171e'; ctx.lineWidth = r * .14; ctx.stroke();
    ctx.strokeStyle = '#8fd14f'; ctx.lineWidth = r * .045; ctx.stroke();
  });
  // abdomen with warning stripes
  const ag = ctx.createRadialGradient(-r * .2, -r * .75, r * .1, 0, -r * .55, r * .7);
  ag.addColorStop(0, '#4a5264'); ag.addColorStop(1, '#15171e');
  ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(0, -r * .55, r * .62, r * .5, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#8fd14f'; ctx.lineWidth = r * .07;
  for (const k of [-.18, 0, .18]) { ctx.beginPath(); ctx.ellipse(0, -r * .55 + k * r, r * .5, r * .1, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  // body
  const g = ctx.createRadialGradient(-r * .3, -r * .1, r * .1, 0, r * .1, r * .85);
  g.addColorStop(0, '#5a6378'); g.addColorStop(1, '#1b1e27');
  ctx.fillStyle = g; circ(0, r * .1, r * .72);
  ctx.strokeStyle = '#8fd14f'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, r * .1, r * .72, 0, TAU); ctx.stroke();
  // vacuum intake with a spinning brush
  ctx.fillStyle = '#0d0e12'; ctx.beginPath(); ctx.ellipse(0, r * .55, r * .38, r * .14, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#6b7a5a'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const a = t * 10 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, r * .55); ctx.lineTo(Math.cos(a) * r * .3, r * .55 + Math.sin(a) * r * .1); ctx.stroke(); }
  // a cluster of red eyes
  angryEyes(0, r * .02, r * .66, '#ff3b5c');
  ctx.fillStyle = '#ff3b5c'; ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 6;
  for (const [dx, dy] of [[-.3, -.2], [-.1, -.26], [.1, -.26], [.3, -.2]]) circ(dx * r, dy * r, r * .045);
  ctx.shadowBlur = 0;
}
function drawWeb(x, y, R) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(235,240,245,.75)'; ctx.lineWidth = 1.3;
  for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + .2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
  for (const f of [.35, .65, .95]) {
    ctx.beginPath();
    for (let k = 0; k <= 8; k++) { const a = k * TAU / 8 + .2, rr2 = R * f * (k % 2 ? .92 : 1); ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
    ctx.stroke();
  }
  ctx.restore();
}
function drawRoboBoss(e, r, t) {
  ctx.strokeStyle = '#596178'; ctx.lineWidth = 2;
  for (let i = 0; i < 30; i++) { const a = i * TAU / 30 + t * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .95, Math.sin(a) * r * .95); ctx.lineTo(Math.cos(a + .08) * r * 1.09, Math.sin(a + .08) * r * 1.09); ctx.stroke(); }
  ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 22;
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
  g.addColorStop(0, '#4f586f'); g.addColorStop(1, '#1d2130');
  ctx.fillStyle = g; circ(0, 0, r); ctx.shadowBlur = 0;
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r * .97, 0, TAU); ctx.arc(0, 0, r * .85, 0, TAU, true); ctx.clip();
  ctx.fillStyle = '#ffc857'; ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeStyle = '#1d2130'; ctx.lineWidth = r * .08;
  for (let d = -r * 2; d < r * 2; d += r * .22) { ctx.beginPath(); ctx.moveTo(d, -r); ctx.lineTo(d + r, r); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#343a4d'; circ(0, 0, r * .8);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + .5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .5, Math.sin(a) * r * .5); ctx.lineTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8); ctx.stroke(); }
  ctx.fillStyle = '#6b7389'; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + .75; circ(Math.cos(a) * r * .72, Math.sin(a) * r * .72, 2); }
  ctx.save(); ctx.translate(0, -r * .44); ctx.rotate(t * 2.5);
  ctx.fillStyle = 'rgba(255,59,92,.22)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * .75, -.28, .28); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#262b3a'; circ(0, -r * .44, r * .2);
  ctx.strokeStyle = '#596178'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -r * .44, r * .2, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#ff3b5c'; circ(0, -r * .44, r * .06);
  ctx.fillStyle = '#10121a'; rr(-r * .64, -r * .14, r * 1.28, r * .34, r * .17); ctx.fill();
  angryEyes(0, r * .03, r * .85, '#ff3b5c');
  ctx.fillStyle = '#ffc857'; rr(-r * .3, r * .32, r * .6, r * .24, r * .06); ctx.fill();
  ctx.fillStyle = '#15122a'; ctx.font = `900 ${Math.round(r * .2)}px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('9000', 0, r * .45);
  if (e.phase2) { ctx.strokeStyle = `rgba(255,77,109,${.5 + .5 * Math.sin(T * 10)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU); ctx.stroke(); }
}

function drawEnemy(e) {
  const bob = Math.sin(T * 3 + e.ph) * 1.5, r = e.r, t = RM ? 0 : T;
  ctx.save(); ctx.translate(e.x, e.y + bob);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, r * .85 - bob, r * .95, r * .3, 0, 0, TAU); ctx.fill();
  if (e.timer <= 1) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowAt(0, 0, r * 2, '255,59,92', .22 + .12 * Math.sin(T * 10)); ctx.restore();
  }
  ({ vac: drawVac, spray: drawSpray, mop: drawMop, boss: drawBoss, brush: drawBrush, fan: drawFan, rc: drawRc, shield: drawShield, split: drawSplit, mini: drawVac })[e.type](e, r, t);
  if (G && G.lvl && G.lvl.event) drawHat(G.lvl.event.costume, r * .9);
  if (e.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.8, e.flash * 7)})`; circ(0, 0, r); }
  ctx.restore();

  const bw = Math.max(40, r * 1.7), by = e.y + r + 9, ratio = e.hp / e.maxHp;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(e.x - bw / 2 - 1, by - 1, bw + 2, 8, 4); ctx.fill();
  ctx.fillStyle = ratio > .3 ? '#5ce1c6' : '#ff4d6d'; rr(e.x - bw / 2, by, Math.max(6, bw * ratio), 6, 3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.3)'; rr(e.x - bw / 2 + 2, by + 1, Math.max(2, bw * ratio - 4), 1.8, 1); ctx.fill();

  const tx = e.x + r * .78, ty = e.y - r * .78, danger = e.timer <= 1;
  const ps = danger ? 1 + Math.sin(T * 10) * .12 : 1;
  ctx.fillStyle = danger ? '#ff3b5c' : '#15122a'; circ(tx, ty, 12 * ps);
  ctx.strokeStyle = danger ? '#fff' : '#ffc857'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 12 * ps, 0, TAU); ctx.stroke();
  const left = Math.max(0, e.timer) / e.maxTimer;
  ctx.strokeStyle = danger ? 'rgba(255,255,255,.5)' : 'rgba(255,200,87,.45)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(tx, ty, 16 * ps, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, left)); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `900 14px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.max(0, e.timer), tx, ty + 1);
}

function drawBox(b, i) {
  const s = 22, t = RM ? 0 : T;
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-s + 4, -s + 6, s * 2, s * 2);
  for (let k = 0; k < 4; k++) {
    ctx.save(); ctx.rotate(k * Math.PI / 2 + Math.sin(t * 3 + k + i) * .03);
    ctx.fillStyle = k % 2 ? '#d99b5c' : '#e6ad6f';
    ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, -s); ctx.lineTo(s * .72, -s - 11); ctx.lineTo(-s * .72, -s - 11); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,30,.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, '#d49357'); g.addColorStop(1, '#ad7240');
  ctx.fillStyle = g; ctx.fillRect(-s, -s, s * 2, s * 2);
  ctx.save(); ctx.beginPath(); ctx.rect(-s + 5, -s + 5, s * 2 - 10, s * 2 - 10); ctx.clip();
  ctx.fillStyle = '#140c07'; ctx.fillRect(-s, -s, s * 2, s * 2);
  ctx.globalCompositeOperation = 'lighter';
  glowAt(0, 0, s, '255,200,87', .45 + .15 * Math.sin(t * 4 + i));
  ctx.lineCap = 'round';
  for (let j = 0; j < 3; j++) {
    const a0 = t * (i ? -3 : 3) + j * TAU / 3;
    ctx.strokeStyle = j % 2 ? 'rgba(255,143,177,.8)' : 'rgba(255,200,87,.85)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let q = 0; q <= 12; q++) { const rad = 2 + q * 1.2, a = a0 + q * .45 * (i ? -1 : 1); ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(214,190,150,.55)'; ctx.fillRect(-s * .25, s - 5, s * .5, 5);
  paw(-s * .55, s - 1.5, 5, 'rgba(110,62,26,.55)');
  ctx.fillStyle = '#fff5e0'; circ(s - 2, -s + 2, 9);
  ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s - 2, -s + 2, 9, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#15122a'; ctx.font = `900 11px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(i ? 'B' : 'A', s - 2, -s + 3);
  ctx.restore();
}

function drawSnack(sn) {
  const t = RM ? 0 : T;
  ctx.save(); ctx.translate(sn.x, sn.y + Math.sin(t * 4 + sn.ph) * 2.5);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glowAt(0, 0, 22, sn.kind === 'fish' ? '126,200,227' : '255,209,102', .22); ctx.restore();
  ctx.rotate(Math.sin(t * 2 + sn.ph) * .15);
  if (sn.kind === 'fish') {
    const g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, '#5aa0c8'); g.addColorStop(.5, '#bfe6f5'); g.addColorStop(1, '#e8f6fb');
    ctx.fillStyle = '#4d8fb5';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(17, -7 + Math.sin(t * 8) * 1.5); ctx.lineTo(14, 0); ctx.lineTo(17, 7 + Math.sin(t * 8) * 1.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(4, -10); ctx.lineTo(6, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 12, 6.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = .9;
    for (let x = -2; x <= 6; x += 3) { ctx.beginPath(); ctx.arc(x, 0, 3, -1, 1); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(40,90,120,.5)'; ctx.beginPath(); ctx.arc(-6, 0, 5, -.9, .9); ctx.stroke();
    ctx.fillStyle = '#fff'; circ(-7.5, -1.2, 2.2); ctx.fillStyle = '#15122a'; circ(-7.8, -1.2, 1.2);
  } else {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(-11, -7); ctx.quadraticCurveTo(0, -12, 11, -7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffc23d'; circ(-5, 3, 2.2); circ(4, 6.5, 1.8);
    ctx.strokeStyle = '#c9803a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-11, -7); ctx.quadraticCurveTo(0, -13, 11, -7); ctx.stroke();
    ctx.strokeStyle = '#e8a55a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-8, -9); ctx.quadraticCurveTo(0, -12.5, 8, -9); ctx.stroke();
    ctx.fillStyle = '#e4572e'; circ(0, -2, 2.6); circ(-3.5, 3.5, 2); circ(3, 2.5, 2);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; circ(-.8, -2.8, .9);
    ctx.fillStyle = '#3f8a5c'; ctx.fillRect(1, 7, 2.5, 1.5);
  }
  const gl = frac(t * .4 + sn.ph);
  if (gl < .12) {
    const a = Math.sin(gl / .12 * Math.PI), s = 5 * a;
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(6 - s, -6); ctx.lineTo(6 + s, -6); ctx.moveTo(6, -6 - s); ctx.lineTo(6, -6 + s); ctx.stroke();
  }
  ctx.restore();
}

function drawLaser() {
  const L = G.laser;
  if (!L || L.caught) return;
  const p = 1 + Math.sin(T * 10) * .2;
  ctx.strokeStyle = 'rgba(255,60,90,.13)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W + 10, BOT + 10); ctx.lineTo(L.x, L.y); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glowAt(L.x, L.y, 26 * p, '255,60,90', .9);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,120,140,.6)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(L.x, L.y, 10 + frac(T * 1.5) * 14, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#fff'; circ(L.x, L.y, 3);
}

function drawTrails() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const t of G.trails) {
    if (t.pts.length < 2) continue;
    const age = G.turn - t.turn;
    ctx.globalAlpha = age <= 0 ? .95 : age === 1 ? .6 : .32;
    ctx.beginPath(); ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    for (let i = 1; i < t.pts.length; i++) ctx.lineTo(t.pts[i][0], t.pts[i][1]);
    const rainbow = !t.gold && rainbowOn();
    ctx.strokeStyle = rainbow ? 'rgba(255,255,255,.7)' : t.gold ? '#ffd166' : t.color;
    ctx.lineWidth = 4.5;
    if (age <= 0 && !LOWFX) { const w = ctx.lineWidth; ctx.globalAlpha = .25; ctx.lineWidth = 11; ctx.stroke(); ctx.globalAlpha = .95; ctx.lineWidth = w; }
    if (rainbow) {
      // the colour runs along the thread, one hue step per segment
      for (let i = 1; i < t.pts.length; i++) {
        ctx.strokeStyle = `hsl(${(i * 9 + T * 60) % 360},90%,65%)`;
        ctx.beginPath(); ctx.moveTo(t.pts[i - 1][0], t.pts[i - 1][1]); ctx.lineTo(t.pts[i][0], t.pts[i][1]); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(t.pts[0][0], t.pts[0][1]);
      for (let i = 1; i < t.pts.length; i++) ctx.lineTo(t.pts[i][0], t.pts[i][1]);
    } else ctx.stroke();
    // twisted-yarn look: dark twists plus a soft highlight strand
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 4.5; ctx.setLineDash([1.5, 4.5]); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.lineDashOffset = 2.5; ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  ctx.globalAlpha = 1;
}

function drawAim() {
  if (!drag || G.state !== 'aim') return;
  const h = G.heroes[G.cur];
  let dx = drag.sx - drag.x, dy = drag.sy - drag.y;
  const len = Math.hypot(dx, dy);
  if (len < 18) return;
  dx /= len; dy /= len;
  const pl = Math.min(len, 90), px = h.x - dx * pl, py = h.y - dy * pl;
  // slingshot bands stretched from the hero's sides to the pull point
  ctx.strokeStyle = h.yarn; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = .85;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(h.x - dy * h.r * s, h.y + dx * h.r * s); ctx.lineTo(px, py); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = h.yarn; circ(px, py, 6);
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, 4, .5, 2.6); ctx.stroke();
  ctx.strokeStyle = G.zoomArmed ? '#ffd166' : '#fff'; ctx.lineWidth = 3; ctx.globalAlpha = .5;
  ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 12, -Math.PI / 2, -Math.PI / 2 + TAU * pl / 90); ctx.stroke(); ctx.globalAlpha = 1;
  // simulate the first stretch of the flight: walls and enemies, bouncing off or piercing through
  const pierce = h.type === 'pierce', col = G.zoomArmed ? '#ffd166' : h.yarn;
  const inside = new Set(), marks = [];
  let x = h.x, y = h.y, vx = dx, vy = dy;
  const STEPS = 42;
  for (let i = 1; i <= STEPS; i++) {
    for (let k = 0; k < 9; k++) {
      x += vx; y += vy;
      if (x < h.r) { x = h.r; vx = -vx; }
      if (x > W - h.r) { x = W - h.r; vx = -vx; }
      if (y < TOP + h.r) { y = TOP + h.r; vy = -vy; }
      if (y > BOT - h.r) { y = BOT - h.r; vy = -vy; }
      for (const e of G.enemies) {
        if (!e.alive) continue;
        const ex = x - e.x, ey = y - e.y, d = Math.hypot(ex, ey) || 1, rs = h.r + e.r;
        if (d >= rs) { inside.delete(e); continue; }
        if (inside.has(e)) continue;
        inside.add(e);
        const nx = ex / d, ny = ey / d;
        if (pierce) marks.push({ e, i });
        else {
          x = e.x + nx * rs; y = e.y + ny * rs;
          const vn = vx * nx + vy * ny;
          if (vn < 0) { vx -= 2 * vn * nx; vy -= 2 * vn * ny; }
          marks.push({ x: e.x + nx * e.r, y: e.y + ny * e.r, nx, ny, i });
        }
      }
    }
    ctx.globalAlpha = 1 - i / (STEPS + 2);
    if (pierce) {
      // arrowheads: this hero flies straight through
      const a = Math.atan2(vy, vx), s2 = 6.5 - i * .07;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(s2, 0); ctx.lineTo(-s2 * .8, -s2 * .75); ctx.lineTo(-s2 * .35, 0); ctx.lineTo(-s2 * .8, s2 * .75); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = col; circ(x, y, 4.2 - i * .06);
      ctx.fillStyle = '#fff'; circ(x, y, 1.9 - i * .025);
    }
  }
  ctx.globalAlpha = 1;
  for (const m of marks) {
    const a = Math.max(.5, 1 - m.i / (STEPS + 2));
    ctx.globalAlpha = a;
    if (pierce) {
      // dashed ring: the enemy gets hit and the hero keeps going
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#15122a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(m.e.x, m.e.y, m.e.r + 8, 0, TAU); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
    } else {
      // impact star where the hero hits and rebounds
      ctx.lineCap = 'round';
      for (const [sc, lw] of [['#15122a', 5.5], ['#fff', 2.5]]) {
        ctx.strokeStyle = sc; ctx.lineWidth = lw;
        for (let q = 0; q < 5; q++) {
          const ang = Math.atan2(m.ny, m.nx) + (q - 2) * .5;
          ctx.beginPath(); ctx.moveTo(m.x + Math.cos(ang) * 6, m.y + Math.sin(ang) * 6); ctx.lineTo(m.x + Math.cos(ang) * 16, m.y + Math.sin(ang) * 16); ctx.stroke();
        }
      }
      ctx.fillStyle = '#15122a'; circ(m.x, m.y, 5.5);
      ctx.fillStyle = col; circ(m.x, m.y, 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawFx() {
  for (const b of G.beams) {
    const a = b.life / b.max;
    ctx.globalAlpha = a; ctx.strokeStyle = b.col; ctx.lineWidth = b.w * a + 1;
    ctx.shadowColor = b.col; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const r of G.rings) {
    const a = r.life / r.max;
    ctx.globalAlpha = a; ctx.strokeStyle = r.col; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (1 - a * .7), 0, TAU); ctx.stroke();
  }
  for (const p of G.parts) { ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5); drawPart(p); }
  ctx.globalAlpha = 1;
}

function drawPart(p) {
  if (p.shape === 'bubble') {
    ctx.strokeStyle = p.col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.75)'; circ(p.x - p.size * .5, p.y - p.size * .55, p.size * .35);
  } else if (p.shape === 'confetti') {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7));
    ctx.fillStyle = p.col; ctx.fillRect(-p.size, -p.size * .45, p.size * 2, p.size * .9); ctx.restore();
  } else if (p.shape === 'star') {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * .3); star(0, 0, p.size * 1.5, p.col); ctx.restore();
  } else if (p.shape === 'leaf') {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.5, p.size * .7, 0, 0, TAU); ctx.fill(); ctx.restore();
  } else if (p.shape === 'spark') {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ctx.stroke(); ctx.restore();
  } else { ctx.fillStyle = p.col; circ(p.x, p.y, p.size); }
}

function drawTexts() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const t of G.texts) {
    ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
    const pop = RM ? 0 : Math.max(0, (t.life - t.max + .14) / .14);
    ctx.font = `900 ${Math.round(t.size * (1 + pop * .6))}px ${FD}`;
    ctx.strokeStyle = '#15122a'; ctx.lineWidth = 4; ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- drawing: HUD ----------
function drawHUD() {
  iconBtn(12, 13, 'back', goMap);
  iconBtn(W - 46, 13, 'sound', () => Snd.toggle());
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4efe6'; ctx.font = `900 16px ${FD}`;
  const pre = G.lvl.endless || G.lvl.event ? '' : `${G.li + 1}. `, nm = G.lvl.endless ? tr('night') : G.lvl.event ? tr('ev.' + G.lvl.event.id) : G.ch.name;
  ctx.fillText(pre, 56, 24);
  let tx = 56 + ctx.measureText(pre).width;
  ctx.fillStyle = G.ch.col; ctx.fillText(nm, tx, 24); tx += ctx.measureText(nm).width;
  ctx.fillStyle = '#f4efe6'; ctx.fillText(G.lvl.endless ? tr('hudWave', G.wave + 1) : ` · ${G.wave + 1}/${G.lvl.waves.length}`, tx, 24);
  ctx.textAlign = 'right'; ctx.font = `800 13px ${FB}`; ctx.fillStyle = '#c9c2e6';
  ctx.fillText(tr('turn', G.turn), W - 56, 24);
  const boss = G.enemies.find(e => e.type === 'boss' && e.alive);
  if (boss) {
    const bx = 56, bw = W - 112;
    ctx.fillStyle = '#2a2548'; rr(bx, 37, bw, 12, 6); ctx.fill();
    ctx.fillStyle = '#ff4d6d'; rr(bx, 37, Math.max(12, bw * boss.hp / boss.maxHp), 12, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 9.5px ${FB}`; ctx.textAlign = 'center';
    ctx.fillText(`${bossName(boss)} · ${boss.hp}`, W / 2, 43.5);
  } else {
    ctx.textAlign = 'left'; ctx.font = `700 11.5px ${FB}`; ctx.fillStyle = '#8f88b5';
    ctx.fillText(G.lvl.endless ? `${tr('record', wavesWord(PROG.endless || 0))} · ${G.ch.name}`
      : G.hard ? tr('hardLeft', Math.max(0, G.lvl.par - G.turn + 1)) : G.li === 0 ? tr('pullHint') : tr('par3', G.lvl.par), 56, 45);
  }

  G.heroes.forEach((h, i) => {
    const many = G.heroes.length > 4, x = many ? 28 + i * 49 : 36 + i * 60, y = 710, cur = i === G.cur, R0 = (cur ? 26 : 24) - (many ? 3 : 0);
    if (cur) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glowAt(x, y, 44, hexRgb(h.yarn), .3 + .1 * Math.sin(T * 4)); ctx.restore(); }
    const g = ctx.createLinearGradient(0, y - R0, 0, y + R0);
    g.addColorStop(0, cur ? '#3a3170' : '#231e44'); g.addColorStop(1, cur ? '#211a46' : '#15122a');
    ctx.fillStyle = g; circ(x, y, R0);
    ctx.strokeStyle = cur ? h.yarn : '#3b3563'; ctx.lineWidth = cur ? 3 : 2;
    ctx.beginPath(); ctx.arc(x, y, R0, 0, TAU); ctx.stroke();
    ctx.save(); if (!cur) ctx.globalAlpha = h.ko ? .35 : .75;
    drawHero(h, x, y + 2, cur ? 16 : 14.5, null, h.ko ? { mood: 'hurt' } : {}); ctx.restore();
    const bx = x + R0 * .74, by = y + R0 * .7;
    ctx.fillStyle = '#15122a'; circ(bx, by, 8);
    ctx.strokeStyle = h.yarn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bx, by, 8, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath();
    if (h.type === 'bounce') { ctx.moveTo(bx - 4, by - 3); ctx.lineTo(bx, by + 3); ctx.lineTo(bx + 4, by - 3); }
    else { ctx.moveTo(bx - 4.5, by); ctx.lineTo(bx + 4.5, by); ctx.moveTo(bx + 1.5, by - 3); ctx.lineTo(bx + 4.5, by); ctx.lineTo(bx + 1.5, by + 3); }
    ctx.stroke();
    if (h.ko) {
      ctx.fillStyle = '#8f88b5'; ctx.font = `800 10px ${FB}`; ctx.textAlign = 'center';
      ctx.fillText(tr('koCount', h.ko), x, y + 35);
    } else heartsRow(h, x, y + 35, 4);
  });

  const full = G.meter >= 100, B = BTN;
  UI.push({ x: B.x, y: B.y, w: B.w, h: B.h, cb: () => {
    if (G.state === 'aim' && G.meter >= 100) { G.zoomArmed = !G.zoomArmed; if (G.zoomArmed) haptic('medium'); }
  } });
  const pulse = full && !G.zoomArmed ? 1 + Math.sin(T * 6) * .03 : 1;
  ctx.save();
  ctx.translate(B.x + B.w / 2, B.y + B.h / 2); ctx.scale(pulse, pulse); ctx.translate(-(B.x + B.w / 2), -(B.y + B.h / 2));
  ctx.fillStyle = '#231e44'; rr(B.x, B.y, B.w, B.h, 14); ctx.fill();
  ctx.save(); rr(B.x, B.y, B.w, B.h, 14); ctx.clip();
  const fw = B.w * G.meter / 100;
  ctx.fillStyle = full ? (G.zoomArmed ? '#ffd166' : '#ff8fb1') : '#6a4fb3';
  ctx.fillRect(B.x, B.y, fw, B.h);
  ctx.beginPath(); ctx.rect(B.x, B.y, fw, B.h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 8;
  const off = RM ? 0 : (T * 30) % 20;
  for (let sx = B.x - B.h - 20 + off; sx < B.x + B.w; sx += 20) { ctx.beginPath(); ctx.moveTo(sx, B.y + B.h); ctx.lineTo(sx + B.h, B.y); ctx.stroke(); }
  ctx.restore();
  ctx.save(); rr(B.x, B.y, B.w, B.h, 14); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(B.x, B.y, B.w, B.h * .42);
  ctx.restore();
  ctx.strokeStyle = full ? '#ffd166' : '#3b3563'; ctx.lineWidth = 2; rr(B.x, B.y, B.w, B.h, 14); ctx.stroke();
  ctx.textAlign = 'center';
  if (full) {
    ctx.fillStyle = '#15122a'; ctx.font = `900 17px ${FD}`;
    fitFont(tr('zoomies'), B.w - 12, 17); ctx.fillText(tr('zoomies'), B.x + B.w / 2, B.y + 20);
    ctx.font = `800 10px ${FB}`;
    ctx.fillText(G.zoomArmed ? tr('zoomReady') : tr('zoomTap'), B.x + B.w / 2, B.y + 37);
  } else {
    ctx.fillStyle = '#fff'; ctx.font = `900 15px ${FD}`;
    fitFont(tr('mischief'), B.w - 12, 15); ctx.fillText(tr('mischief'), B.x + B.w / 2, B.y + 19);
    ctx.font = `800 11px ${FB}`;
    ctx.fillText(`${Math.floor(G.meter)} / 100`, B.x + B.w / 2, B.y + 36);
  }
  ctx.restore();

  const ratio = G.hp / G.maxHp;
  ctx.fillStyle = '#0d0b1d'; rr(15, 755, W - 30, 20, 10); ctx.fill();
  ctx.fillStyle = '#2a2548'; rr(16, 756, W - 32, 18, 9); ctx.fill();
  const lag = (G.hpLag || G.hp) / G.maxHp;
  if (lag > ratio) { ctx.fillStyle = '#ff8fb1'; rr(16, 756, Math.max(18, (W - 32) * lag), 18, 9); ctx.fill(); }
  ctx.fillStyle = ratio > .5 ? '#5ce1c6' : ratio > .25 ? '#ffc857' : '#ff4d6d';
  if (G.hp > 0) {
    rr(16, 756, Math.max(18, (W - 32) * ratio), 18, 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(20, 758, Math.max(10, (W - 32) * ratio - 8), 5, 3); ctx.fill();
  }
  ctx.fillStyle = 'rgba(13,11,29,.35)';
  for (let q = 1; q < 12; q++) ctx.fillRect(16 + (W - 32) * q / 12, 756, 1.5, 18);
  ctx.fillStyle = '#15122a'; circ(26, 765, 12);
  ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(20, 765); ctx.lineTo(26, 759); ctx.lineTo(32, 765); ctx.moveTo(22, 764); ctx.lineTo(22, 770); ctx.lineTo(30, 770); ctx.lineTo(30, 764); ctx.stroke();
  ctx.font = `900 11px ${FB}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#15122a'; ctx.lineWidth = 3;
  const hpText = tr('homeHp', Math.ceil(G.hp), G.maxHp);
  ctx.strokeText(hpText, W / 2, 765.5); ctx.fillStyle = '#fff'; ctx.fillText(hpText, W / 2, 765.5);

  const h = G.heroes[G.cur];
  ctx.textAlign = 'left'; ctx.fillStyle = '#b9b2da';
  let fs = 12;
  const hint = `${h.name} · ${tr(h.type === 'bounce' ? 'typeBounce' : 'typePierce')} · ${h.skill}`;
  do { ctx.font = `700 ${fs}px ${FB}`; fs -= .5; } while (ctx.measureText(hint).width > W - 32 && fs > 8);
  ctx.fillText(hint, 16, 789);
}

const easeOutBack = k => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
// themed trim for cards: tile checks (kitchen), carpet diamonds (living room), stars (bedroom)
function chTrim(c, x, y, w, col) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, 10); ctx.clip(); ctx.fillStyle = col;
  if (c === 0) { for (let i = 0; i * 5 < w; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) ctx.fillRect(x + i * 5, y + j * 5, 5, 5); }
  else if (c === 1) { for (let px = x + 6; px < x + w; px += 12) { ctx.beginPath(); ctx.moveTo(px, y + 1); ctx.lineTo(px + 4, y + 5); ctx.lineTo(px, y + 9); ctx.lineTo(px - 4, y + 5); ctx.fill(); } }
  else if (c === 2) { for (let px = x + 8; px < x + w; px += 16) star(px, y + 5, (px / 16 | 0) % 2 ? 3.5 : 2.2, col); }
  else if (c === 3) { ctx.strokeStyle = col; ctx.lineWidth = 1.2; for (let px = x + 6; px < x + w; px += 11) { ctx.beginPath(); ctx.arc(px, y + 5, (px / 11 | 0) % 2 ? 3.2 : 2, 0, TAU); ctx.stroke(); } }
  else if (c === 4) { for (let px = x + 8; px < x + w; px += 14) { ctx.save(); ctx.translate(px, y + 5); ctx.rotate((px / 14 | 0) % 2 ? .6 : -.6); ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2, 0, 0, TAU); ctx.fill(); ctx.restore(); } }
  else if (c === 5) { for (let px = x + 2; px < x + w; px += 16) ctx.fillRect(px, y + 3.5, 10, 3); }
  else if (c === 7) { ctx.strokeStyle = col; ctx.lineWidth = 1; for (let px = x + 8; px < x + w; px += 18) { ctx.beginPath(); ctx.moveTo(px - 6, y + 1); ctx.lineTo(px + 6, y + 9); ctx.moveTo(px + 6, y + 1); ctx.lineTo(px - 6, y + 9); ctx.moveTo(px, y); ctx.lineTo(px, y + 10); ctx.stroke(); } }
  else { for (let px = x - 10; px < x + w; px += 14) { ctx.beginPath(); ctx.moveTo(px, y + 9); ctx.lineTo(px + 6, y + 9); ctx.lineTo(px + 12, y + 1); ctx.lineTo(px + 6, y + 1); ctx.fill(); } }
  ctx.restore();
}

function drawBanner() {
  const b = G.banner;
  if (!b) return;
  const c = G.lvl.ch, ch = G.ch;
  const el = b.max - b.t, kin = Math.min(1, el / .4), kout = Math.min(1, b.t / .25);
  const a = Math.min(kin * 2, kout, 1), sc = RM ? 1 : .75 + .25 * easeOutBack(kin);
  ctx.globalAlpha = a * .35; ctx.fillStyle = '#000'; ctx.fillRect(0, TOP, W, BOT - TOP);
  ctx.globalAlpha = a;
  ctx.save(); ctx.translate(W / 2, 368); ctx.scale(sc, sc); ctx.translate(-W / 2, -368);
  const g = ctx.createLinearGradient(0, 312, 0, 424);
  g.addColorStop(0, ch.hud); g.addColorStop(1, 'rgba(12,10,26,.96)');
  ctx.fillStyle = g; rr(30, 312, W - 60, 112, 20); ctx.fill();
  ctx.save(); rr(30, 312, W - 60, 112, 20); ctx.clip(); chTrim(c, 30, 312, W - 60, ch.col + '55'); chTrim(c, 30, 414, W - 60, ch.col + '55'); ctx.restore();
  ctx.strokeStyle = ch.col; ctx.lineWidth = 2; rr(30, 312, W - 60, 112, 20); ctx.stroke();
  ctx.shadowColor = ch.col; ctx.shadowBlur = 18;
  ctx.fillStyle = ch.hud; circ(W / 2, 312, 24);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ch.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, 312, 24, 0, TAU); ctx.stroke();
  chIcon(c, W / 2, 313, 26, ch.col);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; ctx.font = `900 26px ${FD}`; ctx.fillText(b.title, W / 2, 352);
  ctx.fillStyle = '#f4efe6'; ctx.font = `800 14px ${FB}`; wrap(b.sub, W / 2, 386, W - 100, 18);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- drawing: overlays & screens ----------
const FEATURE_COLS = ['#ff8fb1', '#ff3b5c', '#c68a4f', '#5ce1c6', '#9aa0ad'];
const FEATURES = () => tr('features').map((f, i) => [FEATURE_COLS[i], ...f]);

function drawHowto() {
  ctx.drawImage(BGS[1], 0, 0, W, H);
  ctx.fillStyle = 'rgba(12,10,26,.9)'; ctx.fillRect(0, 0, W, H);
  HEROES.filter(h => h.id !== 'spark').forEach((h, i) => {
    drawHero(h, 90 + i * 90, 100 + Math.sin(T * 3 + i) * 5, 26, null, { look: [0, .6] });
    ctx.fillStyle = h.yarn; ctx.font = `900 12px ${FD}`; ctx.textAlign = 'center'; ctx.fillText(h.name, 90 + i * 90, 148);
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; ctx.font = `900 56px ${FD}`; ctx.fillText('Pawsling', W / 2, 200);
  ctx.fillStyle = '#f4efe6'; ctx.font = `800 15px ${FB}`; fitFont(tr('tagline'), W - 40, 15, 800, FB); ctx.fillText(tr('tagline'), W / 2, 240);
  ctx.fillStyle = '#c9c2e6'; ctx.font = `700 12.5px ${FB}`;
  wrap(tr('howtoIntro'), W / 2, 270, W - 80, 16);
  let y = 330;
  for (const [col, title, desc] of FEATURES()) {
    ctx.fillStyle = col; circ(44, y, 6);
    ctx.textAlign = 'left'; ctx.font = `900 16px ${FD}`; ctx.fillText(title, 62, y);
    ctx.fillStyle = '#c9c2e6'; ctx.font = `700 12.5px ${FB}`;
    const end = wrap(desc, 62, y + 20, W - 100, 16);
    y = end + 32;
  }
  uiBtn(75, 700, W - 150, 56, tr('play'), closeHowto, true);
}

function drawNode(c, x, y, r, col, open) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(x + 2, y + r * .9, r * .95, r * .3, 0, 0, TAU); ctx.fill();
  if (!open) {
    ctx.fillStyle = '#2a2548'; circ(x, y, r);
    ctx.strokeStyle = '#3b3563'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  } else if (c === 0) {
    // a plate
    ctx.fillStyle = '#f1e4d0'; circ(x, y, r);
    ctx.strokeStyle = 'rgba(120,70,30,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * .8, 0, TAU); ctx.stroke();
    ctx.fillStyle = col; circ(x, y, r * .68);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(x - r * .5, y - r * .5, r * .18, r * .08, -.8, 0, TAU); ctx.fill();
  } else if (c === 1) {
    // a tufted cushion
    ctx.translate(x, y); ctx.rotate(-.08);
    const s = r * 1.78;
    ctx.fillStyle = col; rr(-s / 2, -s / 2, s, s, r * .45); ctx.fill();
    ctx.strokeStyle = '#6d4fb0'; ctx.lineWidth = 3; rr(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4, r * .42); ctx.stroke();
    ctx.fillStyle = '#6d4fb0';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) circ(dx * s * .3, dy * s * .3, 2.2);
    ctx.rotate(.08); ctx.translate(-x, -y);
  } else if (c === 3) {
    // a soap bubble
    const g = ctx.createRadialGradient(x - r * .3, y - r * .35, 2, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.35, col); g.addColorStop(1, '#2a7fbf');
    ctx.fillStyle = g; circ(x, y, r);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(x - r * .42, y - r * .45, r * .2, r * .1, -.7, 0, TAU); ctx.fill();
  } else if (c === 4) {
    // a flower
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; ctx.fillStyle = k % 2 ? col : '#c6f09e'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * .55, y + Math.sin(a) * r * .55, r * .5, r * .3, a, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffd166'; circ(x, y, r * .62);
    ctx.fillStyle = 'rgba(160,100,20,.3)'; for (let k = 0; k < 6; k++) circ(x + Math.cos(k) * r * .3, y + Math.sin(k) * r * .3, 1.5);
  } else if (c === 5) {
    // a wooden crate
    ctx.translate(x, y); ctx.rotate(.05);
    const s = r * 1.7;
    ctx.fillStyle = '#b07a45'; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = col; ctx.fillRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8);
    ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 3; ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.lineWidth = 2; ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.rotate(-.05); ctx.translate(-x, -y);
  } else if (c === 6) {
    // a hex nut
    ctx.fillStyle = col; ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + Math.PI / 6; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a6a7c'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(x - r * .45, y - r * .5, r * .18, r * .08, -.6, 0, TAU); ctx.fill();
  } else if (c === 7) {
    // a web
    ctx.fillStyle = '#2a3322'; circ(x, y, r);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); }
    for (const f of [.4, .72]) { ctx.beginPath(); ctx.arc(x, y, r * f, 0, TAU); ctx.stroke(); }
  } else {
    // a glowing moon
    ctx.shadowColor = col; ctx.shadowBlur = 18;
    const g = ctx.createRadialGradient(x - r * .3, y - r * .3, 2, x, y, r);
    g.addColorStop(0, '#d9fff6'); g.addColorStop(1, col);
    ctx.fillStyle = g; circ(x, y, r); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(20,80,80,.16)'; circ(x + r * .45, y - r * .35, r * .16); circ(x - r * .5, y + r * .4, r * .12);
  }
  if (open && c !== 1 && c !== 5) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  ctx.restore();
}


// ---------- leaderboard ----------
// The worker in /worker keeps each player's best Night Shift and total stars. It only answers
// requests signed by Telegram, so the board works inside Telegram only.
const BOARD_URL = 'https://pawsling-leaderboard.pawsling-leaderboard.workers.dev'; // worker/ deployed with wrangler
const BOARD = { tab: 'week', status: 'idle', data: {} };
const boardAvailable = () => !!(TG && TG.initData && BOARD_URL);
async function boardPost(extra) {
  const r = await fetch(BOARD_URL + '/board', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: TG.initData, night: PROG.endless || 0, stars: totalStars(), week: PROG.wk === weekKey() ? PROG.wkBest || 0 : 0, ...extra }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function submitScores() { if (boardAvailable()) boardPost({}).catch(() => {}); }
async function openBoard(tab) {
  BOARD.tab = tab;
  setScreen('board');
  if (!boardAvailable()) { BOARD.status = TG && TG.initData ? 'error' : 'tgOnly'; return; }
  BOARD.status = BOARD.data[tab] ? 'ok' : 'loading';
  try {
    const d = await boardPost({ board: tab });
    BOARD.data[tab] = d;
    if (BOARD.tab === tab) BOARD.status = 'ok';
  } catch (e) { if (BOARD.tab === tab && !BOARD.data[tab]) BOARD.status = 'error'; }
}
const MEDALS = ['#ffd166', '#d6dee8', '#e0a06a'];
function drawBoardRow(r, y) {
  const x = 24, w = W - 48, h = 34, tab = BOARD.tab;
  ctx.fillStyle = r.me ? 'rgba(255,200,87,.16)' : '#1d1938'; rr(x, y, w, h, 10); ctx.fill();
  if (r.me) { ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 1.5; rr(x, y, w, h, 10); ctx.stroke(); }
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  if (r.rank <= 3) {
    ctx.fillStyle = MEDALS[r.rank - 1]; circ(x + 22, y + h / 2, 12);
    ctx.fillStyle = '#15122a'; ctx.font = `900 13px ${FD}`; ctx.fillText(String(r.rank), x + 22, y + h / 2 + 1);
  } else {
    ctx.fillStyle = '#8f88b5'; fitFont(String(r.rank), 38, 13); ctx.fillText(String(r.rank), x + 22, y + h / 2 + 1);
  }
  ctx.textAlign = 'left'; ctx.fillStyle = r.me ? '#ffc857' : '#f4efe6';
  fitFont(r.name, w - 170, 14, 800, FB); ctx.fillText(r.name, x + 46, y + h / 2 + 1);
  ctx.textAlign = 'right'; ctx.fillStyle = '#f4efe6';
  if (tab === 'stars') {
    ctx.font = `900 15px ${FD}`; ctx.fillText(String(r.value), x + w - 30, y + h / 2 + 1);
    star(x + w - 16, y + h / 2, 7, '#ffc857');
  } else {
    fitFont(wavesWord(r.value), 110, 14, 800, FB); ctx.fillText(wavesWord(r.value), x + w - 12, y + h / 2 + 1);
  }
}
function drawBoard() {
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 320);
  g.addColorStop(0, 'rgba(255,200,87,.14)'); g.addColorStop(1, 'rgba(255,200,87,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  iconBtn(12, 13, 'back', () => setScreen('map'));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; fitFont(tr('board'), W - 120, 30); ctx.fillText(tr('board'), W / 2, 32);
  uiBtn(16, 72, 132, 44, tr('boardWeek'), () => openBoard('week'), BOARD.tab === 'week');
  uiBtn(159, 72, 132, 44, tr('boardNight'), () => openBoard('night'), BOARD.tab === 'night');
  uiBtn(302, 72, 132, 44, tr('boardStars'), () => openBoard('stars'), BOARD.tab === 'stars');
  const d = BOARD.data[BOARD.tab];
  const msg = t => { ctx.textAlign = 'center'; ctx.fillStyle = '#c9c2e6'; ctx.font = `800 15px ${FB}`; wrap(t, W / 2, 330, W - 90, 22); };
  if (BOARD.status === 'tgOnly') { msg(tr('boardTgOnly')); return; }
  if (!d) {
    msg(tr(BOARD.status === 'error' ? 'boardError' : 'boardLoading'));
    if (BOARD.status === 'error') uiBtn(75, 736, W - 150, 46, tr('boardRetry'), () => openBoard(BOARD.tab), false);
    return;
  }
  if (!d.top.length) msg(tr('boardEmpty'));
  const wk = BOARD.tab === 'week', y0 = wk ? 170 : 140, nRows = wk ? 12 : 13;
  if (wk && d.endsAt) {
    const left = Math.max(0, d.endsAt - Date.now()), dd = Math.floor(left / 86400000), hh = Math.floor(left % 86400000 / 3600000);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffc857'; fitFont(`${tr('weekLeft', dd, hh)} · ${tr('weekPrizes')}`, W - 40, 13, 800, FB);
    ctx.fillText(`${tr('weekLeft', dd, hh)} · ${tr('weekPrizes')}`, W / 2, 140);
  }
  const rows = d.top.slice(0, nRows);
  rows.forEach((r, i) => drawBoardRow(r, y0 + i * 40));
  if (d.me && !rows.some(r => r.me)) {
    ctx.fillStyle = '#4a4278'; for (let k = 0; k < 3; k++) circ(W / 2 - 12 + k * 12, y0 + nRows * 40 + 8, 2.2);
    drawBoardRow({ rank: d.me.rank, name: tr('boardYou'), value: d.me.value, me: true }, y0 + nRows * 40 + 20);
  }
  uiBtn(75, 736, W - 150, 46, tr('boardRetry'), () => openBoard(BOARD.tab), false);
}

// ---------- map: chapters stack vertically and the map scrolls ----------
const CH_LEVELS = CHAPTERS.map((_, c) => LEVELS.map((l, i) => (l.ch === c ? i : -1)).filter(i => i >= 0));
const MAP = { y: 0, v: 0, maxY: 0, focus: true };
const MAP_VIEW = H - 92;
let mapDrag = null;
function mapLayout() {
  let y0 = 172 + (activeEvent() ? 100 : 0);
  const cards = CHAPTERS.map((ch, c) => {
    const ids = CH_LEVELS[c], two = ids.length > 4, bh = two ? 262 : 170;
    // up to 4 levels in one row; 6 levels snake over two rows
    const pts = ids.map((_, i) => {
      if (!two) return [72 + i * 102, y0 + 66 + (i % 2 ? 16 : -8)];
      const row = i < 3 ? 0 : 1, k = row ? 5 - i : i;
      return [90 + k * 135, y0 + 62 + row * 104 + (k % 2 ? 14 : -6)];
    });
    const card = { c, ch, ids, y0, by: y0 - 28, bh, pts };
    y0 += bh + 12;
    return card;
  });
  return { cards, height: y0 };
}
function updateMap(dt) {
  if (mapDrag && mapDrag.moved) return;
  if (MAP.v) { MAP.y += MAP.v * dt; MAP.v *= Math.pow(.04, dt); if (Math.abs(MAP.v) < 8) MAP.v = 0; }
  if (MAP.y < 0) MAP.y += -MAP.y * Math.min(1, dt * 12);
  else if (MAP.y > MAP.maxY) MAP.y += (MAP.maxY - MAP.y) * Math.min(1, dt * 12);
}

function drawMap() {
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, 0, W, H);
  const L = mapLayout();
  MAP.maxY = Math.max(0, L.height - MAP_VIEW + 10);
  if (MAP.focus) {
    // open the map with the chapter of the next level to play in view
    MAP.focus = false; MAP.v = 0;
    const card = L.cards.find(k => k.ids.includes(PROG.unlocked - 1));
    MAP.y = card ? Math.max(0, Math.min(MAP.maxY, card.by + card.bh + 30 - MAP_VIEW)) : 0;
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, MAP_VIEW); ctx.clip(); ctx.translate(0, -MAP.y);
  const g = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 320);
  g.addColorStop(0, 'rgba(255,200,87,.14)'); g.addColorStop(1, 'rgba(255,200,87,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffc857'; ctx.shadowBlur = RM ? 10 : 14 + 6 * Math.sin(T * 2);
  ctx.fillStyle = '#ffc857'; ctx.font = `900 34px ${FD}`; ctx.fillText('Pawsling', W / 2, 62);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c9c2e6'; ctx.font = `800 14px ${FB}`;
  ctx.fillText(TG_NAME ? tr('hello', TG_NAME) : tr('pickLevel'), W / 2, 100);
  const ts = totalStars();
  star(W / 2 - 34, 126, 9, '#ffc857');
  ctx.fillStyle = '#f4efe6'; ctx.font = `900 16px ${FD}`; ctx.textAlign = 'left';
  ctx.fillText(`${ts} / ${LEVELS.length * 3}`, W / 2 - 20, 127);
  const evNow = activeEvent();
  if (evNow) drawEventCard(evNow, 150);

  for (const k of L.cards) {
    if (k.by - MAP.y > MAP_VIEW || k.by + k.bh - MAP.y < 0) continue;
    const { c, ch, ids, y0, by, bh, pts } = k, bx = 12, bw = W - 24;
    const chOpen = ids[0] + 1 <= PROG.unlocked;
    // the chapter's room seen through a window
    ctx.save(); rr(bx, by, bw, bh, 18); ctx.clip();
    ctx.drawImage(BGS[c], bx * 2, 300 * 2, bw * 2, bh * 2, bx, by, bw, bh);
    ctx.translate(0, by - 300); drawRoomOver(c); ctx.translate(0, 300 - by);
    const sh = ctx.createLinearGradient(0, by, 0, by + bh);
    sh.addColorStop(0, 'rgba(10,8,20,.82)'); sh.addColorStop(.3, 'rgba(10,8,20,.45)'); sh.addColorStop(1, 'rgba(10,8,20,.6)');
    ctx.fillStyle = sh; ctx.fillRect(bx, by, bw, bh);
    if (!chOpen) { ctx.fillStyle = 'rgba(10,8,20,.55)'; ctx.fillRect(bx, by, bw, bh); }
    ctx.restore();
    ctx.strokeStyle = ch.col; ctx.globalAlpha = chOpen ? .55 : .2; ctx.lineWidth = 2; rr(bx, by, bw, bh, 18); ctx.stroke(); ctx.globalAlpha = 1;
    chIcon(c, 40, y0, 22, ch.col);
    ctx.textAlign = 'left'; ctx.fillStyle = ch.col; ctx.font = `900 20px ${FD}`;
    ctx.fillText(ch.name, 60, y0);
    const chStars = ids.reduce((a, li) => a + (PROG.stars[String(li + 1)] || 0), 0);
    ctx.textAlign = 'right'; ctx.fillStyle = '#c9c2e6'; ctx.font = `800 12px ${FB}`;
    ctx.fillText(tr('chStars', chStars, ids.length * 3), W - 28, y0);
    ctx.strokeStyle = ch.col; ctx.globalAlpha = .6; ctx.lineWidth = 3; ctx.setLineDash([6, 7]); ctx.lineCap = 'round';
    ctx.lineDashOffset = RM ? 0 : -T * 12;
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
    pts.forEach(([x, y], i) => {
      const li = ids[i], n = li + 1, lvl = LEVELS[li];
      const open = n <= PROG.unlocked, isBoss = !!lvl.boss, r = isBoss ? 33 : 28;
      const current = n === PROG.unlocked && !PROG.stars[String(n)];
      const bob = current && !RM ? Math.sin(T * 3) * 3 : 0;
      if (current) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glowAt(x, y, r * 2, hexRgb(ch.col), .35 + .15 * Math.sin(T * 4)); ctx.restore(); }
      drawNode(c, x, y + bob, r, ch.col, open);
      if (open) {
        ctx.fillStyle = '#15122a'; ctx.textAlign = 'center';
        ctx.font = `900 ${isBoss ? 15 : 22}px ${FD}`;
        ctx.fillText(isBoss ? tr('boss') : String(n), x, y + bob + 1);
        if (isBoss) { ctx.font = `800 10px ${FB}`; ctx.fillText(String(n), x, y + bob + 16); }
      } else {
        ctx.fillStyle = '#5b5488'; rr(x - 8, y - 2, 16, 12, 3); ctx.fill();
        ctx.strokeStyle = '#5b5488'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y - 3, 5, Math.PI, 0); ctx.stroke();
      }
      const got = PROG.stars[String(n)] || 0;
      for (let s = 0; s < 3; s++) star(x - 16 + s * 16, y + r + 12, 7, s < got ? '#ffc857' : '#2f2a52', s < got ? null : '#3b3563');
      if (PROG.hard && PROG.hard[String(n)]) { ctx.save(); ctx.translate(x + r * .75, y - r * .45 + bob); ctx.rotate(.3); drawHat('crown', 16); ctx.restore(); }
      const sy = y - r - 6 - MAP.y;
      if (sy < MAP_VIEW && sy + r * 2 + 30 > 0) UI.push({ x: x - r - 6, y: sy, w: r * 2 + 12, h: r * 2 + 30, cb: () => {
        if (open) prepLevel(li); else { Snd.play('locked'); haptic('warning'); }
      } });
    });
  }
  ctx.restore();

  // scroll position
  if (MAP.maxY > 0) {
    const th = MAP_VIEW * MAP_VIEW / (MAP_VIEW + MAP.maxY), ty = (MAP_VIEW - th) * Math.max(0, Math.min(1, MAP.y / MAP.maxY));
    ctx.fillStyle = 'rgba(201,194,230,.25)'; rr(W - 6, ty + 6, 3, th - 12, 2); ctx.fill();
  }
  // fixed bottom bar
  const fade = ctx.createLinearGradient(0, MAP_VIEW - 26, 0, MAP_VIEW + 8);
  fade.addColorStop(0, 'rgba(17,14,34,0)'); fade.addColorStop(1, '#110e22');
  ctx.fillStyle = fade; ctx.fillRect(0, MAP_VIEW - 26, W, 34);
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, MAP_VIEW + 8, W, H - MAP_VIEW - 8);
  uiBtn(16, 736, 46, 46, '?', () => setScreen('howto'), false);
  uiBtn(70, 736, 170, 46, tr('daily'), () => { DAILY.msg = null; setScreen('daily'); }, false);
  if (!challengeDone()) { ctx.fillStyle = '#ff5d7a'; circ(232, 740, 6); ctx.strokeStyle = '#110e22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(232, 740, 6, 0, TAU); ctx.stroke(); }
  const nightOpen = PROG.unlocked >= ENDLESS_UNLOCK;
  const rec = PROG.endless || 0;
  uiBtn(248, 736, W - 264, 46, nightOpen ? (rec ? `${tr('night')} · ${rec}` : tr('night')) : tr('nightAfter'),
    () => { if (nightOpen) prepLevel(-1); else { Snd.play('locked'); haptic('warning'); } }, nightOpen);
  iconBtn(W - 46, 13, 'sound', () => Snd.toggle());
  iconBtn(W - 90, 13, 'trophy', () => openBoard('week'));
  iconBtn(W - 134, 13, 'paw', () => setScreen('heroes'));
  iconBtn(62, 13, 'bag', () => { SHOP.msg = null; setScreen('shop'); refreshInv(); });
  langBtn();
}
function langBtn() {
  const x = 12, y = 13, w = 44, h = 34;
  UI.push({ x: x - 4, y: y - 4, w: w + 8, h: h + 8, cb: () => setScreen('lang') });
  ctx.fillStyle = '#0d0b1d'; rr(x, y + 3, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#2e2859'); g.addColorStop(1, '#1f1a40');
  ctx.fillStyle = g; rr(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = '#4a4278'; ctx.lineWidth = 1.5; rr(x, y, w, h, 10); ctx.stroke();
  ctx.fillStyle = '#f4efe6'; ctx.font = `900 13px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(LANG.toUpperCase(), x + w / 2, y + h / 2 + 1);
}
function drawLang() {
  drawMap(); UI = [];
  ctx.fillStyle = 'rgba(12,10,26,.9)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; ctx.font = `900 28px ${FD}`; ctx.fillText(tr('lang'), W / 2, 130);
  // "Automatic" first, then the languages alphabetically by their own names
  const saved = lsGet('pawsling-lang'), auto = !(saved && LANGS[saved]);
  const pick = k => {
    if (k) lsSet('pawsling-lang', k); else lsSet('pawsling-lang', '');
    LANG = k || autoLang();
    cv.setAttribute('aria-label', tr('aria')); document.documentElement.lang = LANG;
    setScreen('map');
  };
  const list = Object.entries(LANGS).sort((a, b) => a[1].localeCompare(b[1], 'en'));
  uiBtn(75, 170, W - 150, 54, `${tr('langAuto')} · ${LANGS[autoLang()]}`, () => pick(null), auto);
  list.forEach(([k, name], i) => uiBtn(75, 240 + i * 68, W - 150, 54, name, () => pick(k), !auto && k === LANG));
}

// ---------- shop: Second wind for Telegram Stars ----------
// After a loss the player can buy one continue per run. The invoice comes from the worker,
// Telegram shows its own payment sheet, and 'paid' resumes the level.
const WIND_PRICE = 10; // must match ITEMS.continue in worker/src/index.js
const canPay = () => !!(TG && TG.initData && BOARD_URL && TG.openInvoice && tgv('6.1')) || (DEV && window.__fakePay === true);
async function buySecondWind() {
  if (!G || G.buying) return;
  const run = G;
  run.buying = true; run.payMsg = null;
  try {
    const r = await fetch(BOARD_URL + '/invoice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: TG.initData, item: 'continue', lang: LANG }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { link } = await r.json();
    TG.openInvoice(link, status => {
      run.buying = false;
      if (status === 'paid') secondWind(run);
      else if (status === 'failed') run.payMsg = tr('payFailed');
    });
  } catch (e) { run.buying = false; run.payMsg = tr('payFailed'); }
}
function secondWind(run) {
  if (G !== run || G.state !== 'lose') return;
  G.usedWind = true; G.loseReason = null; G.attackQueue = [];
  G.hp = G.hpLag = G.maxHp;
  for (const h of G.heroes) { h.ko = 0; h.hearts = h.maxHearts; h.happy = 1; }
  Amb.duck(1); flash('#5ce1c6', .5); ring(W / 2, (TOP + BOT) / 2, 260, '#5ce1c6');
  ftext(W / 2, 380, tr('secondWindGo'), '#5ce1c6', 26);
  Snd.play('heal'); haptic('success');
  nextTurn();
}
function drawSecondWind() {
  if (G.usedWind || G.loseReason === 'turns' || !canPay()) return false;
  const note = G.payMsg || tr('secondWindSub');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = G.payMsg ? '#ff8fb1' : '#c9c2e6';
  fitFont(note, W - 60, 13, 800, FB); ctx.fillText(note, W / 2, 510);
  uiBtn(75, 526, W - 150, 56, G.buying ? tr('payWait') : `${tr('secondWind')} · ★ ${WIND_PRICE}`, buySecondWind, true);
  return true;
}


// ---------- shop: boosters, hats, rainbow yarn, a new hero ----------
// The worker keeps each player's inventory; a paid item is credited there by the payment webhook.
const PRICES = { heart3: 15, meter3: 15, hat_party: 20, hat_crown: 30, hat_bow: 20, rainbow: 25, hero_spark: 50, hero_rex: 50 }; // = ITEMS in the worker
const GRANTS = { hero_rex: { hero_rex: 1 }, heart3: { heart: 3 }, meter3: { meter: 3 }, hat_party: { hat_party: 1 }, hat_crown: { hat_crown: 1 }, hat_bow: { hat_bow: 1 },
  rainbow: { rainbow: 1 }, hero_spark: { hero_spark: 1 } };
const SHOP_LIST = ['heart3', 'meter3', 'hero_spark', 'hero_rex', 'hat_party', 'hat_crown', 'hat_bow', 'rainbow'];
let INV = {};
const PENDING = {}; // bought here but not yet confirmed by the server
const COS = { hat: lsGet('pawsling-hat') || '', rainbow: lsGet('pawsling-rainbow') !== 'off' };
const SHOP = { busy: null, msg: null };
const owns = k => (INV[k] || 0) > 0;
const activeHat = () => (COS.hat && (owns('hat_' + COS.hat) || (PROG.hats && PROG.hats[COS.hat])) ? COS.hat : null);
const rainbowOn = () => COS.rainbow && owns('rainbow');
const serverOn = () => !!(TG && TG.initData && BOARD_URL);
function setHat(h) { COS.hat = h; lsSet('pawsling-hat', h); }
function setRainbow(on) { COS.rainbow = on; lsSet('pawsling-rainbow', on ? 'on' : 'off'); }
async function api(path, body) {
  const r = await fetch(BOARD_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: TG.initData, ...body }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function setInv(items) {
  for (const k in PENDING) { if ((items[k] || 0) >= PENDING[k]) delete PENDING[k]; else items[k] = PENDING[k]; }
  INV = items;
}
async function refreshInv(tries = 1) {
  if (!serverOn()) return;
  for (let i = 0; i < tries; i++) {
    try { setInv((await api('/inventory', {})).items || {}); } catch (e) {}
    if (!Object.keys(PENDING).length) return;
    await new Promise(r => setTimeout(r, 1500));
  }
}
function buyItem(id) {
  if (SHOP.busy) return;
  if (!canPay()) { SHOP.msg = tr('shopTgOnly'); return; }
  SHOP.busy = id; SHOP.msg = null;
  api('/invoice', { item: id, lang: LANG }).then(({ link }) => TG.openInvoice(link, st => {
    SHOP.busy = null;
    if (st === 'paid') {
      for (const [k, n] of Object.entries(GRANTS[id] || {})) { INV[k] = (INV[k] || 0) + n; PENDING[k] = INV[k]; }
      if (id.startsWith('hat_')) setHat(id.slice(4));
      if (id === 'rainbow') setRainbow(true);
      Snd.play('zoom'); haptic('success');
      refreshInv(6);
    } else if (st === 'failed') SHOP.msg = tr('payFailed');
  })).catch(() => { SHOP.busy = null; SHOP.msg = tr('payFailed'); });
}
function useBooster(k) {
  INV[k] = Math.max(0, (INV[k] || 0) - 1);
  if (serverOn()) api('/use', { item: k }).then(r => r.items && setInv(r.items)).catch(() => {});
}

// before a level: switch on boosters the player owns
let PREP = null;
function prepLevel(li) { // li = -1 for Night Shift
  const hardOk = li >= 0 && (PROG.stars[String(li + 1)] || 0) > 0;
  if (!owns('heart') && !owns('meter') && !hardOk) { if (li < 0) startEndless(); else startLevel(li); return; }
  PREP = { li, heart: false, meter: false, hard: false, hardOk };
  setScreen('prep');
}
function startPrepared() {
  const pr = PREP; PREP = null;
  if (pr.li < 0) startEndless();
  else if (pr.hard) { newRun(pr.li); G.hard = true; setScreen('game'); setupWave(0); }
  else startLevel(pr.li);
  if (pr.heart && owns('heart')) { useBooster('heart'); for (const h of G.heroes) { h.maxHearts++; h.hearts++; } }
  if (pr.meter && owns('meter')) { useBooster('meter'); G.meter = Math.max(G.meter, 50); }
}
function drawPrep() {
  drawMap(); UI = [];
  ctx.fillStyle = 'rgba(12,10,26,.9)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffc857';
  const title = PREP.li < 0 ? tr('night') : tr('levelRoom', PREP.li + 1, CHAPTERS[LEVELS[PREP.li].ch].name);
  fitFont(title, W - 60, 26); ctx.fillText(title, W / 2, 200);
  ctx.fillStyle = '#c9c2e6'; ctx.font = `800 14px ${FB}`; ctx.fillText(tr('boosters'), W / 2, 238);
  const row = (y, key, name, desc) => {
    const on = PREP[key], have = INV[key] || 0;
    UI.push({ x: 40, y, w: W - 80, h: 70, cb: () => { if (have) PREP[key] = !PREP[key]; } });
    ctx.fillStyle = on ? 'rgba(255,200,87,.16)' : '#1d1938'; rr(40, y, W - 80, 70, 14); ctx.fill();
    ctx.strokeStyle = on ? '#ffc857' : '#3b3563'; ctx.lineWidth = 2; rr(40, y, W - 80, 70, 14); ctx.stroke();
    ctx.strokeStyle = on ? '#ffc857' : '#8f88b5'; ctx.lineWidth = 2.5; rr(58, y + 23, 24, 24, 6); ctx.stroke();
    if (on) { ctx.beginPath(); ctx.moveTo(63, y + 35); ctx.lineTo(68, y + 41); ctx.lineTo(77, y + 28); ctx.stroke(); }
    ctx.textAlign = 'left'; ctx.fillStyle = have ? '#f4efe6' : '#6f6893'; fitFont(name, W - 250, 16); ctx.fillText(name, 96, y + 24);
    ctx.fillStyle = '#b9b2da'; fitFont(desc, W - 150, 12, 700, FB); ctx.fillText(desc, 96, y + 48);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffc857'; ctx.font = `900 14px ${FD}`; ctx.fillText(tr('owned', have), W - 56, y + 24);
  };
  row(268, 'heart', tr('boostHeart'), tr('boostHeartD'));
  row(352, 'meter', tr('boostMeter'), tr('boostMeterD'));
  if (PREP.hardOk) {
    const y = 436, on = PREP.hard;
    UI.push({ x: 40, y, w: W - 80, h: 70, cb: () => { PREP.hard = !PREP.hard; } });
    ctx.fillStyle = on ? 'rgba(255,93,122,.16)' : '#1d1938'; rr(40, y, W - 80, 70, 14); ctx.fill();
    ctx.strokeStyle = on ? '#ff5d7a' : '#3b3563'; ctx.lineWidth = 2; rr(40, y, W - 80, 70, 14); ctx.stroke();
    ctx.strokeStyle = on ? '#ff5d7a' : '#8f88b5'; ctx.lineWidth = 2.5; rr(58, y + 23, 24, 24, 6); ctx.stroke();
    if (on) { ctx.beginPath(); ctx.moveTo(63, y + 35); ctx.lineTo(68, y + 41); ctx.lineTo(77, y + 28); ctx.stroke(); }
    ctx.textAlign = 'left'; ctx.fillStyle = '#f4efe6'; fitFont(tr('hardName'), W - 220, 16); ctx.fillText(tr('hardName'), 96, y + 24);
    const hd = tr('hardDesc', LEVELS[PREP.li].par);
    ctx.fillStyle = '#b9b2da'; fitFont(hd, W - 150, 12, 700, FB); ctx.fillText(hd, 96, y + 48);
    if (PROG.hard && PROG.hard[String(PREP.li + 1)]) { ctx.save(); ctx.translate(W - 70, y + 36); drawHat('crown', 20); ctx.restore(); }
  }
  uiBtn(75, 530, W - 150, 56, tr('startLvl'), startPrepared, true);
  uiBtn(75, 600, W - 150, 46, tr('cancel'), () => { PREP = null; setScreen('map'); }, false);
}

function drawShopIcon(id, x, y) {
  if (id === 'heart3') { heart(x, y + 2, 11, '#ff5d7a'); ctx.fillStyle = '#fff'; ctx.font = `900 11px ${FD}`; ctx.textAlign = 'center'; ctx.fillText('+1', x, y + 1); }
  else if (id === 'meter3') {
    ctx.fillStyle = '#231e44'; rr(x - 20, y - 8, 40, 16, 8); ctx.fill();
    ctx.fillStyle = '#ff8fb1'; rr(x - 20, y - 8, 20, 16, 8); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; rr(x - 20, y - 8, 40, 16, 8); ctx.stroke();
  } else if (id.startsWith('hero_')) drawHero(HEROES.find(h => h.id === id.slice(5)), x, y + 3, 17, null, { hat: false, look: [0, .6] });
  else if (id === 'rainbow') {
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ['#ff5d7a', '#ffd166', '#9ee06a', '#6ec3ff', '#b18cff'].forEach((c, k) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(x, y + 10, 20 - k * 3.4, Math.PI, 0); ctx.stroke(); });
  } else { ctx.save(); ctx.translate(x, y + 16); drawHat(id.slice(4), 26); ctx.restore(); }
}
function drawShop() {
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 320);
  g.addColorStop(0, 'rgba(255,200,87,.14)'); g.addColorStop(1, 'rgba(255,200,87,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  iconBtn(12, 13, 'back', () => setScreen('map'));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; fitFont(tr('shop'), W - 120, 30); ctx.fillText(tr('shop'), W / 2, 32);
  const list = SHOP_LIST.concat(EVENTS.filter(e => PROG.hats && PROG.hats[e.hat]).map(e => 'hat_' + e.hat)), step = list.length > 8 ? 64 : 76;
  list.forEach((id, i) => {
    const g0 = GRANTS[id] || { [id]: 1 }, y = 76 + i * step, perm = !g0.heart && !g0.meter, key = Object.keys(g0)[0];
    const have = (INV[key] || 0) + (PROG.hats && PROG.hats[id.slice(4)] ? 1 : 0);
    ctx.fillStyle = '#1d1938'; rr(16, y, W - 32, step - 8, 14); ctx.fill();
    ctx.strokeStyle = perm && have ? 'rgba(92,225,198,.5)' : '#3b3563'; ctx.lineWidth = 1.5; rr(16, y, W - 32, step - 8, 14); ctx.stroke();
    drawShopIcon(id, 52, y + 32);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4efe6';
    fitFont(tr('item.' + id), W - 250, 15); ctx.fillText(tr('item.' + id), 88, y + 22);
    const desc = perm ? tr('itemd.' + id) : `${tr('itemd.' + id)} · ${tr('owned', have)}`;
    ctx.fillStyle = '#b9b2da'; fitFont(desc, W - 250, 11.5, 700, FB); ctx.fillText(desc, 88, y + 46);
    let label = `★ ${PRICES[id]}`, cb = () => buyItem(id), primary = true;
    if (SHOP.busy === id) label = tr('payWait');
    else if (perm && have) {
      primary = false;
      if (id.startsWith('hero_')) { label = tr('owned', 1).replace(/\d+/, '✓'); cb = () => setScreen('heroes'); }
      else if (id === 'rainbow') { const on = rainbowOn(); label = on ? tr('unequip') : tr('equip'); cb = () => setRainbow(!on); }
      else { const kind = id.slice(4), on = activeHat() === kind; label = on ? tr('unequip') : tr('equip'); cb = () => setHat(on ? '' : kind); }
    }
    uiBtn(W - 142, y + 12, 114, 44, label, cb, primary);
  });
  const note = SHOP.msg || (canPay() ? '' : tr('shopTgOnly'));
  if (note) { ctx.textAlign = 'center'; ctx.fillStyle = SHOP.msg ? '#ff8fb1' : '#8f88b5'; ctx.font = `800 13px ${FB}`; wrap(note, W / 2, 710, W - 60, 18); }
}


// ---------- daily: login bonus, challenge of the day, inviting friends ----------
// The worker hands out the login bonus and challenge rewards (once a day) and gifts invites.
const DAY_MS = 86400000;
const utcDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
function weekKey(ts = Date.now()) {
  const d = new Date(ts), back = (d.getUTCDay() + 6) % 7;
  return utcDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}
const DAILY_REWARDS = [{ meter: 1 }, { heart: 1 }, { meter: 1 }, { heart: 1 }, { meter: 2 }, { heart: 2 }, { hat_party: 1, heart: 1, meter: 1 }]; // = DAILY in the worker
const DAILY = { loaded: false, streak: 0, claimed: false, challengeDone: false, invited: 0, bot: null, today: null, msg: null, shown: false };
// what "win the level" also has to include; picked by date, same for everyone at the same progress
const CHALLENGES = {
  knots: { n: 4, ok: g => g.stats.knots >= 4 },
  lasers: { n: 2, ok: g => g.stats.lasers >= 2 },
  noko: { n: 0, ok: g => !g.everKo },
  par: { n: 0, ok: g => g.turn <= g.lvl.par },
  portals: { n: 2, ok: g => g.stats.portals >= 2 },
};
function todayChallenge() {
  const today = DAILY.today || utcDay(), dn = Math.floor(Date.parse(today) / DAY_MS);
  const count = Math.max(1, Math.min(PROG.unlocked, LEVELS.length)), lo = Math.max(0, count - 6);
  const li = lo + dn % (count - lo);
  let type = Object.keys(CHALLENGES)[dn % 5];
  if (type === 'portals' && LEVELS[li].noBoxes) type = 'knots';
  const n = type === 'par' ? LEVELS[li].par : CHALLENGES[type].n;
  return { li, type, n, reward: dn % 2 ? 'heart' : 'meter', today };
}
const challengeDone = () => DAILY.challengeDone || lsGet('pawsling-ch') === (DAILY.today || utcDay());
async function loadDaily() {
  if (!serverOn()) return;
  try {
    const d = await api('/daily', {});
    Object.assign(DAILY, { loaded: true, streak: d.streak, claimed: d.claimed, challengeDone: d.challengeDone, invited: d.invited, bot: d.bot, today: d.today });
    if (d.items) setInv(d.items);
    if (d.gifted) DAILY.msg = tr('giftedMsg');
    // open the daily screen once when today's bonus has just been given
    if ((d.claimed || d.gifted) && SCREEN === 'map' && !DAILY.shown) { DAILY.shown = true; setScreen('daily'); }
  } catch (e) {}
}
function startChallenge() {
  const ch = todayChallenge();
  startLevel(ch.li);
  G.challenge = ch;
}
function checkChallenge() {
  const ch = G.challenge;
  if (!ch || challengeDone() || !CHALLENGES[ch.type].ok(G)) return;
  G.challengeWon = ch.reward;
  DAILY.challengeDone = true; lsSet('pawsling-ch', ch.today);
  if (serverOn()) api('/challenge', { reward: ch.reward }).then(r => r.items && setInv(r.items)).catch(() => {});
}
function inviteFriend() {
  const uid = TG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.id;
  if (!serverOn() || !DAILY.bot || !uid) { DAILY.msg = tr('dailyTgOnly'); return; }
  const link = `https://t.me/${DAILY.bot}?startapp=ref_${uid}`;
  try { TG.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(tr('inviteText'))}`); }
  catch (e) { DAILY.msg = tr('dailyTgOnly'); }
}
function rewardIcon(g, x, y) {
  const keys = Object.keys(g);
  if (g.hat_party) { ctx.save(); ctx.translate(x + 4, y + 22); drawHat('party', 15); ctx.restore(); return; }
  const k = keys[0], n = g[k];
  if (k === 'heart') heart(x, y, 8, '#ff5d7a');
  else { ctx.fillStyle = '#231e44'; rr(x - 11, y - 5, 22, 10, 5); ctx.fill(); ctx.fillStyle = '#ff8fb1'; rr(x - 11, y - 5, 11, 10, 5); ctx.fill(); }
  if (n > 1) { ctx.fillStyle = '#fff'; ctx.font = `900 11px ${FD}`; ctx.textAlign = 'left'; ctx.fillText('×' + n, x + 12, y + 1); }
}
function drawDaily() {
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 320);
  g.addColorStop(0, 'rgba(255,200,87,.14)'); g.addColorStop(1, 'rgba(255,200,87,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  iconBtn(12, 13, 'back', () => setScreen('map'));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; fitFont(tr('daily'), W - 120, 30); ctx.fillText(tr('daily'), W / 2, 32);
  const card = (y, h) => { ctx.fillStyle = '#1d1938'; rr(16, y, W - 32, h, 16); ctx.fill(); ctx.strokeStyle = '#3b3563'; ctx.lineWidth = 1.5; rr(16, y, W - 32, h, 16); ctx.stroke(); };
  // login bonus: seven days
  card(66, 150);
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4efe6'; ctx.font = `900 16px ${FD}`; ctx.fillText(tr('dailyBonus'), 32, 88);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffc857'; ctx.font = `800 13px ${FB}`; ctx.fillText(tr('streak', DAILY.streak), W - 32, 88);
  DAILY_REWARDS.forEach((rw, i) => {
    const x = 28 + i * 57, y = 106, got = i < DAILY.streak, cur = i === DAILY.streak - 1;
    ctx.fillStyle = got ? 'rgba(255,200,87,.16)' : '#15122a'; rr(x, y, 51, 78, 10); ctx.fill();
    ctx.strokeStyle = cur ? '#ffc857' : got ? 'rgba(255,200,87,.4)' : '#3b3563'; ctx.lineWidth = cur ? 2.5 : 1.5; rr(x, y, 51, 78, 10); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = got ? '#ffc857' : '#8f88b5'; ctx.font = `900 12px ${FD}`; ctx.fillText(tr('dayShort', i + 1), x + 25, y + 14);
    rewardIcon(rw, x + 20, y + 42);
    if (got) { ctx.strokeStyle = '#5ce1c6'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 18, y + 64); ctx.lineTo(x + 24, y + 70); ctx.lineTo(x + 34, y + 58); ctx.stroke(); }
  });
  // challenge of the day
  const ch = todayChallenge(), done = challengeDone();
  card(230, 196);
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4efe6'; ctx.font = `900 16px ${FD}`; ctx.fillText(tr('challenge'), 32, 254);
  ctx.fillStyle = CHAPTERS[LEVELS[ch.li].ch].col; fitFont(tr('levelRoom', ch.li + 1, CHAPTERS[LEVELS[ch.li].ch].name), W - 70, 15);
  ctx.fillText(tr('levelRoom', ch.li + 1, CHAPTERS[LEVELS[ch.li].ch].name), 32, 284);
  ctx.fillStyle = '#c9c2e6'; ctx.font = `800 14px ${FB}`; wrap(tr('ch.' + ch.type, ch.n), 32, 312, W - 70, 19);
  ctx.fillStyle = '#8f88b5'; ctx.font = `800 13px ${FB}`; ctx.fillText(tr('reward'), 32, 356);
  rewardIcon({ [ch.reward]: 1 }, 118, 356);
  ctx.fillStyle = '#f4efe6'; ctx.font = `800 13px ${FB}`; ctx.textAlign = 'left';
  ctx.fillText(tr(ch.reward === 'heart' ? 'boostHeart' : 'boostMeter'), 136, 357);
  if (done) { ctx.textAlign = 'center'; ctx.fillStyle = '#5ce1c6'; ctx.font = `900 18px ${FD}`; ctx.fillText(tr('chDone'), W / 2, 398); }
  else uiBtn(75, 374, W - 150, 44, tr('play'), startChallenge, true);
  // invite a friend
  card(440, 176);
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4efe6'; ctx.font = `900 16px ${FD}`; ctx.fillText(tr('invite'), 32, 464);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffc857'; ctx.font = `800 13px ${FB}`; ctx.fillText(tr('invited', DAILY.invited), W - 32, 464);
  ctx.textAlign = 'left'; ctx.fillStyle = '#c9c2e6'; ctx.font = `800 13px ${FB}`; wrap(tr('inviteDesc'), 32, 492, W - 70, 18);
  uiBtn(75, 556, W - 150, 46, tr('inviteBtn'), inviteFriend, false);
  const note = DAILY.msg || (serverOn() ? '' : tr('dailyTgOnly'));
  if (note) { ctx.textAlign = 'center'; ctx.fillStyle = DAILY.msg ? '#5ce1c6' : '#8f88b5'; ctx.font = `800 13px ${FB}`; wrap(note, W / 2, 648, W - 60, 18); }
}


// ---------- heroes: XP, levels, perks ----------
const HERO_MAX = 10;
const xpNeed = L => 60 * L; // XP from level L to L+1
function heroLevel(id) {
  let xp = (PROG.xp && PROG.xp[id]) || 0, L = 1;
  while (L < HERO_MAX && xp >= xpNeed(L)) { xp -= xpNeed(L); L++; }
  return { L, xp, need: xpNeed(L) };
}
const bounceBonus = h => (h.lvl >= 10 ? .25 : h.lvl >= 5 ? .2 : .15);
function gainXp(n) {
  PROG.xp = PROG.xp || {};
  G.xpGain = n; G.levelUps = [];
  for (const h of G.heroes) {
    const before = heroLevel(h.id).L;
    PROG.xp[h.id] = (PROG.xp[h.id] || 0) + n;
    const after = heroLevel(h.id).L;
    if (after > before) G.levelUps.push(`${h.name} ${after}`);
  }
  if (G.levelUps.length) { Snd.play('zoom'); haptic('success'); }
  saveProg();
}
function toggleTeam(id) {
  const team = teamDefs().map(d => d.id);
  if (team.includes(id)) { if (team.length > 4) PROG.team = team.filter(x => x !== id); }
  else if (team.length < 5) PROG.team = [...team, id];
  else { Snd.play('locked'); return; }
  saveProg();
}
function drawHeroes() {
  ctx.fillStyle = '#110e22'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 60, 10, W / 2, 60, 320);
  g.addColorStop(0, 'rgba(255,200,87,.14)'); g.addColorStop(1, 'rgba(255,200,87,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  iconBtn(12, 13, 'back', () => setScreen('map'));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc857'; fitFont(tr('heroes'), W - 120, 30); ctx.fillText(tr('heroes'), W / 2, 32);
  ctx.fillStyle = '#8f88b5'; fitFont(`${tr('teamRule')} · ${tr('perAll')}`, W - 30, 11, 800, FB); ctx.fillText(`${tr('teamRule')} · ${tr('perAll')}`, W / 2, 62);
  const team = teamDefs().map(d => d.id);
  HEROES.forEach((h, i) => {
    const y = 78 + i * 90, own = heroOwned(h.id), inTeam = team.includes(h.id), lv = heroLevel(h.id), max = lv.L >= HERO_MAX;
    ctx.fillStyle = inTeam ? '#231e44' : '#1a1733'; rr(16, y, W - 32, 84, 14); ctx.fill();
    ctx.strokeStyle = inTeam ? h.yarn : '#3b3563'; ctx.lineWidth = inTeam ? 2 : 1.5; rr(16, y, W - 32, 84, 14); ctx.stroke();
    ctx.save(); if (!own) ctx.globalAlpha = .4; drawHero(h, 50, y + 44, 22, null, { look: [0, .5] }); ctx.restore();
    ctx.textAlign = 'left'; ctx.fillStyle = own ? h.yarn : '#6f6893'; fitFont(h.name, 150, 16); ctx.fillText(h.name, 86, y + 17);
    if (!own) {
      ctx.fillStyle = '#8f88b5'; ctx.font = `800 12px ${FB}`;
      ctx.fillText(h.id === 'homa' ? tr('afterLvl', HOMA_UNLOCK) : tr('inShop'), 86, y + 44);
      if (h.id !== 'homa') UI.push({ x: 16, y, w: W - 32, h: 84, cb: () => { SHOP.msg = null; setScreen('shop'); } });
      return;
    }
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffc857'; ctx.font = `900 14px ${FD}`; ctx.fillText(tr('lvl', lv.L), W - 124, y + 17);
    ctx.fillStyle = '#0d0b1d'; rr(86, y + 29, W - 222, 8, 4); ctx.fill();
    ctx.fillStyle = h.yarn; rr(86, y + 29, Math.max(8, (W - 222) * (max ? 1 : lv.xp / lv.need)), 8, 4); ctx.fill();
    [5, 10].forEach((at, k) => {
      const open = lv.L >= at, py = y + 52 + k * 17, txt = `${tr('lvl', at)}: ${tr(`perk.${h.id}.${at}`)}`;
      ctx.textAlign = 'left'; ctx.fillStyle = open ? '#5ce1c6' : '#6f6893';
      fitFont(txt, W - 222, 11, 800, FB); ctx.fillText(txt, 86, py);
    });
    // team toggle
    const bx = W - 116, by = y + 22, on = inTeam;
    UI.push({ x: bx, y: by, w: 92, h: 40, cb: () => toggleTeam(h.id) });
    ctx.fillStyle = on ? h.yarn : '#2e2859'; rr(bx, by, 92, 40, 12); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = on ? '#15122a' : '#f4efe6'; fitFont(on ? tr('inTeam') : tr('teamAdd'), 84, 13, 900, FD);
    ctx.fillText(on ? tr('inTeam') : tr('teamAdd'), bx + 46, by + 21);
  });
}


// ---------- seasonal events: a few themed levels and a hat, only while the event runs ----------
const EVENTS = [
  { id: 'halloween', from: '10-15', to: '11-05', ch: 5, hat: 'pumpkin', col: '#ff8a3c', costume: 'pumpkin', bg: '#2a160c' },
  { id: 'newyear', from: '12-15', to: '01-10', ch: 2, hat: 'santa', col: '#e5484d', costume: 'santa', bg: '#0e1a2a' },
];
const EVENT_LEVELS = {
  halloween: [
    { par: 10, hpMul: 1.3, atkMul: 1.15, waves: [[['vac', 110, 200], ['rc', 340, 200], ['vac', 225, 360]], [['spray', 100, 180], ['brush', 225, 260], ['spray', 350, 180]]] },
    { par: 12, hpMul: 1.3, atkMul: 1.15, waves: [[['mop', 225, 200], ['rc', 100, 320], ['rc', 350, 320]], [['fan', 225, 240], ['split', 110, 380], ['split', 340, 380]]] },
    { par: 14, hpMul: 1.3, atkMul: 1.15, boss: .6, waves: [[['shield', 110, 300], ['rc', 225, 180], ['shield', 340, 300]], [['boss', 225, 240], ['vac', 85, 430], ['vac', 365, 430]]] },
  ],
  newyear: [
    { par: 10, hpMul: 1.3, atkMul: 1.15, waves: [[['vac', 90, 170], ['vac', 360, 170], ['spray', 225, 300]], [['mop', 225, 200], ['brush', 110, 340], ['brush', 340, 340]]] },
    { par: 12, hpMul: 1.3, atkMul: 1.15, waves: [[['fan', 110, 220], ['fan', 340, 220], ['vac', 225, 380]], [['split', 225, 200], ['shield', 110, 330], ['rc', 340, 330]]] },
    { par: 14, hpMul: 1.3, atkMul: 1.15, boss: .6, waves: [[['brush', 110, 300], ['split', 225, 180], ['brush', 340, 300]], [['boss', 225, 240], ['mop', 85, 430], ['mop', 365, 430]]] },
  ],
};
function activeEvent(ts = Date.now()) {
  if (DEV && window.__event) return EVENTS.find(e => e.id === window.__event) || null;
  const md = new Date(ts).toISOString().slice(5, 10);
  return EVENTS.find(e => (e.from <= e.to ? md >= e.from && md <= e.to : md >= e.from || md <= e.to)) || null;
}
// progress is kept per year, so next year's event starts fresh (its hat stays)
function evKey(ev, ts = Date.now()) {
  const d = new Date(ts), md = d.toISOString().slice(5, 10);
  return `${ev.id}-${ev.from > ev.to && md <= ev.to ? d.getUTCFullYear() - 1 : d.getUTCFullYear()}`;
}
const evDone = ev => Math.min(EVENT_LEVELS[ev.id].length, (PROG.ev && PROG.ev[evKey(ev)]) || 0);
function startEventLevel(i) {
  const ev = activeEvent();
  if (!ev) { goMap(); return; }
  newRun(0);
  G.li = -2;
  G.lvl = { ...EVENT_LEVELS[ev.id][i], ch: ev.ch, event: ev, evIdx: i };
  G.ch = CHAPTERS[ev.ch];
  setScreen('game');
  setupWave(0);
}
function eventWin() {
  const ev = G.lvl.event, k = evKey(ev), n = EVENT_LEVELS[ev.id].length;
  PROG.ev = { ...(PROG.ev || {}) };
  const before = PROG.ev[k] || 0;
  PROG.ev[k] = Math.max(before, G.lvl.evIdx + 1);
  if (PROG.ev[k] >= n && !(PROG.hats && PROG.hats[ev.hat])) {
    PROG.hats = { ...(PROG.hats || {}), [ev.hat]: 1 };
    setHat(ev.hat); G.evHat = true;
  }
  gainXp(30 + 5 * G.stars);
}
function drawEventIcon(id, x, y, s) {
  if (id === 'halloween') {
    ctx.fillStyle = '#ff8a3c'; ctx.strokeStyle = '#b8521a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * .78, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, s * .45, s * .78, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#3f8a3c'; ctx.fillRect(x - s * .1, y - s * 1.05, s * .2, s * .32);
    ctx.fillStyle = '#2a160c';
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * s * .45, y - s * .25); ctx.lineTo(x + sd * s * .2, y - s * .05); ctx.lineTo(x + sd * s * .5, y); ctx.closePath(); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - s * .5, y + s * .2); ctx.quadraticCurveTo(x, y + s * .6, x + s * .5, y + s * .2); ctx.quadraticCurveTo(x, y + s * .38, x - s * .5, y + s * .2); ctx.fill();
  } else {
    ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, cx = Math.cos(a), cy = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cx * s, y + cy * s); ctx.stroke();
      for (const sd of [-1, 1]) { const b = a + sd * .6; ctx.beginPath(); ctx.moveTo(x + cx * s * .6, y + cy * s * .6); ctx.lineTo(x + cx * s * .6 + Math.cos(b) * s * .3, y + cy * s * .6 + Math.sin(b) * s * .3); ctx.stroke(); }
    }
  }
}
function drawEventCard(ev, y) {
  const n = EVENT_LEVELS[ev.id].length, done = evDone(ev);
  const g = ctx.createLinearGradient(12, y, W - 12, y + 88);
  g.addColorStop(0, ev.bg); g.addColorStop(1, '#15122a');
  ctx.fillStyle = g; rr(12, y, W - 24, 88, 18); ctx.fill();
  ctx.strokeStyle = ev.col; ctx.lineWidth = 2.5; rr(12, y, W - 24, 88, 18); ctx.stroke();
  drawEventIcon(ev.id, 54, y + 46, 22);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = ev.col; fitFont(tr('ev.' + ev.id), W - 200, 20); ctx.fillText(tr('ev.' + ev.id), 90, y + 30);
  ctx.fillStyle = '#c9c2e6'; fitFont(tr('evSub', done, n), W - 200, 12, 800, FB); ctx.fillText(tr('evSub', done, n), 90, y + 58);
  ctx.save(); ctx.translate(W - 58, y + 60); drawHat(ev.hat, 30); ctx.restore();
  if (done >= n) { ctx.strokeStyle = '#5ce1c6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W - 46, y + 66); ctx.lineTo(W - 40, y + 72); ctx.lineTo(W - 28, y + 58); ctx.stroke(); }
  const sy = y - MAP.y;
  if (sy + 88 > 0 && sy < MAP_VIEW) UI.push({ x: 12, y: sy, w: W - 24, h: 88, cb: () => startEventLevel(Math.min(done, n - 1)) });
}
function drawEventFx(id) {
  if (LOWFX) return;
  const t = RM ? 0 : T;
  if (id === 'newyear') {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (let k = 0; k < 40; k++) {
      const x = frac(k * .618 + Math.sin(t * .3 + k) * .02) * W, y = TOP + frac(k * .37 + t * .05 * (1 + k % 3 * .3)) * (BOT - TOP);
      circ(x, y, 1.2 + k % 3 * .6);
    }
  } else {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) glowAt(60 + k * 85, BOT - 40 - (k % 2) * 20, 50, '255,140,60', .12 + .06 * Math.sin(t * 3 + k));
    ctx.restore();
    ctx.fillStyle = 'rgba(20,10,30,.85)';
    for (let k = 0; k < 4; k++) {
      const ph = frac(t * .07 + k * .25), x = ph * (W + 80) - 40, y = TOP + 60 + k * 70 + Math.sin(t * 3 + k) * 12, f = Math.sin(t * 16 + k) * 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 8, y - 6 - f, x - 16, y + f); ctx.quadraticCurveTo(x - 8, y - 2, x, y + 3);
      ctx.quadraticCurveTo(x + 8, y - 2, x + 16, y + f); ctx.quadraticCurveTo(x + 8, y - 6 - f, x, y); ctx.fill();
    }
  }
}

function drawEnd() {
  const win = G.state === 'win';
  ctx.fillStyle = G.ch.shade; ctx.fillRect(0, 0, W, H);
  const c = G.lvl.ch;
  if (win) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowAt(W / 2, 322, 190, hexRgb(G.ch.col), .18 + .05 * Math.sin(T * 2)); ctx.restore();
    for (const p of G.confetti) drawPart(p);
  }
  chTrim(c, 0, 0, W, G.ch.col + '44'); chTrim(c, 0, H - 10, W, G.ch.col + '44');
  G.heroes.forEach((h, i) => drawHero(h, W / 2 + (i - (G.heroes.length - 1) / 2) * (G.heroes.length > 4 ? 80 : 90), 150 + (win ? Math.abs(Math.sin(T * 5 + i)) * -14 : 6), 28, null, { mood: win ? 'happy' : 'sad', look: [0, 1] }));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = win ? '#ffc857' : '#ff6b85'; ctx.font = `900 34px ${FD}`;
  const endTitle = win ? (G.lvl.event ? tr('evDone') : G.hard ? tr('hardDone', G.li + 1) : tr('levelDone', G.li + 1)) : G.lvl.endless ? tr('shiftOver') : tr('vacWon');
  fitFont(endTitle, W - 40, 34); ctx.fillText(endTitle, W / 2, 235);
  ctx.fillStyle = '#f4efe6'; ctx.font = `800 15px ${FB}`;
  ctx.fillText(win ? tr('winSub', G.turn, G.lvl.par) : G.lvl.endless ? tr('survived', wavesWord(G.wave)) : (G.loseReason === 'turns' ? tr('hardTurns') : G.loseReason === 'ko' ? tr('allKo') : tr('waveTry', G.wave + 1, G.lvl.waves.length)), W / 2, 272);
  let y0 = 320;
  if (win) {
    for (let s = 0; s < 3; s++) {
      const pop = s < G.stars ? 1 + Math.sin(T * 5 + s) * .06 : 1;
      star(W / 2 - 60 + s * 60, 322, 24 * pop, s < G.stars ? '#ffc857' : '#2f2a52', s < G.stars ? null : '#3b3563');
    }
    y0 = 382;
  }
  if (G.xpGain) {
    const up = G.levelUps && G.levelUps.length ? ' · ' + tr('lvlUp', G.levelUps.join(', ')) : '';
    ctx.textAlign = 'center'; ctx.fillStyle = up ? '#5ce1c6' : '#b9b2da';
    fitFont(tr('xpGain', G.xpGain) + up, W - 40, 13, 800, FB); ctx.fillText(tr('xpGain', G.xpGain) + up, W / 2, (win ? 382 : 320) + 132);
  }
  const st = G.stats;
  const rows = [[tr('st.knots'), st.knots], [tr('st.lasers'), st.lasers], [tr('st.crits'), st.crits], [tr('st.portals'), st.portals]];
  rows.forEach(([k, v], i) => {
    const y = y0 + i * 34;
    ctx.fillStyle = '#231e44'; rr(80, y - 14, W - 160, 28, 10); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = '#c9c2e6'; ctx.font = `700 13px ${FB}`; ctx.fillText(k, 96, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `900 16px ${FD}`; ctx.fillText(v, W - 96, y);
  });
  if (win && G.challengeWon) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffc857';
    const cw = tr('chWon', tr(G.challengeWon === 'heart' ? 'boostHeart' : 'boostMeter'));
    fitFont(cw, W - 40, 15, 900, FD); ctx.fillText(cw, W / 2, 570);
  }
  if (win && G.newBest) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#5ce1c6'; ctx.font = `800 14px ${FB}`;
    ctx.fillText(tr('newBestLevel'), W / 2, y0 + 150);
  }
  if (G.lvl.endless) {
    ctx.textAlign = 'center'; ctx.font = `800 14px ${FB}`;
    ctx.fillStyle = G.newBest ? '#5ce1c6' : '#8f88b5';
    ctx.fillText(G.newBest ? tr('newBestNight') : tr('record', wavesWord(PROG.endless || 0)), W / 2, y0 + 150);
    const wind = drawSecondWind();
    uiBtn(75, 600, W - 150, wind ? 50 : 56, tr('again'), startEndless, !wind);
    uiBtn(75, 670, W - 150, 46, tr('map'), goMap, false);
    return;
  }
  if (G.lvl.event) {
    const i = G.lvl.evIdx, more = win && i < EVENT_LEVELS[G.lvl.event.id].length - 1;
    if (win && G.evHat) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffc857'; fitFont(tr('evHat'), W - 40, 16); ctx.fillText(tr('evHat'), W / 2, 572); }
    const wind = !win && drawSecondWind();
    if (more) uiBtn(75, 600, W - 150, 56, tr('next'), () => startEventLevel(i + 1), true);
    else uiBtn(75, 600, W - 150, wind ? 50 : 56, win ? tr('toMap') : tr('again'), win ? goMap : () => startEventLevel(i), !wind);
    if (more || win) uiBtn(75, 670, W - 150, 46, more ? tr('map') : tr('again'), more ? goMap : () => startEventLevel(i), false);
    else uiBtn(75, 670, W - 150, 46, tr('map'), goMap, false);
    return;
  }
  const hasNext = win && G.li < LEVELS.length - 1;
  const li = G.li;
  const wind = !win && drawSecondWind();
  if (hasNext) uiBtn(75, 600, W - 150, 56, tr('next'), () => startLevel(li + 1), true);
  else uiBtn(75, 600, W - 150, wind ? 50 : 56, win ? tr('toMap') : tr('again'), win ? goMap : () => startLevel(li), !wind);
  if (hasNext) {
    uiBtn(75, 670, (W - 160) / 2, 46, tr('again'), () => startLevel(li), false);
    uiBtn(85 + (W - 160) / 2, 670, (W - 160) / 2, 46, tr('map'), goMap, false);
  } else if (!win) {
    uiBtn(75, 670, W - 150, 46, tr('map'), goMap, false);
  }
  if (win && !hasNext) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffc857'; ctx.font = `900 18px ${FD}`;
    fitFont(tr('allDone'), W - 30, 18); ctx.fillText(tr('allDone'), W / 2, 690);
  }
}

function drawGame() {
  const c = G.lvl.ch;
  ctx.drawImage(BGS[c], 0, 0, W, H);
  const sh = RM ? 0 : G.shake;
  ctx.save();
  ctx.translate((Math.random() - .5) * sh, (Math.random() - .5) * sh);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, TOP, W, BOT - TOP); ctx.clip();
  drawRoomUnder(c);
  drawPuddles();
  drawTrails();
  G.boxes.forEach(drawBox);
  G.snacks.forEach(drawSnack);
  drawLaser();
  drawShields();
  for (const e of G.enemies) if (e.alive) drawEnemy(e);
  drawThreats();
  G.heroes.forEach((h, i) => {
    const cur = i === G.cur && (G.state === 'aim' || G.state === 'moving');
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(h.x, h.y + h.r * .85, h.r * .9, h.r * .3, 0, 0, TAU); ctx.fill();
    if (cur) {
      ctx.strokeStyle = G.zoomArmed ? '#ffd166' : '#ffc857'; ctx.lineWidth = 3;
      ctx.globalAlpha = .6 + .4 * Math.sin(T * 6);
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 8, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const gold = cur && (G.zoomArmed || (G.shot && G.shot.zoom));
    const sp = G.shot && G.shot.hero === h ? Math.hypot(h.vx, h.vy) : 0;
    let look = [0, 0];
    if (cur && drag) { const lx = drag.sx - drag.x, ly = drag.sy - drag.y, l = Math.hypot(lx, ly) || 1; look = [lx / l, ly / l]; }
    else if (sp > 60) look = [h.vx / sp, h.vy / sp];
    else {
      let best = null, bd = 1e9;
      for (const e of G.enemies) if (e.alive) { const d = dist(h.x, h.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (best) look = [(best.x - h.x) / bd, (best.y - h.y) / bd];
    }
    const ho = { look };
    if (h.ko) {
      ctx.save(); ctx.globalAlpha = .55; ctx.translate(h.x, h.y); ctx.rotate(.5);
      drawHero(h, 0, 0, h.r, null, { mood: 'hurt' }); ctx.restore();
      for (let k = 0; k < 3; k++) {
        const a = (RM ? 0 : T * 3) + k * TAU / 3;
        star(h.x + Math.cos(a) * h.r * .9, h.y - h.r - 6 + Math.sin(a) * 5, 5, '#ffe066');
      }
      ctx.fillStyle = '#c9c2e6'; ctx.font = `900 11px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`zZ ${h.ko}`, h.x, h.y + h.r + 12);
      return;
    }
    if (!(G.shot && G.shot.hero === h)) heartsRow(h, h.x, h.y - h.r - 14, 3.6);
    if (sp > 60 && !RM) {
      // squash & stretch along the flight direction, with a soft glow in the hero's yarn colour
      const k = Math.min(.2, sp / 7000), ang = Math.atan2(h.vy, h.vx);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glowAt(h.x - h.vx * .02, h.y - h.vy * .02, h.r * 2.2, hexRgb(h.yarn), .35); ctx.restore();
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(ang); ctx.scale(1 + k, 1 - k); ctx.rotate(-ang);
      drawHero(h, 0, 0, h.r, gold ? '#ffd166' : null, ho); ctx.restore();
    } else drawHero(h, h.x, h.y, h.r, gold ? '#ffd166' : null, ho);
    if (h.webbed) drawWeb(h.x, h.y, h.r + 10);
  });
  drawFx();
  drawRoomOver(c);
  if (G.lvl.event) drawEventFx(G.lvl.event.id);
  drawAim();
  drawTypeTag();
  ctx.restore();
  drawTexts();
  ctx.restore();
  if (G.flash) {
    const f = G.flash, a = f.a;
    if (f.col === '#ff3b5c') {
      const g = ctx.createRadialGradient(W / 2, H / 2, 180, W / 2, H / 2, 480);
      g.addColorStop(0, 'rgba(255,59,92,0)'); g.addColorStop(1, `rgba(255,59,92,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else { ctx.globalAlpha = a * .5; ctx.fillStyle = f.col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  drawHUD();
  drawBanner();
  drawBossIntro();
  if (G.state === 'win' || G.state === 'lose') { UI = []; drawEnd(); }
}

function draw() {
  UI = [];
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (SCREEN === 'game' && G) drawGame();
  else if (SCREEN === 'howto') drawHowto();
  else if (SCREEN === 'lang') drawLang();
  else if (SCREEN === 'board') drawBoard();
  else if (SCREEN === 'shop') drawShop();
  else if (SCREEN === 'prep') drawPrep();
  else if (SCREEN === 'daily') drawDaily();
  else if (SCREEN === 'heroes') drawHeroes();
  else drawMap();
}

// ---------- input ----------
function toGame(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H };
}

cv.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  cv.focus({ preventScroll: true });
  Snd.init(); Snd.resume();
  const p = toGame(ev);
  // on the map, a press becomes either a tap (on release) or a scroll
  if (SCREEN === 'map' && p.y < MAP_VIEW) {
    mapDrag = { sy: p.y, y0: MAP.y, ly: p.y, lt: performance.now(), moved: false, p };
    MAP.v = 0;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    return;
  }
  if (hitUI(p)) return;
  if (SCREEN === 'game' && G && G.state === 'bossintro') { if (G.intro.t > .6) endBossIntro(); return; }
  if (SCREEN !== 'game' || !G || G.state !== 'aim') return;
  if (p.y > TOP && p.y < BOT) {
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    drag = { sx: p.x, sy: p.y, x: p.x, y: p.y };
  }
});
function hitUI(p) {
  for (let i = UI.length - 1; i >= 0; i--) {
    const b = UI[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { Snd.play('click'); b.cb(); return true; }
  }
  return false;
}
cv.addEventListener('pointermove', ev => {
  if (mapDrag) {
    const p = toGame(ev), dy = p.y - mapDrag.sy;
    if (!mapDrag.moved && Math.abs(dy) > 8) mapDrag.moved = true;
    if (mapDrag.moved) {
      const now = performance.now(), dts = Math.max(.008, (now - mapDrag.lt) / 1000);
      MAP.v = -(p.y - mapDrag.ly) / dts; mapDrag.ly = p.y; mapDrag.lt = now;
      let y = mapDrag.y0 - dy;
      if (y < 0) y *= .4; else if (y > MAP.maxY) y = MAP.maxY + (y - MAP.maxY) * .4;
      MAP.y = y;
    }
    return;
  }
  if (!drag) return;
  const p = toGame(ev);
  drag.x = p.x; drag.y = p.y;
});
cv.addEventListener('pointerup', () => {
  if (mapDrag) {
    const md = mapDrag;
    mapDrag = null;
    if (!md.moved) hitUI(md.p);
    else if (performance.now() - md.lt > 90) MAP.v = 0;
    return;
  }
  if (!drag) return;
  const dx = drag.sx - drag.x, dy = drag.sy - drag.y;
  drag = null;
  if (SCREEN === 'game' && G && G.state === 'aim' && Math.hypot(dx, dy) > 18) launch(dx, dy);
});
cv.addEventListener('pointercancel', () => { drag = null; mapDrag = null; });
cv.addEventListener('wheel', ev => {
  if (SCREEN !== 'map') return;
  ev.preventDefault();
  MAP.v = 0; MAP.y = Math.max(0, Math.min(MAP.maxY, MAP.y + ev.deltaY * .6));
}, { passive: false });
cv.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && SCREEN === 'game') goMap();
  if (SCREEN === 'howto' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); closeHowto(); }
  if (SCREEN === 'game' && G && (ev.key === 'z' || ev.key === 'я') && G.state === 'aim' && G.meter >= 100) G.zoomArmed = !G.zoomArmed;
});

// ---------- boot ----------
loadProg();
refreshInv();
setScreen(lsGet('pawsling-seen') || PROG.unlocked > 1 ? 'map' : 'howto');
loadDaily();
// #dev: timer-driven loop (keeps running in hidden tabs) plus a state hook for testing
const DEV = location.hash === '#dev';
const nextFrame = DEV ? cb => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame;
if (DEV) window.__pawsling = { get G() { return G; }, get SCREEN() { return SCREEN; }, startLevel, startEndless, launch, PROG: () => PROG, MAP, BOARD, setScreen, secondWind, setInv, get INV() { return INV; }, prepLevel, setupWave };
let last = performance.now();
// Slow devices: if frames keep taking longer than ~45 ms, drop the animated room lights.
let LOWFX = false, slowMs = 0, failed = false;
function frame(now) {
  const raw = now - last, dt = Math.min(.033, raw / 1000);
  last = now; T += dt;
  if (!LOWFX && !DEV) { slowMs = raw > 45 ? slowMs + raw : Math.max(0, slowMs - raw); if (slowMs > 1500) LOWFX = true; }
  try {
    update(dt);
    draw();
    if (!window.__pawslingOk) { window.__pawslingOk = true; const b = document.getElementById('boot'); if (b) b.remove(); }
  } catch (e) {
    if (!failed && window.__bootErr) { failed = true; window.__bootErr(e); }
  }
  nextFrame(frame);
}
nextFrame(frame);
})();
