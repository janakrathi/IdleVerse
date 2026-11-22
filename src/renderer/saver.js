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
    electric: () => ({ x: rand(0, W()), y: rand(0, H()), r: rand(0.6, 1.8), t: rand(0, 6), sp: rand(0.02, 0.06) })
  };
  const COUNT = { sad: 60, intense: 45, dreamy: 12, electric: 70, happy: 0, hype: 0 };

  function setMode(m) {
    mode = m;
    parts = Array.from({ length: COUNT[m] || 0 }, () => spawn[m]());
    if (m === 'sad' || m === 'dreamy') parts.forEach((p) => (p.y = rand(0, H())));
  }

  // Happy: a burst of confetti whenever a new line starts.
  function burst() {
    if (mode !== 'happy') return;
    const cols = [...colours, '#fff'];
    for (let i = 0; i < 36; i++) {
      const ang = rand(0, Math.PI * 2), sp = rand(4, 12);
      parts.push({ x: W() / 2 + rand(-W() * 0.2, W() * 0.2), y: H() * 0.45, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 5,
        w: rand(6, 12), h: rand(3, 7), rot: rand(0, 6), vr: rand(-0.2, 0.2), life: 1, c: cols[i % cols.length] });
    }
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
    } else if (mode === 'happy') {
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.vy += 0.35; p.vx *= 0.98; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.014;
        ctx.globalAlpha = Math.max(0, p.life) * 0.8; ctx.fillStyle = p.c;
        ctx.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot), Math.cos(p.rot), p.x, p.y);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
  return { setMode, burst, setColours };
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

// Words are animated whole (never split into letters) so scripts with joined or
// combining characters - Punjabi, Hindi, Arabic, Korean... - render correctly.
function buildLine(text) {
  return text.split(/\s+/).filter(Boolean).map((w, wi) => {
    const r = ((hash(w) % 30) - 15) + 'deg';
    const y = (((hash(w + wi) % 100) / 100) - 0.5) * 0.5 + 'em';      // dreamy: each word floats at its own height
    return `<span class="w" style="--r:${r};--y:${y};--i:${wi}">${esc(w)}</span>`;
  }).join(' ');
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
    const msg = lyrics.kind === 'instrumental' ? '♪ instrumental' : 'no lyrics found for this one';
    setCurrent('nolyrics', card(`<span class="note">${msg}</span>`));
    setText($('prev'), ''); setText($('next'), '');
    return;
  }

  const i = currentIndex(lines, t);
  setText($('prev'), i > 0 ? lines[i - 1].text : '');
  setText($('next'), lines[i + 1]?.text || '');

  if (i < 0) { setCurrent('intro', card()); return; }

  const line = lines[i];
  if (!line.text) {
    setCurrent(`rest${i}:${vibe}`, '<div class="rest"><span>♪</span><span>♫</span><span>♪</span></div>');
    return;
  }

  const el = setCurrent(`${i}:${vibe}`, buildLine(line.text));
  if (el) {
    if (i !== lastLineIdx) fx.burst();
    lastLineIdx = i;
    // Spread the words across the time this line is on screen (weighted by length).
    const nextT = lines[i + 1]?.t ?? line.t + 5000;
    const span = Math.min(nextT - line.t, Math.max(900, line.text.length * 75)) * 0.85;
    const els = [...el.querySelectorAll('.w')];
    const total = els.reduce((n, w) => n + w.textContent.length + 1, 0);
    let acc = 0;
    words = els.map((w) => {
      const at = line.t + (span * acc) / total;
      acc += w.textContent.length + 1;
      return { el: w, at, shown: false };
    });
  }

  let active = null;
  for (const w of words) {
    if (t < w.at) break;
    if (!w.shown) {
      w.shown = true;
      w.el.classList.add('on');
      if (vibe === 'intense') {                         // every word hits like a drum
        const cur = $('current');
        cur.classList.remove('shake'); void cur.offsetWidth; cur.classList.add('shake');
      }
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
