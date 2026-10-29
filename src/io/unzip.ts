/**
 * Read a .zip (as downloaded from Teams / OneDrive / SharePoint or made by Windows/macOS "Compress").
 * Clean-room reader of the ZIP central directory; "deflate" entries are unpacked with the browser's
 * own DecompressionStream('deflate-raw'), so no extra library is needed. Stored entries are copied.
 */
export interface ZipEntry { path: string; name: string; data: Uint8Array; modified: number }

const dosTime = (d: number, t: number) => new Date(1980 + (d >> 9), ((d >> 5) & 15) - 1, d & 31, t >> 11, (t >> 5) & 63, (t & 31) * 2).getTime();

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([raw as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Every file in the zip (folders and macOS "__MACOSX" extras skipped). Throws if it isn't a zip. */
export async function unzip(buf: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // find the end-of-central-directory record (it may be followed by a comment of up to 64 KB)
  let eo = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('not a zip file');
  const count = v.getUint16(eo + 10, true); let p = v.getUint32(eo + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('this zip is too big (ZIP64) — unzip it first and choose the folder');
  const utf8 = new TextDecoder('utf-8'), out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
    const method = v.getUint16(p + 10, true), time = v.getUint16(p + 12, true), date = v.getUint16(p + 14, true);
    const csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const path = utf8.decode(b.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
    p += 46 + nl + xl + cl;
    if (path.endsWith('/') || /(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path)) continue;
    if (v.getUint32(lo, true) !== 0x04034b50) throw new Error('damaged zip file');
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = b.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw);
    else throw new Error(`“${path}” is packed in a way Kerf 2D can't open (method ${method})`);
    out.push({ path, name: path.split('/').pop()!, data, modified: dosTime(date, time) });
  }
  return out;
}

/** The files inside a zip as File objects (name = the file's own name, without its folder). */
export async function unzipFiles(f: Blob): Promise<File[]> {
  return (await unzip(await f.arrayBuffer())).map(e => new File([e.data as BlobPart], e.name, { lastModified: e.modified }));
}
