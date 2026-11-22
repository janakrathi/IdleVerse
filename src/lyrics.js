// Lyrics come from LRCLIB (https://lrclib.net) — free, no account or API key,
// and most songs have time-synced lyrics.
const UA = 'IdleVerse/1.0 (https://github.com/janakrathi/IdleVerse)';
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
  return tidy(lines.sort((a, b) => a.t - b.t));
}

// Community lyric files are sometimes messy. Some (lots of Bollywood songs, for example)
// put an English translation after every line, timed to show for a split second, which
// flashes half-drawn on screen. Others end with "Lyrics edited by ..." credits.
const MIN_LINE_MS = 1000;                     // shorter than this can't be read anyway
const CREDIT = /^(lyrics?|subtitles?|lrc|synced|transcribed|edited)\b.*\b(by|from)\b|^(www\.|https?:\/\/)/i;
function tidy(lines) {
  // Several lines with the same timestamp: keep the first one with words (the original).
  const byTime = [];
  for (const l of lines) {
    const prev = byTime[byTime.length - 1];
    if (prev && prev.t === l.t) { if (!prev.text && l.text) prev.text = l.text; continue; }
    byTime.push({ ...l });
  }
  const kept = byTime.filter((l) => !CREDIT.test(l.text));
  // A file with translations shows a song-wide pattern: a normal line (3s+), then one that
  // only flashes by. When enough of the song looks like that, drop the flashes; the line
  // before simply stays up a moment longer. Fast rap (runs of quick lines) is left alone.
  const dur = (i) => (i >= 0 && i < kept.length - 1 ? kept[i + 1].t - kept[i].t : Infinity);
  const flash = kept.map((l, i) => !!l.text && dur(i) < MIN_LINE_MS && dur(i - 1) >= 3000 && dur(i + 1) >= MIN_LINE_MS);
  const flashes = flash.filter(Boolean).length, sung = kept.filter((l) => l.text).length;
  if (flashes < 3 || flashes < sung * 0.1) return kept;
  return kept.filter((l, i) => !flash[i]);
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
