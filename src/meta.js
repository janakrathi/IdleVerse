// Song details that the music apps don't give us: genre, and album art as a fallback.
// Uses Apple's free iTunes Search API (no account or key needed).
const fs = require('fs');

const cache = new Map();
const norm = (s = '') => s.toLowerCase()
  .replace(/\s*[\(\[].*?[\)\]]/g, '')       // drop "(feat. x)", "[Remastered]"
  .replace(/\s+-\s+.*$/, '')                // drop " - Radio Edit"
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function mimeOf(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[8] === 0x57) return 'image/webp';
  return 'image/jpeg';
}
const toDataUrl = (buf) => `data:${mimeOf(buf)};base64,${buf.toString('base64')}`;

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Album art handed over by the music app itself (a file on Windows, a URL from Spotify on Mac).
function readArtFile(file) {
  try { return toDataUrl(fs.readFileSync(file)); } catch { return null; }
}
async function fetchArt(url) {
  try { return toDataUrl(await fetchBuffer(url)); } catch { return null; }
}

async function itunesLookup({ title, artist }) {
  const term = `${artist.split(/,|&| x | feat/i)[0]} ${norm(title)}`;
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: '10' })}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  let { results = [] } = await res.json();
  results = results.filter((r) => r.primaryGenreName !== 'Karaoke' &&
    !/karaoke|tribute|cover|made famous|instrumental version/i.test(`${r.artistName} ${r.collectionName} ${r.trackName}`));
  const t = norm(title), a = norm(artist);
  const score = (r) => (norm(r.trackName) === t ? 2 : norm(r.trackName).includes(t) ? 1 : 0) +
                       (a.includes(norm(r.artistName)) || norm(r.artistName).includes(a) ? 2 : 0);
  results.sort((x, y) => score(y) - score(x));
  const best = results[0];
  return best && score(best) >= 2 ? best : null;
}

// Returns { genre, art } from iTunes (art is a data: URL, used only when the app gives none).
async function getMeta(track) {
  const key = `${track.artist}|${track.title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let hit = null;
  try { hit = await itunesLookup(track); } catch { /* offline etc. */ }
  const art = hit?.artworkUrl100 ? await fetchArt(hit.artworkUrl100.replace('100x100bb', '600x600bb')) : null;
  const meta = { genre: hit?.primaryGenreName || null, art };
  cache.set(key, meta);
  return meta;
}

module.exports = { getMeta, readArtFile, fetchArt };
