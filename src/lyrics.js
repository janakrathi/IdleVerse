// Lyrics come from LRCLIB (https://lrclib.net) — free, no account or API key,
// and most songs have time-synced lyrics.
const UA = 'IdleVerse/1.0 (https://github.com/janakrathi/idleverse)';
const cache = new Map();

function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      lines.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

function toResult(rec, durationMs) {
  if (!rec) return null;
  if (rec.instrumental) return { kind: 'instrumental' };
  if (rec.syncedLyrics) return { kind: 'synced', lines: parseLrc(rec.syncedLyrics) };
  if (rec.plainLyrics) {
    // No timings: spread lines evenly over the song so they still flow.
    const texts = rec.plainLyrics.split(/\r?\n/).map((s) => s.trim());
    const dur = durationMs || (rec.duration || 200) * 1000;
    const start = 8000, span = Math.max(dur - start - 10000, texts.length * 1500);
    return {
      kind: 'plain',
      lines: texts.map((text, i) => ({ t: Math.round(start + (span * i) / texts.length), text }))
    };
  }
  return null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

// Strip "(feat. X)", "- Remastered 2011" etc. which often break matching.
const simplify = (s) => s.replace(/\s*[\(\[](feat|ft|with|remaster|live|explicit)[^\)\]]*[\)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '').trim();

async function fetchLyrics({ title, artist, album, durationMs }) {
  const key = `${artist}|${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let result = null;
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) q.set('album_name', album);
  if (durationMs > 0) q.set('duration', String(Math.round(durationMs / 1000)));
  try {
    result = toResult(await getJson(`https://lrclib.net/api/get?${q}`), durationMs);
  } catch { /* fall through to search */ }

  if (!result) {
    const s = new URLSearchParams({ track_name: simplify(title), artist_name: artist.split(/,|&/)[0].trim() });
    const hits = (await getJson(`https://lrclib.net/api/search?${s}`)) || [];
    const dur = durationMs / 1000;
    hits.sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0) ||
      Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur));
    result = toResult(hits[0], durationMs);
  }

  result = result || { kind: 'none' };
  cache.set(key, result);
  return result;
}

module.exports = { fetchLyrics, parseLrc };
