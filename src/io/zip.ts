/** Minimal single-file ZIP (stored, no compression) — used where .dxf downloads are not allowed. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipOne(name: string, text: string): Blob {
  const enc = new TextEncoder(), data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
  const lh = new Uint8Array(30 + nm.length), a = new DataView(lh.buffer);
  a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(12, 0x21, true); a.setUint32(14, crc, true); a.setUint32(18, data.length, true); a.setUint32(22, data.length, true); a.setUint16(26, nm.length, true); lh.set(nm, 30);
  const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
  c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); ch.set(nm, 46);
  const end = new Uint8Array(22), d = new DataView(end.buffer); d.setUint32(0, 0x06054b50, true); d.setUint16(8, 1, true); d.setUint16(10, 1, true); d.setUint32(12, ch.length, true); d.setUint32(16, lh.length + data.length, true);
  return new Blob([lh, data, ch, end], { type: 'application/zip' });
}
