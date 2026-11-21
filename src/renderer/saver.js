const $ = (id) => document.getElementById(id);
const STYLES = ['bounce', 'neon', 'wave', 'typewriter', 'pop'];

let track = null, lyrics = null, settings = { style: 'mix', offsetMs: 0 };
let pos = { playing: false, positionMs: 0, at: Date.now() };
let shownKey = null;   // what is currently drawn in #current
let words = [];        // [{ el, at }] for the current line

const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const now = () => pos.positionMs + (pos.playing ? Date.now() - pos.at : 0) + (settings.offsetMs || 0);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- data from the main process ----------
window.saver.onTrack((d) => {
  track = d.track; lyrics = d.lyrics; settings = d.settings;
  shownKey = null;   // redraw with fresh data
  if (track) {
    document.documentElement.style.setProperty('--h', hash(track.title + track.artist) % 360);
    $('song').textContent = `${track.title} · ${track.artist}`;
  }
});
window.saver.onPosition((p) => { pos = p; document.body.classList.toggle('paused', !p.playing); });

// ---------- picking what to show ----------
function currentIndex(lines, t) {
  let i = -1;
  for (let k = 0; k < lines.length; k++) { if (lines[k].t <= t) i = k; else break; }
  return i;
}

function styleFor(i) {
  if (settings.style !== 'mix') return settings.style;
  return STYLES[hash(`${track?.title}#${i}`) % STYLES.length];
}

function setCurrent(key, html, cls = '') {
  if (key === shownKey) return null;
  shownKey = key;
  const box = $('current');
  [...box.children].forEach((old) => {
    old.classList.add('leaving');
    setTimeout(() => old.remove(), 460);
  });
  const el = document.createElement('div');
  el.className = `line ${cls}`;
  el.innerHTML = html;
  box.appendChild(el);
  words = [];
  return el;
}

function buildLine(text, style) {
  let charIndex = 0;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const letters = [...w].map((ch, j) => `<span class="c" style="--i:${charIndex++};--j:${j}">${esc(ch)}</span>`).join('');
    const r = ((hash(w) % 30) - 15) + 'deg';
    return `<span class="w" style="--r:${r}">${letters}</span>`;
  }).join(' ');
}

function render() {
  const t = now();
  const lines = lyrics?.lines || [];

  if (!track) {
    setCurrent('idle', '<span class="pulse">♪ play something in Spotify or Apple Music ♪</span>');
    $('prev').textContent = $('next').textContent = '';
    return;
  }

  const title = `<b>${esc(track.title)}</b><small>${esc(track.artist)}</small>`;
  if (!lyrics || lyrics.kind === 'loading') {
    setCurrent('loading', `<div class="intro">${title}<span class="note pulse">finding lyrics…</span></div>`);
    return;
  }
  if (lyrics.kind === 'none' || lyrics.kind === 'instrumental' || !lines.length) {
    const msg = lyrics.kind === 'instrumental' ? '♪ instrumental — just vibe ♪' : 'no lyrics found for this one';
    setCurrent('nolyrics', `<div class="intro">${title}<span class="note">${msg}</span></div>
      <div class="rest" style="justify-content:center;margin-top:.4em"><span>♪</span><span>♫</span><span>♪</span></div>`);
    return;
  }

  const i = currentIndex(lines, t);
  $('prev').textContent = i > 0 ? lines[i - 1].text : '';
  $('next').textContent = lines[i + 1]?.text || '';

  if (i < 0) { setCurrent('intro', `<div class="intro">${title}</div>`); return; }

  const line = lines[i];
  if (!line.text) {
    setCurrent(`rest${i}`, '<div class="rest"><span>♪</span><span>♫</span><span>♪</span></div>');
    return;
  }

  const style = styleFor(i);
  const el = setCurrent(`${i}:${style}`, buildLine(line.text, style), style);
  if (el) {
    // Spread the words across the time this line is on screen (weighted by length).
    const nextT = lines[i + 1]?.t ?? line.t + 5000;
    const span = Math.min(nextT - line.t, Math.max(900, line.text.length * 75)) * 0.85;
    const els = [...el.querySelectorAll('.w')];
    const total = els.reduce((n, w) => n + w.textContent.length + 1, 0);
    let acc = 0;
    words = els.map((w) => {
      const at = line.t + (span * acc) / total;
      acc += w.textContent.length + 1;
      return { el: w, at };
    });
  }

  let active = null;
  for (const w of words) {
    if (t >= w.at) { w.el.classList.add('on'); active = w.el; }
  }
  words.forEach((w) => w.el.classList.toggle('active', w.el === active));
}

function tick() {
  try { render(); } catch (e) { console.error(e); }
  if (track?.durationMs) $('bar').firstElementChild.style.width = `${Math.min(100, (now() / track.durationMs) * 100)}%`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Nudge everything a few pixels every so often so nothing burns into the screen.
setInterval(() => {
  const x = (Math.random() - 0.5) * 50, y = (Math.random() - 0.5) * 40;
  $('stage').style.transform = `translate(${x}px, ${y}px)`;
}, 30000);

// ---------- controls: any activity closes, a few keys tweak ----------
let armedAt = Date.now() + 1500, origin = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1400);
}
function dismiss() { if (Date.now() > armedAt) window.saver.dismiss(); }

window.addEventListener('mousemove', (e) => {
  if (!origin) { origin = [e.screenX, e.screenY]; return; }
  if (Math.hypot(e.screenX - origin[0], e.screenY - origin[1]) > 12) dismiss();
});
window.addEventListener('mousedown', dismiss);
window.addEventListener('wheel', dismiss);
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    settings.offsetMs = (settings.offsetMs || 0) + (e.key === 'ArrowRight' ? 250 : -250);
    window.saver.set({ offsetMs: settings.offsetMs });
    toast(`lyrics timing ${settings.offsetMs >= 0 ? '+' : ''}${(settings.offsetMs / 1000).toFixed(2)}s`);
    shownKey = null;
    return;
  }
  if (e.key.toLowerCase() === 's') {
    const all = ['mix', ...STYLES];
    settings.style = all[(all.indexOf(settings.style) + 1) % all.length];
    window.saver.set({ style: settings.style });
    toast(`style: ${settings.style}`);
    shownKey = null;
    return;
  }
  dismiss();
});
