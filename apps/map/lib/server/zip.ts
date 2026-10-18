// Reads the entries of a small zip archive in memory (GDELT's 15-minute
// export files are one CSV each, about 20-60 kB zipped). Only the two methods
// such files use: stored (0) and deflate (8). Server only (node:zlib).
//
// The central directory is read rather than the local headers, because a zip
// written with data descriptors leaves the sizes in the local header zero.

import zlib from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export function zipEntries(buf: Uint8Array): ZipEntry[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const nameLen = b.readUInt16LE(p + 28);
    out.push({
      name: b.toString("utf8", p + 46, p + 46 + nameLen),
      method: b.readUInt16LE(p + 10),
      compressedSize: b.readUInt32LE(p + 20),
      size: b.readUInt32LE(p + 24),
      localOffset: b.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return out;
}

/** The bytes of one entry. */
export function zipRead(buf: Uint8Array, e: ZipEntry): Buffer {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const lh = e.localOffset;
  if (b.readUInt32LE(lh) !== 0x04034b50) throw new Error("zip: bad local header");
  const start = lh + 30 + b.readUInt16LE(lh + 26) + b.readUInt16LE(lh + 28);
  const data = b.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`zip: unsupported compression method ${e.method}`);
}

/** The text of the first entry (GDELT's single CSV). */
export function firstEntryText(buf: Uint8Array): { name: string; text: string } {
  const [e] = zipEntries(buf);
  if (!e) throw new Error("zip: empty archive");
  return { name: e.name, text: zipRead(buf, e).toString("utf8") };
}
