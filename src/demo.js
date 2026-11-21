// A built-in demo song with original lyrics, so you can preview IdleVerse
// without anything playing (tray menu -> "Play the demo song", or `npm run demo`).
const DEMO_TRACK = {
  title: 'Screen Dreams',
  artist: 'IdleVerse',
  album: 'Demo',
  playing: true,
  durationMs: 42000,
  demo: true
};

const DEMO_LYRICS = {
  kind: 'synced',
  lines: [
    [2500, 'Walked away from my keyboard'],
    [5700, 'but the music kept on playing'],
    [8900, 'now the room is dark and quiet'],
    [12100, 'and the words are softly swaying'],
    [15300, ''],
    [17500, 'Every line lights up the night'],
    [20700, 'every word a little spark'],
    [23900, 'power low but spirits high'],
    [27100, 'letters dancing in the dark'],
    [30300, ''],
    [32500, 'Move the mouse to wake me up'],
    [35700, "I'll be here when you come back"],
    [39000, '']
  ].map(([t, text]) => ({ t, text }))
};

module.exports = { DEMO_TRACK, DEMO_LYRICS };
