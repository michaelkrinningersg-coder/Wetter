import { inflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP reader, just enough for the DWD archives.
 *
 * The alternative is a dependency, and a dependency is exactly what the
 * scheduled workflow must not need: `npm ci` would drag in the native build of
 * better-sqlite3 and turn a ten-second run into a multi-minute one that can
 * fail for reasons having nothing to do with the weather. Everything below
 * uses `node:zlib`, which ships with Node.
 *
 * Scope is deliberately narrow — no Zip64, no encryption, no multi-disk. DWD
 * archives are single-disk, a few hundred kilobytes, and use the two methods
 * every ZIP writer emits: stored (0) and deflate (8). Anything else raises
 * rather than returning silently wrong bytes.
 */

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

const STORED = 0
const DEFLATED = 8

/** Locate the End of Central Directory record, scanning back from the tail. */
function findEocd(buf) {
  // The record is 22 bytes plus a comment of up to 65535. Scanning backwards
  // finds the real one first even if the comment happens to contain the
  // signature bytes.
  const min = Math.max(0, buf.length - (22 + 0xffff))
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('Kein ZIP-Archiv: End-of-Central-Directory nicht gefunden.')
}

/**
 * List the entries of a ZIP archive.
 *
 * Returns `{ name, method, compressedSize, size, offset }` per entry; the
 * bytes are read lazily by `readEntry`, so a caller that wants one file out of
 * many does not pay for the rest.
 */
export function listEntries(buf) {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  const entries = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`Beschädigtes ZIP: Central-Directory-Eintrag ${i} fehlt.`)
    }
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)

    entries.push({
      name: buf.toString('latin1', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Decompress one entry returned by `listEntries`. */
export function readEntry(buf, entry) {
  if (buf.readUInt32LE(entry.offset) !== SIG_LOCAL) {
    throw new Error(`Beschädigtes ZIP: lokaler Header fehlt für ${entry.name}.`)
  }
  // The local header repeats the name and extra fields, and its extra field
  // may differ in length from the central one — so the data offset has to come
  // from here, not from the central directory.
  const nameLen = buf.readUInt16LE(entry.offset + 26)
  const extraLen = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compressedSize)

  if (entry.method === STORED) return Buffer.from(raw)
  if (entry.method === DEFLATED) return inflateRawSync(raw)
  throw new Error(`Nicht unterstütztes ZIP-Verfahren ${entry.method} für ${entry.name}.`)
}

/** Read the first entry whose name matches, decoded as latin1 (DWD's encoding). */
export function readMatchingText(buf, pattern) {
  const entry = listEntries(buf).find((e) => pattern.test(e.name))
  if (!entry) return null
  return readEntry(buf, entry).toString('latin1')
}
