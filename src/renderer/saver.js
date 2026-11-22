const $ = (id) => document.getElementById(id);
const VIBES = ['sad', 'happy', 'intense', 'hype', 'dreamy', 'electric'];

let track = null, lyrics = null, art = null, detected = null;
let settings = { vibe: 'auto', offsetMs: 0 };
let vibe = 'dreamy';
let shownKey = null;   // what is currently drawn in #current
let words = [];        // [{ el, at, shown }] for the current line
let activeEl = null;
let lastLineIdx = -1;

const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// =================== smooth song clock ===================
// The music app reports its position about once a second. Instead of jumping to every report
// (which makes words stutter), run our own clock and only correct it when it drifts noticeably.
let clock = { pos: 0, at: performance.now(), playing: false };
const rawNow = () => clock.pos + (clock.playing ? performance.now() - clock.at : 0);
const now = () => rawNow() + (settings.offsetMs || 0);
function syncClock(p) {
  const reported = p.positionMs + (p.playing ? Date.now() - p.at : 0);
  const drift = reported - rawNow();
  if (p.playing !== clock.playing || Math.abs(drift) > 400) {
    clock = { pos: reported, at: performance.now(), playing: p.playing };     // seek / pause / skip
  } else if (Math.abs(drift) > 60) {
    clock.pos += drift * 0.25;                                                // ease small drift away
  }
}

// =================== colours from the album art ===================
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Picks the cover's 3 most important colours (by how much of the cover they fill and how
// colourful they are). Returns [[h, s, l], ...] or null for a pure black-and-white cover.
function extractPalette(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 40, 40);
  const data = ctx.getImageData(0, 0, 40, 40).data;
  const bins = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.07 || l > 0.96 || s < 0.08) continue;
    const w = (0.25 + s) * (1 - Math.abs(l - 0.5));
    const b = bins[Math.floor(h / 15) % 24];
    b.w += w; b.h += h * w; b.s += s * w; b.l += l * w;
  }
  const picks = [];
  bins.filter((b) => b.w > 1.5).sort((a, b) => b.w - a.w).forEach((b) => {
    const hsl = [b.h / b.w, b.s / b.w, b.l / b.w];
    const far = picks.every((p) => Math.min(Math.abs(p[0] - hsl[0]), 360 - Math.abs(p[0] - hsl[0])) > 28);
    if (far && picks.length < 3) picks.push(hsl);
  });
  if (!picks.length) return null;
  // Single-colour cover: use shades of that colour, not unrelated hues.
  while (picks.length < 3) picks.push([(picks[0][0] + (picks.length === 1 ? 18 : -18) + 360) % 360, picks[0][1], picks[0][2]]);
  return picks;
}

// Each vibe bends the album colours a little: sad = softer, intense = punchier...
const TONE = {
  sad:      { s: (s) => s * 0.6, l: 0.74 },
  happy:    { s: (s) => Math.max(s, 0.7), l: 0.68 },
  intense:  { s: (s) => Math.max(s, 0.75), l: 0.6 },
  hype:     { s: (s) => Math.max(s, 0.75), l: 0.64 },
  dreamy:   { s: (s) => s * 0.9, l: 0.76 },
  electric: { s: (s) => Math.max(s, 0.85), l: 0.66 }
};
let basePalette = null;
function applyColours() {
  const t = TONE[vibe];
  const root = document.documentElement.style;
  const colours = [];
  const pal = basePalette || [[0, 0, 0.7], [0, 0, 0.6], [0, 0, 0.5]];      // no cover: neutral greys
  pal.forEach(([h, s], i) => {
    const sat = Math.round(Math.min(1, t.s(s)) * 100);
    const H = Math.round(h);
    root.setProperty(`--c${i + 1}`, `hsl(${H} ${sat}% ${Math.round(t.l * 100)}%)`);                 // text accents
    root.setProperty(`--b${i + 1}`, `hsl(${H} ${Math.max(sat - 10, 0)}% 34%)`);                       // glows
    root.setProperty(`--g${i + 1}`, `hsl(${H} ${Math.min(100, sat + 10)}% ${vibe === 'sad' ? 30 : 42}%)`); // backlight orbs
    colours.push(`hsl(${H} ${sat}% ${Math.round(t.l * 100)}%)`);
  });
  fx.setColours(colours);
  frame.setColour(colours[0]);
}

// The cover is blurred ONCE into a tiny canvas; scaling that up gives a soft backlight
// for free, instead of a live CSS blur that has to be recomputed every frame.
function blurredCover(img) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 54;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(7px) saturate(1.35)';
  ctx.drawImage(img, -20, -20, 136, 94);
  return c.toDataURL('image/jpeg', 0.9);
}

function setArt(dataUrl) {
  if (dataUrl === art) return;
  art = dataUrl;
  const bg = $('artbg'), cover = $('cover');
  if (!art) {
    bg.classList.remove('on'); cover.classList.remove('on'); basePalette = null; applyColours();
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (art !== dataUrl) return;                              // a newer cover arrived meanwhile
    try { basePalette = extractPalette(img); } catch { basePalette = null; }
    applyColours();
    bg.style.backgroundImage = `url(${blurredCover(img)})`;
    bg.classList.add('on');
    cover.src = art; cover.classList.add('on');
    if (shownKey && /^(intro|loading|nolyrics)/.test(shownKey)) shownKey = null;  // redraw the title card with the cover
  };
  img.src = art;
}

// =================== vibe (decided in the background, never shown as text) ===================
let appliedVibe = null;
function setVibe(v) {
  if (!VIBES.includes(v)) v = 'dreamy';
  if (v === appliedVibe) return;
  vibe = appliedVibe = v;
  document.body.className = document.body.className.replace(/vibe-\w+/g, '').trim() + ` vibe-${v}`;
  fx.setMode(v);
  applyColours();
  shownKey = null;
}
const updateVibe = () => setVibe(settings.vibe !== 'auto' ? settings.vibe : (detected?.vibe || 'dreamy'));

// =================== background particles per vibe ===================
const fx = (() => {
  const canvas = $('fx'), ctx = canvas.getContext('2d');
  let mode = null, parts = [], last = 0, drewLast = false;
  let colours = ['#ccc', '#aaa', '#888'], sprites = [];
  const W = () => canvas.width, H = () => canvas.height;
  const rand = (a, b) => a + Math.random() * (b - a);
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener('resize', resize); resize();

  // Pre-drawn soft orbs (drawing a gradient per orb per frame is slow).
  function makeSprites() {
    sprites = colours.map((col) => {
      const s = document.createElement('canvas');
      s.width = s.height = 128;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      return s;
    });
  }
  function setColours(c) { colours = c; makeSprites(); }

  const spawn = {
    sad: () => ({ x: rand(0, W()), y: rand(-H(), 0), len: rand(30, 90), v: rand(5, 10), a: rand(0.05, 0.14) }),
    intense: () => ({ x: rand(0, W()), y: H() + rand(0, 200), r: rand(1, 3), v: rand(1, 3), drift: rand(-0.6, 0.6), a: rand(0.2, 0.7), t: rand(0, 6) }),
    dreamy: () => ({ x: rand(0, W()), y: H() + rand(0, H()), r: rand(30, 100), v: rand(0.15, 0.5), a: rand(0.08, 0.18), c: Math.floor(rand(0, 3)) }),
    electric: () => ({ x: rand(0, W()), y: rand(0, H()), r: rand(0.6, 1.8), t: rand(0, 6), sp: rand(0.02, 0.06) }),
    // Motion-graphics shape layer: thin rings, plus signs and short dashes drifting slowly.
    shapes: () => ({ x: rand(0, W()), y: H() + rand(0, H() * 0.5), s: rand(6, 22), v: rand(0.25, 0.8), rot: rand(0, 6), vr: rand(-0.01, 0.01),
      kind: Math.floor(rand(0, 3)), c: Math.floor(rand(0, 3)), a: rand(0.12, 0.35) })
  };
  const MODE = { sad: 'sad', intense: 'intense', dreamy: 'dreamy', electric: 'electric', happy: 'shapes', hype: 'shapes' };
  const COUNT = { sad: 60, intense: 45, dreamy: 12, electric: 70, shapes: 18 };

  function setMode(m) {
    mode = MODE[m];
    parts = Array.from({ length: COUNT[mode] || 0 }, () => spawn[mode]());
    if (mode !== 'intense') parts.forEach((p) => (p.y = rand(0, H())));
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < 33) return;      // ~30fps is plenty for drifting particles and saves power
    last = t;
    const idle = !parts.length || document.body.classList.contains('paused');
    if (idle) { if (drewLast) { ctx.clearRect(0, 0, W(), H()); drewLast = false; } return; }
    ctx.clearRect(0, 0, W(), H());
    drewLast = true;
    if (mode === 'sad') {
      ctx.strokeStyle = colours[2]; ctx.lineWidth = 1;
      for (const p of parts) {
        p.y += p.v; if (p.y > H()) Object.assign(p, spawn.sad(), { y: -p.len });
        ctx.globalAlpha = p.a; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.08, p.y + p.len); ctx.stroke();
      }
    } else if (mode === 'intense') {
      ctx.fillStyle = colours[0];
      for (const p of parts) {
        p.y -= p.v; p.x += p.drift + Math.sin((p.t += 0.05)) * 0.4;
        if (p.y < -20) Object.assign(p, spawn.intense());
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.t * 3)); ctx.fillRect(p.x, p.y, p.r * 1.6, p.r * 1.6);
      }
    } else if (mode === 'dreamy') {
      for (const p of parts) {
        p.y -= p.v; if (p.y < -p.r * 2) Object.assign(p, spawn.dreamy());
        ctx.globalAlpha = p.a; ctx.drawImage(sprites[p.c], p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    } else if (mode === 'electric') {
      ctx.fillStyle = '#fff';
      for (const p of parts) {
        p.t += p.sp; ctx.globalAlpha = Math.max(0, Math.sin(p.t)) * 0.5;
        ctx.fillRect(p.x, p.y, p.r * 1.5, p.r * 1.5);
      }
    } else if (mode === 'shapes') {
      ctx.lineWidth = 1.5;
      for (const p of parts) {
        p.y -= p.v; p.rot += p.vr;
        if (p.y < -40) Object.assign(p, spawn.shapes());
        ctx.globalAlpha = p.a; ctx.strokeStyle = colours[p.c];
        ctx.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot), Math.cos(p.rot), p.x, p.y);
        ctx.beginPath();
        if (p.kind === 0) ctx.arc(0, 0, p.s, 0, 7);                                            // ring
        else if (p.kind === 1) { ctx.moveTo(-p.s / 2, 0); ctx.lineTo(p.s / 2, 0); ctx.moveTo(0, -p.s / 2); ctx.lineTo(0, p.s / 2); } // plus
        else { ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); }                                     // dash
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
  return { setMode, setColours };
})();

// =================== shiny frame ===================
// One thick glowing beam running round the very edge of the screen, bending round each
// corner as it turns. Its speed follows the song: quicker when the words come fast, a
// surge on every word (bigger on the key word), a slow glide in breaks, and still when paused.
const frame = (() => {
  const canvas = $('frame'), ctx = canvas.getContext('2d');
  // Laps of the screen per second at a normal pace, per vibe.
  const BASE = { sad: 0.016, dreamy: 0.022, happy: 0.042, hype: 0.048, electric: 0.056, intense: 0.062 };
  let w = 0, h = 0, colour = 'hsl(0 0% 70%)';
  let pos = Math.random(), speed = 0, rate = 0.8, rateTarget = 0.8, energy = 0;
  let last = performance.now(), settled = false;

  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    settled = false;
  }
  addEventListener('resize', resize); resize();

  function setColour(c) { colour = c; settled = false; }

  const kick = (a) => { energy = Math.min(1.6, energy + a); };
  const setFlow = (wordsPerSec) => { rateTarget = Math.max(0.2, Math.min(5, wordsPerSec)); };

  function draw(t) {
    requestAnimationFrame(draw);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const paused = document.body.classList.contains('paused');
    rate += (rateTarget - rate) * Math.min(1, dt * 1.2);
    energy *= Math.exp(-dt * 2.4);
    const want = paused ? 0 : (BASE[vibe] || 0.03) * (0.35 + rate * 0.45) * (1 + energy * 1.5);
    speed += (want - speed) * Math.min(1, dt * 3);
    pos = (pos + speed * dt) % 1;
    if (paused && speed < 1e-4 && energy < 0.01) { if (settled) return; settled = true; } else settled = false;

    const m = 5;                                  // the beam's core sits flush with the screen edge
    const W = w - 2 * m, H = h - 2 * m, P = 2 * (W + H);
    const corners = [[m, m, 0], [m + W, m, W], [m + W, m + H, W + H], [m, m + H, 2 * W + H]];
    const pt = (s) => {
      s = ((s % P) + P) % P;
      if (s < W) return [m + s, m];
      if (s < W + H) return [m + W, m + s - W];
      if (s < 2 * W + H) return [m + W - (s - W - H), m + H];
      return [m, m + H - (s - 2 * W - H)];
    };
    const seg = (a, b) => {                       // path from a to b along the frame, turning corners
      ctx.moveTo(...pt(a));
      for (const [x, y, cs] of corners) {
        for (const k of [cs, cs + P, cs - P]) if (k > a && k < b) ctx.lineTo(x, y);
      }
      ctx.lineTo(...pt(b));
    };

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.08; ctx.lineWidth = 1;
    ctx.strokeRect(m, m, W, H);

    // One thick, glowing beam travelling clockwise; it wraps round the corners as it goes.
    const bright = 0.8 + Math.min(0.2, energy * 0.25);
    const head = pos * P;
    const tail = P * (0.2 + 0.06 * Math.min(1, energy));
    const N = Math.min(140, Math.max(40, Math.round(tail / 7)));   // ~7px steps so the fade is smooth
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';      // segments butt together without bright beads
    // Stacked strokes, widest and faintest first, give a soft glow that fades in from the edge.
    // The wide faint layers are drawn in coarser steps; nobody can see banding that faint.
    const pass = (n, layers) => {
      for (let j = 0; j < n; j++) {
        const a = head - (tail * (j + 1)) / n, b = head - (tail * j) / n;
        const fade = Math.pow(1 - j / n, 1.4) * bright;
        ctx.beginPath(); seg(a, b);
        for (const [lw, alpha, col] of layers) {
          ctx.strokeStyle = col; ctx.globalAlpha = fade * alpha; ctx.lineWidth = lw; ctx.stroke();
        }
      }
    };
    pass(Math.ceil(N / 2), [[96, 0.035, colour], [74, 0.045, colour], [56, 0.065, colour], [40, 0.09, colour]]);
    pass(N, [[28, 0.16, colour], [18, 0.3, colour], [9, 1, '#fff']]);                // glow + hot white core
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(draw);
  return { setColour, kick, setFlow };
})();

// =================== data from the main process ===================
window.saver.onTrack((d) => {
  const sameSong = track && d.track && track.title === d.track.title && track.artist === d.track.artist;
  const lyricsChanged = d.lyrics?.kind !== lyrics?.kind || d.lyrics?.lines?.length !== lyrics?.lines?.length;
  track = d.track; lyrics = d.lyrics; settings = d.settings; detected = d.vibe;
  setArt(d.art);
  updateVibe();
  if (!sameSong || lyricsChanged) shownKey = null;          // don't restart the current line for nothing
  setText($('song'), track ? `${track.title} · ${track.artist}` : '');
});
window.saver.onPosition((p) => { syncClock(p); document.body.classList.toggle('paused', !p.playing); });
window.saver.onMode((m) => {
  if (m.snap) armedAt = Infinity;                         // screenshots: never close
  if (m.showControls) { document.body.classList.add('ui'); keepUi = true; }
});

// =================== drawing the lyrics ===================
// Only touch the page when something actually changed; rewriting text 60 times a second
// forces the browser to re-layout every frame and is the main cause of stutter.
function setText(el, text) { if (el._t !== text) { el._t = text; el.textContent = text; } }

function currentIndex(lines, t) {
  let i = -1;
  for (let k = 0; k < lines.length; k++) { if (lines[k].t <= t) i = k; else break; }
  return i;
}

function setCurrent(key, html) {
  if (key === shownKey) return null;
  shownKey = key;
  const box = $('current');
  [...box.children].forEach((old) => {
    if (old.classList.contains('leaving')) return;
    old.classList.add('leaving');
    setTimeout(() => old.remove(), 2000);
  });
  const el = document.createElement('div');
  el.className = 'line';
  el.innerHTML = html;
  box.appendChild(el);
  words = []; activeEl = null;
  return el;
}

// =================== kinetic typography ===================
// Each lyric line becomes a little poster: the key word huge, filler words small and spaced
// out, rows sized to line up, an animated accent shape, a picture if a word has one, and a
// slow "camera" push. Words stay whole (never split into letters) so every script renders.

const SMALL = new Set((
  "a an the to of in on at and or but i i'm im you you're me my your yours is are am be been it it's its so for " +
  "with we our us that this these those just all do did don't dont can can't cant won't will would was were not no " +
  "yeah oh ooh uh na la like got get gonna wanna when what if then from up out by as has have had he she they them " +
  "her his him there here who how why where too " +
  "के का की को है हैं में से भी ना तो ही ये वो मैं तू तेरा तेरी मेरा मेरी " +
  "ਦੇ ਦਾ ਦੀ ਨੂੰ ਤੇ ਵੀ ਆ ਨੇ ਹੈ ਨਾ ਤਾਂ ਹੀ ਮੈਂ ਤੂੰ ਤੇਰਾ ਤੇਰੀ ਮੇਰਾ ਮੇਰੀ ਓ"
).split(' '));
const norm = (w) => w.toLowerCase().replace(/^[^\p{L}\p{M}']+|[^\p{L}\p{M}']+$/gu, '').replace(/’/g, "'");

// How each vibe moves and decorates. Motions: rise/drop come out of a mask, slide in from a
// side, pop scales, wipe reveals left to right, blur comes into focus.
const STYLE = {
  sad:      { motions: ['blur', 'rise'],             decos: ['underline', 'echo'],            align: ['center'],                 tilt: 0, picDraw: 2.2 },
  happy:    { motions: ['pop', 'rise', 'slideL'],    decos: ['circle', 'underline', 'echo'],  align: ['left', 'center', 'right'], tilt: 3, picDraw: 1.0 },
  intense:  { motions: ['drop', 'wipe', 'rise'],     decos: ['bar', 'brackets'],              align: ['left', 'center', 'right'], tilt: 2, picDraw: 0.5 },
  hype:     { motions: ['slideL', 'rise', 'wipe'],   decos: ['box'],                          align: ['left'],                   tilt: 4, picDraw: 0.6 },
  dreamy:   { motions: ['rise', 'blur'],             decos: ['circle', 'echo'],               align: ['center', 'left', 'right'], tilt: 1, picDraw: 1.8 },
  electric: { motions: ['wipe', 'slideR', 'drop'],   decos: ['brackets', 'underline'],        align: ['left', 'center', 'right'], tilt: 2, picDraw: 0.8 }
};

function iconSvg(name) {
  const inner = (window.ICONS?.[name] || '').replace(/<(path|circle|line|rect|polyline|polygon|ellipse)\b/g, '<$1 pathLength="1"');
  return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Groups words into poster rows. Returns { html, pic } where pic = { index } or null.
function compose(line, idx, lifeMs) {
  const words = line.text.split(/\s+/).filter(Boolean);
  const style = STYLE[vibe];
  const pic = window.PICTURES?.match(words) || null;
  const roles = words.map((w) => (SMALL.has(norm(w)) ? 'small' : 'mid'));

  // The hero: the word with a picture, otherwise the longest meaningful word.
  let hero = pic && roles[pic.index] !== 'small' ? pic.index : -1;
  if (hero < 0) words.forEach((w, k) => { if (roles[k] !== 'small' && (hero < 0 || norm(w).length > norm(words[hero]).length)) hero = k; });
  if (hero >= 0) roles[hero] = 'hero';

  let rows = [], cur = [];
  const flush = () => { if (cur.length) rows.push(cur); cur = []; };
  words.forEach((w, k) => {
    if (roles[k] === 'hero') { flush(); rows.push([k]); return; }
    if (cur.length && (roles[cur[0]] === 'small') !== (roles[k] === 'small') && cur.length >= 2) flush();
    cur.push(k);
    const chars = cur.reduce((n, j) => n + words[j].length + 1, 0);
    if (cur.length >= 4 || chars >= 18) flush();
  });
  flush();
  while (rows.length > 5) {                                   // long lines: merge the two shortest neighbours
    let best = 0, bestLen = Infinity;
    for (let r = 0; r < rows.length - 1; r++) {
      if (rows[r].includes(hero) || rows[r + 1].includes(hero)) continue;
      const len = rows[r].length + rows[r + 1].length;
      if (len < bestLen) { bestLen = len; best = r; }
    }
    if (bestLen === Infinity) break;
    rows.splice(best, 2, rows[best].concat(rows[best + 1]));
  }

  const seed = hash(`${line.text}#${idx}`);
  const pick = (arr, salt = 0) => arr[(seed >> salt) % arr.length];
  const align = pick(style.align, 1);
  const deco = pick(style.decos, 3);
  const tilt = style.tilt ? ((seed % 2 ? 1 : -1) * (0.4 + (seed % 7) / 7) * style.tilt).toFixed(2) : 0;

  const rowHtml = rows.map((r, ri) => {
    const role = r.includes(hero) ? 'hero' : r.every((k) => roles[k] === 'small') ? 'small' : 'mid';
    const motion = role === 'hero' ? style.motions[0] : pick(style.motions, ri + 2);
    const ws = r.map((k) => `<span class="w">${esc(words[k])}</span>`).join(' ');
    const extra = role === 'hero'
      ? `<i class="deco"></i>${deco === 'echo' ? `<span class="echo" aria-hidden="true">${esc(words[hero])}</span>` : ''}` +
        (deco === 'circle' ? '<svg class="ring" viewBox="0 0 100 40" preserveAspectRatio="none"><ellipse pathLength="1" cx="50" cy="20" rx="48" ry="17"/></svg>' : '')
      : '';
    return `<div class="row r-${role} m-${motion}">${extra}<span class="txt">${ws}</span></div>`;
  }).join('');

  const picHtml = pic ? `<div class="pic"><i class="halo"></i>${iconSvg(pic.icon)}</div>` : '';
  const html =
    `<div class="comp a-${align} d-${deco}${pic ? ' has-pic' : ''}" style="--tilt:${tilt}deg;--life:${Math.round(lifeMs)}ms;--draw:${style.picDraw}s">` +
      `<div class="block">${rowHtml}` +
      (deco === 'brackets' ? '<i class="br tl"></i><i class="br tr"></i><i class="br bl"></i><i class="br br2"></i>' : '') +
      `</div>${picHtml}</div>`;
  return { html, pic, hero };
}

// Sizes each row so the block reads like a poster: rows stretch toward a common width,
// within limits per role (the hero can get huge, filler words stay small).
function layoutComposition(el) {
  const comp = el.querySelector('.comp');
  if (!comp) return;
  const vh = innerHeight / 100, vw = innerWidth / 100;
  const hasPic = comp.classList.contains('has-pic');
  const target = (hasPic ? 50 : 66) * vw;
  const LIMITS = { hero: [6 * vh, 21 * vh], mid: [3.6 * vh, 10 * vh], small: [2.2 * vh, 4.6 * vh] };
  const rows = [...comp.querySelectorAll('.row')];
  const sizes = rows.map((row) => {
    const txt = row.querySelector('.txt');
    row.style.fontSize = '100px';
    const w = txt.getBoundingClientRect().width || 1;
    const role = row.classList.contains('r-hero') ? 'hero' : row.classList.contains('r-small') ? 'small' : 'mid';
    const [lo, hi] = LIMITS[role];
    return Math.max(lo, Math.min(hi, (100 * target) / w));
  });
  // Keep the whole block within ~62% of the screen height.
  const total = sizes.reduce((n, s) => n + s * 1.02, 0);
  const k = Math.min(1, (62 * vh) / total);
  rows.forEach((row, i) => { row.style.fontSize = `${(sizes[i] * k).toFixed(1)}px`; });
}

function card(note = '') {
  const cover = art ? `<img src="${art}" alt="">` : '';
  return `<div class="card">${cover}<div class="t"><b>${esc(track.title)}</b><small>${esc(track.artist)}${track.album ? ' — ' + esc(track.album) : ''}</small>${note}</div></div>`;
}

function render() {
  const t = now();
  const lines = lyrics?.lines || [];

  if (!track) {
    setCurrent('idle', '<span class="pulse" style="font-size:.5em;font-weight:600">♪ play something in Spotify or Apple Music ♪</span>');
    setText($('prev'), ''); setText($('next'), '');
    return;
  }
  if (!lyrics || lyrics.kind === 'loading') {
    setCurrent('loading', card('<span class="note pulse">finding lyrics…</span>'));
    return;
  }
  if (lyrics.kind === 'none' || lyrics.kind === 'instrumental' || !lines.length) {
    const msg = lyrics.kind === 'instrumental' ? '♪ instrumental'
      : lyrics.kind === 'off' ? 'online lyrics are turned off (tray menu → Privacy)'
      : 'no lyrics found for this one';
    setCurrent(`nolyrics:${lyrics.kind}`, card(`<span class="note">${msg}</span>`));
    setText($('prev'), ''); setText($('next'), '');
    return;
  }

  const i = currentIndex(lines, t);
  setText($('prev'), i > 0 ? lines[i - 1].text : '');
  setText($('next'), lines[i + 1]?.text || '');

  if (i < 0) { setCurrent('intro', card()); return; }

  const line = lines[i];
  if (!line.text) {                                     // instrumental break: a small equaliser
    frame.setFlow(0.4);
    setCurrent(`rest${i}:${vibe}`, '<div class="eq"><i></i><i></i><i></i><i></i><i></i></div>');
    return;
  }

  const nextT = lines[i + 1]?.t ?? line.t + 5000;
  if (shownKey !== `${i}:${vibe}`) {
    const { html, pic, hero } = compose(line, i, nextT - line.t);
    const el = setCurrent(`${i}:${vibe}`, html);
    layoutComposition(el);
    lastLineIdx = i;
    frame.setFlow(line.text.split(/\s+/).length / Math.max(0.8, (nextT - line.t) / 1000));   // words per second
    // Spread the words across the time this line is on screen (weighted by length).
    const span = Math.min(nextT - line.t, Math.max(900, line.text.length * 75)) * 0.85;
    const els = [...el.querySelectorAll('.w')];
    const total = els.reduce((n, w) => n + w.textContent.length + 1, 0);
    let acc = 0;
    words = els.map((w, k) => {
      const at = line.t + (span * acc) / total;
      acc += w.textContent.length + 1;
      return {
        el: w, at, shown: false,
        hero: k === hero ? w.closest('.row') : null,          // light up the accent shape
        pic: pic && k === pic.index ? el.querySelector('.pic') : null   // draw the picture
      };
    });
  }

  let active = null;
  for (const w of words) {
    if (t < w.at) break;
    if (!w.shown) {
      w.shown = true;
      w.el.classList.add('on');
      if (w.hero) {
        w.hero.classList.add('lit');
        if (vibe === 'intense') {                       // the key word hits like a drum
          const cur = $('current');
          cur.classList.remove('shake'); void cur.offsetWidth; cur.classList.add('shake');
        }
      }
      w.pic?.classList.add('on');
      frame.kick(w.hero ? 0.9 : 0.3);
    }
    active = w.el;
  }
  if (active !== activeEl) {
    activeEl?.classList.remove('active');
    active?.classList.add('active');
    activeEl = active;
  }
}

function tick() {
  try { render(); } catch (e) { console.error(e); }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Progress bar: a few updates a second is plenty (it glides between them via CSS).
setInterval(() => {
  const f = track?.durationMs ? Math.max(0, Math.min(1, now() / track.durationMs)) : 0;
  $('bar').firstElementChild.style.transform = `scaleX(${f.toFixed(4)})`;
}, 500);

// Nudge everything a few pixels every so often so nothing burns into the screen.
setInterval(() => {
  const x = (Math.random() - 0.5) * 50, y = (Math.random() - 0.5) * 40;
  $('stage').style.transform = `translate3d(${x}px, ${y}px, 0)`;
}, 30000);

// =================== controls ===================
// Moving the mouse shows the playback bar; clicking empty space, Esc or "Exit" closes.
let armedAt = Date.now() + 1200, keepUi = false, uiTimer = null, origin = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1200);
}
function dismiss() { if (Date.now() > armedAt) window.saver.dismiss(); }
function showUi() {
  document.body.classList.add('ui');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    if (!keepUi && !$('controls').matches(':hover') && !$('exit').matches(':hover')) document.body.classList.remove('ui');
    else showUi();
  }, 2800);
}
function control(action) {
  window.saver.control(action);
  if (action === 'toggle') document.body.classList.toggle('paused');     // instant feedback
  showUi();
}

window.addEventListener('mousemove', (e) => {
  if (!origin) { origin = [e.screenX, e.screenY]; return; }
  if (Math.hypot(e.screenX - origin[0], e.screenY - origin[1]) > 8) {
    origin = [e.screenX, e.screenY];
    if (!document.body.classList.contains('ui')) showUi();
    else if (!showUi.pending) { showUi.pending = true; setTimeout(() => { showUi.pending = false; showUi(); }, 250); }
  }
});
$('btn-prev').addEventListener('click', (e) => { e.stopPropagation(); control('prev'); });
$('btn-toggle').addEventListener('click', (e) => { e.stopPropagation(); control('toggle'); });
$('btn-next').addEventListener('click', (e) => { e.stopPropagation(); control('next'); });
$('exit').addEventListener('click', (e) => { e.stopPropagation(); armedAt = 0; dismiss(); });
$('controls').addEventListener('mousedown', (e) => e.stopPropagation());
window.addEventListener('mousedown', (e) => {
  if (e.target.closest('#controls, #exit')) return;
  if (document.body.classList.contains('ui')) dismiss(); else showUi();
});

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === ' ' || k === 'MediaPlayPause') { e.preventDefault(); control('toggle'); return; }
  if (k === 'ArrowRight' || k === 'MediaTrackNext') { control('next'); return; }
  if (k === 'ArrowLeft' || k === 'MediaTrackPrevious') { control('prev'); return; }
  if (k === '[' || k === ']') {
    settings.offsetMs = (settings.offsetMs || 0) + (k === ']' ? 250 : -250);
    window.saver.set({ offsetMs: settings.offsetMs });
    toast(`lyrics timing ${settings.offsetMs >= 0 ? '+' : ''}${(settings.offsetMs / 1000).toFixed(2)}s`);
    shownKey = null;
    return;
  }
  if (k.toLowerCase() === 'v') {                         // try the next design (no label shown)
    const all = ['auto', ...VIBES];
    settings.vibe = all[(all.indexOf(settings.vibe) + 1) % all.length];
    window.saver.set({ vibe: settings.vibe });
    updateVibe();
    return;
  }
  if (k === 'Escape') { armedAt = 0; dismiss(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(k)) return;
  dismiss();
});

setVibe('dreamy');
