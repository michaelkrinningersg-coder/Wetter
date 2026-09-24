import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, posix, sep } from 'node:path'

/**
 * Minimal TAR writer and reader, for the archive the program ships with.
 *
 * The CSV archive is 4,669 files and 65 MB, and both numbers are a problem at
 * install time: gzipped as one stream it is 11 MB, and unpacking one file is
 * far quicker than copying four and a half thousand — on Windows, where every
 * file creation is a separate call into the filesystem driver, dramatically so.
 *
 * Why TAR and not a format of our own: 7-Zip opens a `.tar.gz`. If this program
 * ever stops being installed, the archive it shipped is still an archive
 * anybody can read, and that is worth the hundred lines below.
 *
 * Scope is deliberately narrow, like `zip.js`: regular files only, ustar
 * headers, paths short enough for the 100-byte name field — the longest one in
 * this project's archive is 28 characters. Anything outside that raises rather
 * than writing something a real `tar` would misread.
 */

const BLOCK = 512
const NAME_LIMIT = 100

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** An octal field, NUL-terminated, as every ustar writer emits them. */
function octal(value, width) {
  const text = value.toString(8).padStart(width - 1, '0')
  if (text.length > width - 1) throw new Error(`Wert ${value} passt nicht in ${width} Oktalstellen`)
  return Buffer.from(`${text}\0`, 'ascii')
}

function header(name, size, mtime) {
  if (Buffer.byteLength(name) > NAME_LIMIT) {
    throw new Error(`Pfad zu lang für ein ustar-Archiv (${NAME_LIMIT} Zeichen): ${name}`)
  }

  const buf = Buffer.alloc(BLOCK)
  buf.write(name, 0, 'utf8')
  octal(0o644, 8).copy(buf, 100) // mode
  octal(0, 8).copy(buf, 108) // uid
  octal(0, 8).copy(buf, 116) // gid
  octal(size, 12).copy(buf, 124)
  octal(Math.floor(mtime / 1000), 12).copy(buf, 136)
  buf.write('0', 156, 'ascii') // typeflag: regular file
  buf.write('ustar\0', 257, 'ascii')
  buf.write('00', 263, 'ascii')

  // The checksum is computed with its own field read as eight spaces, then
  // written into it. Getting this wrong produces an archive that this reader
  // accepts and `tar` rejects, which is the worst of both.
  buf.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of buf) sum += byte
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')

  return buf
}

/** Every file under `root`, as archive-relative POSIX paths, sorted. */
export function listFiles(root, prefix = '') {
  const out = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...listFiles(root, rel))
    else if (entry.isFile()) out.push(rel)
  }
  // Sorted, so the same archive twice over produces the same bytes and a
  // rebuilt release can be compared against the one before it.
  return out.sort()
}

/**
 * Pack `files` (relative to `root`) into a TAR buffer.
 *
 * Built in memory: the archive is 65 MB of CSV, which is large for a string
 * and unremarkable for a buffer, and streaming it would mean either a
 * dependency or a second implementation of what `Buffer.concat` already does.
 */
export function pack(root, files = listFiles(root)) {
  const parts = []

  for (const name of files) {
    const full = join(root, name.split(posix.sep).join(sep))
    const data = readFileSync(full)
    parts.push(header(name, data.length, statSync(full).mtimeMs), data)

    const padding = (BLOCK - (data.length % BLOCK)) % BLOCK
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }

  // Two zero blocks mark the end of an archive.
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function readOctal(buf, offset, width) {
  const text = buf.toString('ascii', offset, offset + width).replace(/[\0 ].*$/s, '')
  return text === '' ? 0 : parseInt(text, 8)
}

/**
 * Walk an unpacked TAR buffer, yielding `{ name, data }` for each regular file.
 *
 * Directory entries, which some writers include, are skipped: `extract`
 * creates the directories it needs anyway.
 */
export function* entries(buf) {
  let offset = 0

  while (offset + BLOCK <= buf.length) {
    const name = buf.toString('utf8', offset, offset + NAME_LIMIT).replace(/\0.*$/s, '')
    if (name === '') return // the end-of-archive blocks

    const bytes = readOctal(buf, offset + 124, 12)
    const type = buf.toString('ascii', offset + 156, offset + 157)
    const start = offset + BLOCK

    if (type === '0' || type === '\0') {
      yield { name, data: buf.subarray(start, start + bytes) }
    }

    offset = start + Math.ceil(bytes / BLOCK) * BLOCK
  }
}

/**
 * Write an archive's files under `target`.
 *
 * A path that climbs out of the target is refused rather than written. The
 * archives this reads are produced by this repository's own build, but an
 * extractor that follows `../..` wherever it is pointed is a hole whether or
 * not anybody is currently aiming at it.
 */
export function extract(buf, target) {
  let count = 0

  for (const { name, data } of entries(buf)) {
    if (name.startsWith('/') || name.split(posix.sep).includes('..')) {
      throw new Error(`Unerlaubter Pfad im Archiv: ${name}`)
    }

    const full = join(target, name.split(posix.sep).join(sep))
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, data)
    count++
  }

  return count
}
