const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, powerSaveBlocker, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { NowPlaying } = require('./detectors');
const { fetchLyrics } = require('./lyrics');
const { getMeta, readArtFile, fetchArt } = require('./meta');
const { detectVibe } = require('./vibe');
const { DEMO_TRACK, DEMO_LYRICS } = require('./demo');

const SNAP = process.argv.find((a) => a.startsWith('--snap='));   // dev: screenshot mode
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
if (!SNAP && !app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'darwin') app.dock?.hide(); // lives in the menu bar

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  idleSeconds: 60,        // start the screensaver after this much idle time while music plays (0 = never)
  vibe: 'auto',           // auto | sad | happy | intense | hype | dreamy | electric
  keepAwake: true,        // stop the display sleeping while lyrics are on screen
  stopAfterPauseMin: 2,   // music paused this long -> close and let the screen sleep normally
  onlyMusicApps: true,    // ignore YouTube tabs etc.
  offsetMs: 0
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
delete settings.style;    // replaced by "vibe" in 1.1
const save = () => { if (SNAP) return; try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} };

// ---------- state ----------
let tray, win, detector, blockerId = null;
let track = null;             // current track info from the detector
// song: { key, lyrics, genre, vibe, appArt (cover from the music app), itunesArt (fallback), artSrc }
let song = null;
let pausedSince = null;
let demo = null;              // { started, pausedAt } while the built-in demo song is playing

const keyOf = (t) => (t ? `${t.artist}|${t.title}` : '');

function sendTrack() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('track', {
    track, settings,
    lyrics: song?.lyrics || null,
    art: song?.appArt || song?.itunesArt || null,
    genre: song?.genre || null,
    vibe: song?.vibe || null
  });
}

// The music app's own cover. Re-read whenever it changes: apps often update the picture
// a moment after the title, so the first one we see can still be the previous song's.
function updateAppArt(t) {
  const src = t.artPath || t.artUrl || '';
  if (!song || src === song.artSrc) return;
  song.artSrc = src;
  const key = song.key;
  if (!src) return;
  if (t.artPath) {
    song.appArt = readArtFile(t.artPath);
    sendTrack();
  } else {
    fetchArt(t.artUrl).then((a) => { if (song?.key === key && song.artSrc === src) { song.appArt = a; sendTrack(); } });
  }
}

// New song: fetch lyrics and genre side by side, then work out the vibe.
function loadSong(t) {
  const key = keyOf(t);
  song = { key, lyrics: { kind: 'loading' }, genre: null, vibe: null, appArt: null, itunesArt: null, artSrc: null };
  const current = () => song?.key === key;
  const refresh = () => {
    if (!current()) return;
    if (song.lyrics.kind !== 'loading') song.vibe = detectVibe({ genre: song.genre, lyrics: song.lyrics });
    sendTrack();
  };

  if (t.demo) {
    song.lyrics = DEMO_LYRICS;
    song.genre = t.genre;
    const demoArt = (SNAP && arg('art', null)) || path.join(__dirname, '..', 'assets', 'icon.png');   // --art= for README shots
    song.appArt = readArtFile(demoArt);
    refresh();
    return;
  }
  fetchLyrics(t)
    .then((l) => { if (current()) song.lyrics = l; })
    .catch(() => { if (current()) song.lyrics = { kind: 'none' }; })
    .finally(refresh);
  getMeta(t)
    .then((m) => { if (current()) { song.genre = m.genre; song.itunesArt = m.art; } })
    .catch(() => {})
    .finally(refresh);
  sendTrack();
}

function onUpdate(t) {
  track = t;
  if (t && t.playing) pausedSince = null;
  else if (!pausedSince) pausedSince = Date.now();

  if (t && keyOf(t) !== song?.key) loadSong(t);
  if (t && !t.demo) updateAppArt(t);
  if (win && !win.isDestroyed()) {
    win.webContents.send('position', {
      playing: !!t?.playing,
      positionMs: t?.positionMs ?? 0,
      at: Date.now()
    });
  }
  updateTrayTooltip();
}

// ---------- demo song (original lyrics, loops) ----------
let demoTimer = null;
function demoFeed() {
  const now = demo.pausedAt ?? Date.now();
  onUpdate({ ...DEMO_TRACK, playing: !demo.pausedAt, positionMs: (now - demo.started) % DEMO_TRACK.durationMs });
}
function startDemo() {
  stopDemo();
  demo = { started: Date.now(), pausedAt: null };
  demoFeed();
  demoTimer = setInterval(demoFeed, 700);
  showSaver(true);
}
function stopDemo() {
  if (!demo) return;
  clearInterval(demoTimer);
  demo = null; track = null; song = null;
}

// ---------- playback controls ----------
ipcMain.on('control', (_e, action) => {
  if (demo) {
    if (action === 'toggle') {
      if (demo.pausedAt) { demo.started += Date.now() - demo.pausedAt; demo.pausedAt = null; }
      else demo.pausedAt = Date.now();
    } else {
      demo.started = Date.now(); demo.pausedAt = null;        // next / prev: restart
    }
    demoFeed();
    return;
  }
  if (track) detector.control(action, track.app);
});

// ---------- the lyrics window ----------
function showSaver(manual = false) {
  if (win && !win.isDestroyed()) return;
  const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true };
  if (SNAP) {
    // Screenshot mode renders off-screen at 1600x900 so it never covers the real display.
    win = new BrowserWindow({ width: 1600, height: 900, show: false, frame: false,
      backgroundColor: '#000000', webPreferences: { ...webPreferences, offscreen: true } });
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      fullscreen: true,
      backgroundColor: '#000000',
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.once('ready-to-show', () => { win.show(); win.focus(); });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('mode', { manual, snap: !!SNAP, showControls: process.argv.includes('--controls') });
    sendTrack();
  });
  win.on('closed', () => { win = null; releaseAwake(); stopDemo(); });
  if (settings.keepAwake) blockerId = powerSaveBlocker.start('prevent-display-sleep');
}

function hideSaver() {
  if (win && !win.isDestroyed()) win.close();
}

function releaseAwake() {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = null;
}

// Auto start / stop
setInterval(() => {
  const showing = win && !win.isDestroyed();
  if (!showing && settings.idleSeconds > 0 && track?.playing &&
      powerMonitor.getSystemIdleTime() >= settings.idleSeconds) {
    showSaver(false);
  }
  // Music stopped for a while: get out of the way so the OS can power the display down.
  if (showing && !demo && pausedSince && Date.now() - pausedSince > settings.stopAfterPauseMin * 60000) {
    hideSaver();
  }
}, 2000);

powerMonitor.on('lock-screen', hideSaver);
powerMonitor.on('suspend', hideSaver);

ipcMain.on('dismiss', hideSaver);
ipcMain.on('set', (_e, patch) => { Object.assign(settings, patch); save(); buildMenu(); sendTrack(); });

// ---------- tray ----------
function updateTrayTooltip() {
  if (!tray) return;
  tray.setToolTip(track ? `IdleVerse — ${track.title} · ${track.artist}` : 'IdleVerse — nothing playing');
}

function buildMenu() {
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings[key] === value,
    click: () => { settings[key] = value; save(); sendTrack(); }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show lyrics now', click: () => showSaver(true) },
    { label: 'Play the demo song', click: startDemo },
    { type: 'separator' },
    { label: 'Start automatically when idle', submenu: [
      radio('After 10 seconds', 'idleSeconds', 10),
      radio('After 15 seconds', 'idleSeconds', 15),
      radio('After 30 seconds', 'idleSeconds', 30),
      radio('After 1 minute', 'idleSeconds', 60),
      radio('After 2 minutes', 'idleSeconds', 120),
      radio('After 5 minutes', 'idleSeconds', 300),
      radio('Never (manual only)', 'idleSeconds', 0)
    ] },
    { label: 'Lyric design', submenu: [
      radio('Match the song’s vibe (auto)', 'vibe', 'auto'),
      { type: 'separator' },
      radio('Sad — slow fade', 'vibe', 'sad'),
      radio('Happy — bouncy & bright', 'vibe', 'happy'),
      radio('Intense — rock slam', 'vibe', 'intense'),
      radio('Hype — hip-hop captions', 'vibe', 'hype'),
      radio('Dreamy — soft float', 'vibe', 'dreamy'),
      radio('Electric — neon pulse', 'vibe', 'electric')
    ] },
    { label: 'Keep screen on while lyrics show', type: 'checkbox', checked: settings.keepAwake,
      click: (i) => { settings.keepAwake = i.checked; save(); } },
    { label: 'Only Spotify & Apple Music', type: 'checkbox', checked: settings.onlyMusicApps,
      click: (i) => { settings.onlyMusicApps = detector.onlyMusicApps = i.checked; save(); } },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit IdleVerse', click: () => app.quit() }
  ]));
}

// Ties the app to its Start menu shortcut on Windows (search, taskbar and notifications).
if (process.platform === 'win32') app.setAppUserModelId('com.janakrathi.idleverse');

function trayIcon() {
  // In the installed app the icons sit outside app.asar (see "asarUnpack" in package.json),
  // because Windows can't read .ico files from inside the archive.
  const assets = path.join(__dirname, '..', 'assets').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (process.platform === 'darwin') {
    // Monochrome "template" image: macOS colours it to match a light or dark menu bar.
    const img = nativeImage.createFromPath(path.join(assets, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  // Windows: the round logo; the .ico holds every size so it's sharp at any display scaling.
  return path.join(assets, 'icon.ico');
}

app.whenReady().then(() => {
  tray = new Tray(trayIcon());
  tray.on('click', () => showSaver(true));
  buildMenu();
  updateTrayTooltip();

  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'win-nowplaying.ps1')
    : path.join(__dirname, 'detectors', 'win-nowplaying.ps1');
  detector = new NowPlaying({ scriptPath, onlyMusicApps: settings.onlyMusicApps });
  detector.on('update', (t) => { if (!demo) onUpdate(t); });
  detector.start();

  // Dev helper: `--song="Title|Artist" --snap=...` plays a pretend track through the real
  // lyrics / cover / vibe pipeline (no music app involved), 40s into the song.
  const fake = SNAP && arg('song', null);
  if (fake) {
    const [title, artist] = fake.split('|');
    const t0 = Date.now() - 40000;
    detector.removeAllListeners('update');
    setInterval(() => onUpdate({ app: 'test', title, artist, album: '', playing: true, positionMs: Date.now() - t0, durationMs: 220000 }), 700);
    setTimeout(() => showSaver(true), 500);
  } else if (process.argv.includes('--demo')) setTimeout(startDemo, 800);
  else if (process.argv.includes('--show')) setTimeout(() => showSaver(true), 1500);

  // Dev helper for README images:
  //   electron . --demo --snap=<dir> [--vibe=sad] [--controls] [--frames=3] [--every=4000] [--start=3000] [--fps=24]
  // saves frames of the lyrics screen (rendered off-screen), then quits.
  if (SNAP) {
    const dir = SNAP.slice(7);
    if (process.argv.includes('--check-tray')) {          // dev: confirm the tray icon loads in a packaged build
      const t = trayIcon();
      const img = typeof t === 'string' ? nativeImage.createFromPath(t) : t;
      fs.writeFileSync(path.join(dir, 'tray.json'), JSON.stringify({ path: typeof t === 'string' ? t : 'template', empty: img.isEmpty(), size: img.getSize() }));
      app.exit(0);
      return;
    }
    settings.vibe = arg('vibe', settings.vibe);
    const frames = Number(arg('frames', 3)), every = Number(arg('every', 4000)), start = Number(arg('start', 3000));
    const width = Number(arg('width', 1280));
    const fps = Number(arg('fps', 0));
    if (process.argv.includes('--perf')) {
      // Measures how smoothly the lyric screen animates for 6 seconds, then quits.
      setTimeout(async () => {
        const r = await win.webContents.executeJavaScript(`new Promise((done) => {
          const gaps = []; let last = performance.now(); const t0 = last;
          (function f(t) { gaps.push(t - last); last = t; if (t - t0 < 6000) requestAnimationFrame(f); else {
            gaps.sort((a, b) => a - b);
            done({ fps: +(gaps.length / ((t - t0) / 1000)).toFixed(1), p95: +gaps[Math.floor(gaps.length * .95)].toFixed(1), worst: +gaps[gaps.length - 1].toFixed(1) });
          } })(last);
        })`);
        fs.writeFileSync(path.join(dir, 'perf.json'), JSON.stringify(r));
        app.exit(0);
      }, start);
      return;
    }
    if (fps) {
      // Video mode: grab every painted frame from the off-screen renderer (smooth, for GIFs).
      let n = 0, recording = false;
      setTimeout(() => {
        if (!win) return;
        recording = true;
        win.webContents.setFrameRate(fps);
        win.webContents.on('paint', (_e, _dirty, img) => {
          if (!recording) return;
          fs.writeFileSync(path.join(dir, `frame${String(n).padStart(4, '0')}.jpg`), img.resize({ width }).toJPEG(92));
          if (++n >= frames) { recording = false; app.exit(0); }
        });
        win.webContents.invalidate();
      }, start);
      return;
    }
    let n = 0;
    setTimeout(function grab() {
      if (win && !win.isDestroyed()) {
        win.webContents.capturePage().then((img) => {
          fs.writeFileSync(path.join(dir, `frame${String(n).padStart(3, '0')}.png`), img.resize({ width }).toPNG());
          if (++n >= frames) app.exit(0); else setTimeout(grab, every);
        });
      } else setTimeout(grab, 500);
    }, start);
  }
});

app.on('second-instance', () => showSaver(true));
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', () => detector?.stop());
