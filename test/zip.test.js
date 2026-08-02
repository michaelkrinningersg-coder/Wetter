import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'

import { listEntries, readEntry, readMatchingText } from '../server/zip.js'

/**
 * The ZIP reader exists so the scheduled workflow needs no dependency. It reads
 * bytes by hand, which is the kind of code that fails silently — a wrong offset
 * gives plausible-looking rubbish rather than an error. So the tests build
 * archives byte by byte too, and one of them has a comment containing the
 * end-of-directory signature, which is the trap the backwards scan is for.
 */

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50

/**
 * A minimal ZIP writer — the counterpart of the reader, written independently
 * from the format description rather than from the reader's source.
 */
function buildZip(files, comment = Buffer.alloc(0)) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'latin1')
    const raw = Buffer.from(file.content, 'latin1')
    const deflate = file.method === 8
    const data = deflate ? deflateRawSync(raw) : raw

    // The local header may carry an extra field the central one does not — the
    // real DWD archives do exactly that, and it is why the payload offset has
    // to be read here rather than guessed from the directory.
    const extra = file.extra ?? Buffer.alloc(0)
    const local = Buffer.alloc(30 + name.length + extra.length)
    local.writeUInt32LE(LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(0, 14) // crc32, which this reader does not check
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(extra.length, 28)
    name.copy(local, 30)
    extra.copy(local, 30 + name.length)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL, 0)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22 + comment.length)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  comment.copy(end, 22)

  return Buffer.concat([...locals, directory, end])
}

/* -------------------------------------------------------------------------- */

test('stored and deflated entries both come back unchanged', () => {
  const text = 'STATIONS_ID;MESS_DATUM;TXK\n1691;19580101;-3.4\n'.repeat(40)
  const zip = buildZip([
    { name: 'produkt_klima_tag_1691.txt', content: text, method: 8 },
    { name: 'Metadaten_Stationsname.txt', content: 'Göttingen', method: 0 },
  ])

  const entries = listEntries(zip)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'produkt_klima_tag_1691.txt')
  assert.equal(entries[0].method, 8)
  assert.equal(entries[1].method, 0)
  assert.ok(entries[0].compressedSize < entries[0].size, 'der Text muss sich komprimieren lassen')

  assert.equal(readEntry(zip, entries[0]).toString('latin1'), text)
  assert.equal(readEntry(zip, entries[1]).toString('latin1'), 'Göttingen')
})

test('the end-of-directory record is found even when the comment contains its signature', () => {
  // A comment whose bytes look like the record itself: scanning forwards would
  // stop at the fake one and read a directory of nothing.
  const trap = Buffer.alloc(8)
  trap.writeUInt32LE(EOCD, 0)
  const zip = buildZip([{ name: 'a.txt', content: 'eins', method: 0 }], trap)

  const entries = listEntries(zip)
  assert.equal(entries.length, 1)
  assert.equal(readEntry(zip, entries[0]).toString('latin1'), 'eins')
})

test('the data offset comes from the local header, not from the directory', () => {
  // An extra field in the local header and none in the central one. Adding the
  // directory's name length to its offset would land inside the extra field
  // and return the payload shifted by nine bytes.
  const extra = Buffer.from([0x55, 0x54, 0x05, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
  const zip = buildZip([
    { name: 'erste.txt', content: 'eins', method: 0, extra },
    { name: 'zweite.txt', content: 'zwei', method: 8, extra },
  ])

  const entries = listEntries(zip)
  assert.equal(entries.length, 2)
  assert.equal(readEntry(zip, entries[0]).toString('latin1'), 'eins')
  assert.equal(readEntry(zip, entries[1]).toString('latin1'), 'zwei')
})

test('an unsupported compression method raises instead of returning rubbish', () => {
  const zip = buildZip([{ name: 'c.txt', content: 'drei', method: 0 }])
  const entry = { ...listEntries(zip)[0], method: 12 }
  assert.throws(() => readEntry(zip, entry), /Verfahren 12/)
})

test('a file that is not an archive raises with a readable message', () => {
  assert.throws(() => listEntries(Buffer.from('Dies ist kein ZIP-Archiv.')), /End-of-Central/)
})

test('readMatchingText picks the first entry matching the pattern', () => {
  const zip = buildZip([
    { name: 'Metadaten_Geographie.txt', content: 'Höhe', method: 0 },
    { name: 'produkt_klima_tag.txt', content: 'MESS_DATUM', method: 8 },
  ])
  assert.equal(readMatchingText(zip, /^produkt/), 'MESS_DATUM')
  assert.equal(readMatchingText(zip, /nicht_vorhanden/), null)
})
