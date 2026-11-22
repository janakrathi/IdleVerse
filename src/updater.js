// Keeps IdleVerse up to date from GitHub Releases.
//
// Windows: the new installer downloads quietly in the background, then installs silently
// the next time the lyrics aren't on screen, and IdleVerse reopens by itself.
// macOS: the app isn't signed by Apple yet, so macOS won't let it replace itself. Instead it
// checks for a newer release and shows a notification that opens the download page.
//
// The only thing sent is a normal request to github.com (your IP address and the app's
// version, like any download). It can be switched off in the tray menu under Privacy.
const { app, Notification, shell } = require('electron');

const RELEASES_PAGE = 'https://github.com/janakrathi/IdleVerse/releases/latest';
const LATEST_API = 'https://api.github.com/repos/janakrathi/IdleVerse/releases/latest';
const UA = `IdleVerse/${app.getVersion()} (https://github.com/janakrathi/IdleVerse)`;
const EVERY_MS = 6 * 60 * 60 * 1000;          // check every 6 hours while running
const FIRST_CHECK_MS = 30 * 1000;             // and 30 seconds after starting

// "1.10.0" > "1.9.2"
function isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

// isBusy(): true while the lyrics are on screen (never interrupt them to install).
// onChange(state): called whenever the update status changes (to refresh the tray menu).
function createUpdater({ isBusy, onChange }) {
  // status: idle | checking | downloading | ready | available | latest | error
  let state = { status: 'idle', version: null };
  let enabled = false, timer = null, manualCheck = false, installTimer = null;
  const set = (patch) => { state = { ...state, ...patch }; onChange?.(state); };

  let auto = null;
  if (process.platform === 'win32') {
    auto = require('electron-updater').autoUpdater;
    auto.autoDownload = true;
    auto.autoInstallOnAppQuit = true;      // also installs if you quit before it gets a chance
    auto.logger = null;
    auto.on('checking-for-update', () => set({ status: 'checking' }));
    auto.on('update-available', (i) => set({ status: 'downloading', version: i.version }));
    auto.on('update-not-available', () => {
      set({ status: 'latest' });
      if (manualCheck) notify('IdleVerse is up to date', `You have the latest version (${app.getVersion()}).`);
    });
    auto.on('error', (e) => {
      set({ status: 'error' });
      if (manualCheck) notify('Couldn’t check for updates', 'Check your internet connection and try again.');
    });
    auto.on('update-downloaded', (i) => { set({ status: 'ready', version: i.version }); installWhenFree(); });
  }

  function installWhenFree() {
    clearTimeout(installTimer);
    if (isBusy()) { installTimer = setTimeout(installWhenFree, 60 * 1000); return; }
    installNow();
  }
  // Silent install, then IdleVerse starts again on its own.
  const installNow = () => auto?.quitAndInstall(true, true);

  async function checkMac() {
    set({ status: 'checking' });
    try {
      const res = await fetch(LATEST_API, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const latest = String((await res.json()).tag_name || '').replace(/^v/, '');
      if (latest && isNewer(latest, app.getVersion())) {
        const firstTime = state.version !== latest;
        set({ status: 'available', version: latest });
        if (firstTime || manualCheck) {
          notify(`IdleVerse ${latest} is available`, 'Click to download the new version.', () => shell.openExternal(RELEASES_PAGE));
        }
      } else {
        set({ status: 'latest' });
        if (manualCheck) notify('IdleVerse is up to date', `You have the latest version (${app.getVersion()}).`);
      }
    } catch {
      set({ status: 'error' });
      if (manualCheck) notify('Couldn’t check for updates', 'Check your internet connection and try again.');
    }
  }

  async function check(manual = false) {
    if (!app.isPackaged) return;                    // running from source: nothing to update
    if (state.status === 'ready') { if (manual) installWhenFree(); return; }
    manualCheck = manual;
    if (auto) { try { await auto.checkForUpdates(); } catch { /* reported via 'error' */ } }
    else await checkMac();
  }

  function setEnabled(on) {
    enabled = on;
    clearTimeout(timer); clearInterval(timer);
    if (!on) return;
    timer = setTimeout(() => { check(false); timer = setInterval(() => check(false), EVERY_MS); }, FIRST_CHECK_MS);
  }

  return {
    get state() { return state; },
    check, setEnabled, installNow,
    openDownloadPage: () => shell.openExternal(RELEASES_PAGE),
    get enabled() { return enabled; }
  };
}

// After an update, say so once.
function announceIfUpdated(settings, save) {
  const now = app.getVersion();
  if (settings.lastVersion && settings.lastVersion !== now && isNewer(now, settings.lastVersion)) {
    notify(`IdleVerse updated to ${now}`, 'See what’s new on the releases page.', () => shell.openExternal(RELEASES_PAGE));
  }
  if (settings.lastVersion !== now) { settings.lastVersion = now; save(); }
}

module.exports = { createUpdater, announceIfUpdated, isNewer };
