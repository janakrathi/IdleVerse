// Works out a song's "vibe" from three clues:
//   1. its genre (from iTunes)
//   2. the words in its lyrics (sad / happy / intense / swagger word lists)
//   3. how fast the words come (words per second, from the synced lyrics)
// Each vibe gets its own lyric design in the screensaver.

const VIBES = ['sad', 'happy', 'intense', 'hype', 'dreamy', 'electric'];

const GENRES = [
  [/metal|punk|hard rock|grunge|^rock|rock$|emo|hardcore/i, 'intense'],
  [/hip.?hop|rap|trap|drill|grime/i, 'hype'],
  [/dance|electronic|house|techno|edm|trance|dubstep|drum|electro/i, 'electric'],
  [/r&b|soul|jazz|acoustic|folk|singer|ambient|lo.?fi|classical|chill|indie|alternative|blues|new age/i, 'dreamy'],
  [/pop|k-pop|latin|reggaeton|country|disco|funk|afro|j-pop/i, 'happy']
];

const WORDS = {
  sad: 'cry crying cried tears tear alone lonely goodbye broken heartbreak hurt hurts hurting pain sorry miss missing lost gone cold rain empty sad regret fade fading ghost grave bleed bleeding scars sorrow die dying dead funeral numb drown drowning ache aching apart lie lies leaving',
  happy: 'happy smile smiling sunshine sun dance dancing party fun shine shining bright summer celebrate laugh laughing sweet kiss alive free fly glow good feel vibe vibes yeah sugar candy beautiful lucky magic',
  intense: 'fight fire burn burning war scream screaming rage blood kill hell fear wild smash rebel storm thunder crash bullet enemy louder destroy chaos demon violent riot fury',
  hype: 'money cash bands drip ice whip flex gang racks hustle grind boss rich chain stack stacks bag bricks plug opps lit hood',
};
const LEX = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

function lyricStats(lines = []) {
  const words = lines.flatMap((l) => l.text.toLowerCase().match(/[\p{L}\p{M}']+/gu) || []);
  const counts = { sad: 0, happy: 0, intense: 0, hype: 0 };
  for (const w of words) for (const k in LEX) if (LEX[k].has(w)) counts[k]++;
  const sung = lines.filter((l) => l.text);
  const span = sung.length > 1 ? (sung[sung.length - 1].t - sung[0].t) / 1000 : 0;
  return { total: words.length, counts, wps: span > 20 ? words.length / span : null };
}

function detectVibe({ genre, lyrics }) {
  if (lyrics?.kind === 'instrumental') return { vibe: 'dreamy', why: 'instrumental' };

  const fromGenre = genre ? (GENRES.find(([re]) => re.test(genre)) || [])[1] : null;
  const { total, counts, wps } = lyricStats(lyrics?.lines);
  const per100 = (k) => (total ? (counts[k] * 100) / total : 0);
  const sad = per100('sad'), happy = per100('happy'), intense = per100('intense'), hype = per100('hype');

  // Strong lyric signals win over genre: a sad pop ballad should feel sad.
  if (sad >= 2.2 && sad > happy * 1.4 && fromGenre !== 'hype') return { vibe: 'sad', why: `sad lyrics (${sad.toFixed(1)}%)` };
  if (hype >= 2 && wps && wps > 2.2) return { vibe: 'hype', why: 'fast flow + swagger words' };
  if (intense >= 2 && !['happy', 'electric'].includes(fromGenre)) return { vibe: 'intense', why: 'intense lyrics' };

  if (fromGenre) {
    // A slow, wordy-sad song in a "happy" genre is still a ballad.
    if (fromGenre === 'happy' && sad >= 1.2 && sad > happy && wps && wps < 1.6) return { vibe: 'sad', why: `slow ${genre} ballad` };
    if (fromGenre === 'happy' && wps && wps < 1.1) return { vibe: 'dreamy', why: `slow ${genre}` };
    if (fromGenre === 'dreamy' && wps && wps > 2.2) return { vibe: 'happy', why: `upbeat ${genre}` };
    if (fromGenre === 'hype' && wps && wps < 1.5) return { vibe: 'dreamy', why: `slow, melodic ${genre}` };
    return { vibe: fromGenre, why: genre };
  }

  // No genre: fall back on the lyrics alone.
  if (wps && wps > 2.8) return { vibe: 'hype', why: 'fast flow' };
  if (sad > happy && sad >= 1) return { vibe: 'sad', why: 'sad lyrics' };
  if (happy >= 1) return { vibe: 'happy', why: 'upbeat lyrics' };
  return { vibe: 'dreamy', why: 'default' };
}

module.exports = { detectVibe, lyricStats, VIBES };
