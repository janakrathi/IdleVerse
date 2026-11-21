const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, powerSaveBlocker, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { NowPlaying } = require('./detectors');
const { fetchLyrics } = require('./lyrics');
const { DEMO_TRACK, DEMO_LYRICS } = require('./demo');

const SNAP = process.argv.find((a) => a.startsWith('--snap='));   // dev: screenshot mode
if (!SNAP && !app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'darwin') app.dock?.hide(); // lives in the menu bar

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  idleSeconds: 60,        // start the screensaver after this much idle time while music plays (0 = never)
  style: 'mix',           // mix | bounce | neon | wave | typewriter | pop
  keepAwake: true,        // stop the display sleeping while lyrics are on screen
  stopAfterPauseMin: 2,   // music paused this long -> close and let the screen sleep normally
  onlyMusicApps: true,    // ignore YouTube tabs etc.
  offsetMs: 0
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
const save = () => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} };

// ---------- state ----------
let tray, win, detector, blockerId = null;
let track = null;             // current track info from the detector
let lyrics = null;            // { kind, lines }
let lyricsKey = '';
let pausedSince = null;
let demoTimer = null;         // set while the built-in demo song is playing

const keyOf = (t) => (t ? `${t.artist}|${t.title}` : '');

function sendTrack() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('track', { track, lyrics, settings });
}

function onUpdate(t) {
  track = t;
  if (t && t.playing) pausedSince = null;
  else if (!pausedSince) pausedSince = Date.now();

  const key = keyOf(t);
  if (t && key !== lyricsKey) {
    lyricsKey = key;
    if (t.demo) {
      lyrics = DEMO_LYRICS;
    } else {
      lyrics = { kind: 'loading' };
      fetchLyrics(t)
        .then((l) => { if (lyricsKey === key) { lyrics = l; sendTrack(); } })
        .catch(() => { if (lyricsKey === key) { lyrics = { kind: 'none' }; sendTrack(); } });
    }
    sendTrack();
  }
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
function startDemo() {
  stopDemo();
  const started = Date.now();
  const feed = () => onUpdate({ ...DEMO_TRACK, positionMs: (Date.now() - started) % DEMO_TRACK.durationMs });
  feed();
  demoTimer = setInterval(feed, 700);
  showSaver(true);
}

function stopDemo() {
  if (!demoTimer) return;
  clearInterval(demoTimer);
  demoTimer = null;
  track = null; lyrics = null; lyricsKey = '';
}

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
  win.webContents.once('did-finish-load', () => { win.webContents.send('mode', { manual }); sendTrack(); });
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
  if (showing && pausedSince && Date.now() - pausedSince > settings.stopAfterPauseMin * 60000) {
    hideSaver();
  }
}, 2000);

powerMonitor.on('lock-screen', hideSaver);
powerMonitor.on('suspend', hideSaver);

ipcMain.on('dismiss', hideSaver);
ipcMain.on('set', (_e, patch) => { Object.assign(settings, patch); save(); buildMenu(); });

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
      radio('After 30 seconds', 'idleSeconds', 30),
      radio('After 1 minute', 'idleSeconds', 60),
      radio('After 2 minutes', 'idleSeconds', 120),
      radio('After 5 minutes', 'idleSeconds', 300),
      radio('Never (manual only)', 'idleSeconds', 0)
    ] },
    { label: 'Animation style', submenu: [
      radio('Mix it up', 'style', 'mix'),
      radio('Bounce', 'style', 'bounce'),
      radio('Neon', 'style', 'neon'),
      radio('Wave', 'style', 'wave'),
      radio('Typewriter', 'style', 'typewriter'),
      radio('Pop', 'style', 'pop')
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

app.whenReady().then(() => {
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  icon = icon.resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(icon);
  tray.on('click', () => showSaver(true));
  buildMenu();
  updateTrayTooltip();

  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'win-nowplaying.ps1')
    : path.join(__dirname, 'detectors', 'win-nowplaying.ps1');
  detector = new NowPlaying({ scriptPath, onlyMusicApps: settings.onlyMusicApps });
  detector.on('update', (t) => { if (!demoTimer) onUpdate(t); });
  detector.start();

  if (process.argv.includes('--demo')) setTimeout(startDemo, 800);
  else if (process.argv.includes('--show')) setTimeout(() => showSaver(true), 1500);

  // Dev helper: `electron . --demo --snap=<dir> [--style=pop] [--frames=40] [--every=150]`
  // saves numbered PNG frames of the lyrics screen, then quits. Used for the README images.
  if (SNAP) {
    const dir = SNAP.slice(7);
    const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
    const style = arg('style', null);
    if (style) settings.style = style;
    const frames = Number(arg('frames', 3)), every = Number(arg('every', 4000)), start = Number(arg('start', 3000));
    const width = Number(arg('width', 1280));
    const fps = Number(arg('fps', 0));
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
    let n = 0, t0 = 0;
    setTimeout(function grab() {
      if (win && !win.isDestroyed()) {
        t0 = t0 || Date.now();
        win.webContents.capturePage().then((img) => {
          fs.writeFileSync(path.join(dir, `frame${String(n).padStart(3, '0')}.png`), img.resize({ width }).toPNG());
          if (++n >= frames) {
            fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ frames: n, ms: Date.now() - t0 }));
            app.exit(0);
          } else setTimeout(grab, every);
        });
      } else setTimeout(grab, 500);
    }, start);
  }
});

app.on('second-instance', () => showSaver(true));
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', () => detector?.stop());
