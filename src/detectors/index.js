// Cross-platform "what's playing right now" detector, plus play/pause/next/previous.
// Windows: system media sessions via PowerShell (Spotify, Apple Music, browsers).
// macOS:   asks the Spotify and Music apps directly via JavaScript for Automation.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const MAC_SCRIPT = `
function info(name) {
  try {
    const a = Application(name);
    if (!a.running()) return null;
    const t = a.currentTrack();
    const dur = t.duration();
    let artUrl = '';
    if (name === 'Spotify') { try { artUrl = t.artworkUrl(); } catch (e) {} }
    return {
      app: name,
      title: t.name(),
      artist: t.artist(),
      album: t.album(),
      playing: String(a.playerState()) === 'playing',
      positionMs: Math.round(a.playerPosition() * 1000),
      durationMs: name === 'Spotify' ? dur : Math.round(dur * 1000),
      artUrl: artUrl
    };
  } catch (e) { return null; }
}
JSON.stringify({ sessions: [info('Spotify'), info('Music')].filter(Boolean) });
`;

const MAC_COMMANDS = { toggle: 'playpause', next: 'nextTrack', prev: 'previousTrack' };

// Which app a session belongs to, so Spotify / Apple Music win over e.g. a YouTube tab.
function sourceOf(appId = '') {
  const id = appId.toLowerCase();
  if (id.includes('spotify')) return 'spotify';
  if (id.includes('applemusic') || id === 'music' || id.includes('itunes')) return 'apple';
  return 'other';
}

// Apple Music for Windows reports artist as "Artist — Album".
function clean(s) {
  let artist = (s.artist || '').trim();
  let album = (s.album || '').trim();
  if (sourceOf(s.app) === 'apple' && artist.includes(' — ')) {
    const [a, b] = artist.split(' — ');
    artist = a.trim();
    if (!album) album = (b || '').trim();
  }
  return { ...s, artist, album, title: (s.title || '').trim(), source: sourceOf(s.app) };
}

function pick(sessions, onlyMusicApps) {
  const list = sessions.map(clean).filter((s) => s.title);
  const rank = (s) => (s.playing ? 0 : 10) + (s.source === 'other' ? 1 : 0);
  const usable = onlyMusicApps ? list.filter((s) => s.source !== 'other') : list;
  usable.sort((a, b) => rank(a) - rank(b));
  return usable[0] || null;
}

class NowPlaying extends EventEmitter {
  constructor({ scriptPath, onlyMusicApps = true }) {
    super();
    this.scriptPath = scriptPath;
    this.onlyMusicApps = onlyMusicApps;
    this.stopped = false;
  }

  start() {
    if (process.platform === 'win32') this._startWindows();
    else if (process.platform === 'darwin') this._startMac();
    else this.emit('error', new Error('Only Windows and macOS are supported'));
  }

  stop() {
    this.stopped = true;
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); }
    clearTimeout(this.timer);
  }

  // action: 'toggle' | 'next' | 'prev'; app: the session's app id from the last update
  control(action, app) {
    if (process.platform === 'win32') {
      if (this.proc?.stdin.writable) this.proc.stdin.write(`${action}\t${app || ''}\n`);
    } else if (process.platform === 'darwin') {
      const target = app === 'Music' ? 'Music' : 'Spotify';
      const js = `Application(${JSON.stringify(target)}).${MAC_COMMANDS[action]}()`;
      execFile('osascript', ['-l', 'JavaScript', '-e', js], { timeout: 4000 }, () => {
        if (!this.inFlight) { clearTimeout(this.timer); this._macTick(); }  // show the new state right away
      });
    }
  }

  _handle(json) {
    try {
      const data = JSON.parse(json);
      this.emit('update', pick(data.sessions || [], this.onlyMusicApps));
    } catch { /* ignore partial lines */ }
  }

  _startWindows() {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath, '-IntervalMs', '700'
    ], { windowsHide: true });
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this._handle(line);
      }
    });
    proc.stdin.on('error', () => {});
    proc.on('exit', () => {
      if (!this.stopped) setTimeout(() => this._startWindows(), 2000); // restart if it dies
    });
  }

  _macTick() {
    this.inFlight = true;
    execFile('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT], { timeout: 4000 }, (err, out) => {
      this.inFlight = false;
      if (!err) this._handle(out.trim());
      if (!this.stopped) this.timer = setTimeout(() => this._macTick(), 800);
    });
  }

  _startMac() { this._macTick(); }
}

module.exports = { NowPlaying };
