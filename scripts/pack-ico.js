// Packs several square PNGs into one Windows .ico (PNG-compressed entries, Windows Vista+).
// Usage: node scripts/pack-ico.js out.ico 16.png 20.png 24.png 32.png 48.png 256.png
//
// How the IdleVerse icons were made (from assets/logo-source.webp, with ffmpeg):
//   - crop the logo to a square, scale it, then cut a circle with an alpha mask (geq)
//   - assets/icon.png        1024px circle, logo at ~75% (installer, taskbar, Mac app icon)
//   - tray sizes 16-48px     tighter crop so the swirl stays readable when tiny
//   - assets/trayTemplate*.png  black-on-transparent shape for the macOS menu bar
const fs = require('fs');

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) { console.error('usage: node pack-ico.js out.ico a.png b.png ...'); process.exit(1); }

const images = files.map((f) => {
  const data = fs.readFileSync(f);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`${f} is not a PNG`);
  return { data, w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
}).sort((a, b) => a.w - b.w);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const dir = images.map(({ data, w, h }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(w >= 256 ? 0 : w, 0);   // 0 means 256
  e.writeUInt8(h >= 256 ? 0 : h, 1);
  e.writeUInt8(0, 2);                  // palette colours
  e.writeUInt8(0, 3);                  // reserved
  e.writeUInt16LE(1, 4);               // colour planes
  e.writeUInt16LE(32, 6);              // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});

fs.writeFileSync(out, Buffer.concat([header, ...dir, ...images.map((i) => i.data)]));
console.log(`wrote ${out}: ${images.map((i) => i.w).join(', ')}px`);
