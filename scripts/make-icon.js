// Draws assets/icon.png (512x512): a gradient disc with a music note. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const px = Buffer.alloc(S * S * 4);
const inEllipse = (x, y, cx, cy, rx, ry, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dy = y - cy;
  const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
  return u * u + v * v <= 1;
};
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const d = Math.hypot(x - S / 2, y - S / 2);
    if (d > S / 2 - 8) continue;
    const t = (x + y) / (2 * S);
    let r = 255 * (0.55 + 0.4 * t), g = 60 + 80 * (1 - t), b = 255 * (0.95 - 0.35 * t);
    const note =
      inEllipse(x, y, 205, 360, 62, 44, -0.4) ||
      inEllipse(x, y, 345, 320, 62, 44, -0.4) ||
      (x >= 250 && x <= 272 && y >= 140 && y <= 355) ||
      (x >= 390 && x <= 412 && y >= 100 && y <= 315) ||
      (y >= 100 + (x - 250) * (-40 / 162) && y <= 150 + (x - 250) * (-40 / 162) && x >= 250 && x <= 412);
    if (note) r = g = b = 255;
    const a = Math.min(1, (S / 2 - 8 - d) / 2) * 255;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out);
