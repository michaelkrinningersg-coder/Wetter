import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { entries, extract, listFiles, pack } from '../server/tar.js'

/**
 * The archive the installer carries.
 *
 * Two things have to hold. The obvious one is that what goes in comes out —
 * 4,669 CSV files, several of them megabytes, some of them holding characters
 * that are not ASCII. The less obvious one is that the result is a real TAR:
 * the format is easy to write *almost* correctly, and an archive that only
 * this reader accepts would quietly stop being the thing that makes the
 * shipped data recoverable by anybody but this program.
 */

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wetter-tar-'))
  mkdirSync(join(root, 'germany', '2026'), { recursive: true })
  mkdirSync(join(root, 'soil'), { recursive: true })

  writeFileSync(join(root, 'germany', '2026', '2026-08-01.csv'), 'date;temp\n2026-08-01;21.4\n')
  // Long enough to cross several 512-byte blocks, and deliberately not a
  // multiple of one.
  writeFileSync(join(root, 'germany', 'stations.csv'), 'x'.repeat(1500))
  writeFileSync(join(root, 'soil', 'moisture.csv'), 'Göttingen;43,1;südlich\n')
  // A file whose length is exactly a block: the padding arithmetic is off by
  // one whole block if `% 512 === 0` is handled as a special case wrongly.
  writeFileSync(join(root, 'soil', 'temperature.csv'), 'y'.repeat(512))
  return root
}

test('every file survives packing and unpacking', () => {
  const root = fixture()
  const target = mkdtempSync(join(tmpdir(), 'wetter-tar-out-'))

  const count = extract(pack(root), target)

  assert.equal(count, 4)
  assert.equal(
    readFileSync(join(target, 'germany', '2026', '2026-08-01.csv'), 'utf8'),
    'date;temp\n2026-08-01;21.4\n',
  )
  assert.equal(readFileSync(join(target, 'germany', 'stations.csv'), 'utf8').length, 1500)
  // Non-ASCII has to come back byte for byte, not as question marks: the
  // station names and the wording in the archives are German.
  assert.equal(
    readFileSync(join(target, 'soil', 'moisture.csv'), 'utf8'),
    'Göttingen;43,1;südlich\n',
  )
  assert.equal(readFileSync(join(target, 'soil', 'temperature.csv'), 'utf8').length, 512)
})

test('the file list is sorted, so the same archive twice is the same bytes', () => {
  const root = fixture()
  assert.deepEqual(listFiles(root), [
    'germany/2026/2026-08-01.csv',
    'germany/stations.csv',
    'soil/moisture.csv',
    'soil/temperature.csv',
  ])
  assert.ok(pack(root).equals(pack(root)))
})

test('a path that climbs out of the target is refused, not written', () => {
  const buf = pack(fixture())
  // Rewrite the first entry's name in place, keeping its length, and repair
  // the checksum the way a hostile archive would.
  const evil = Buffer.from(buf)
  evil.fill(0, 0, 100)
  evil.write('../escaped.csv', 0, 'utf8')
  evil.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += evil[i]
  evil.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')

  const target = mkdtempSync(join(tmpdir(), 'wetter-tar-evil-'))
  assert.throws(() => extract(evil, target), /Unerlaubter Pfad/)
})

test('a path longer than the ustar name field is refused rather than truncated', () => {
  const root = mkdtempSync(join(tmpdir(), 'wetter-tar-long-'))
  const deep = join(root, 'a'.repeat(60), 'b'.repeat(60))
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'c.csv'), 'x')

  // Truncating would produce an archive that unpacks to the wrong place —
  // worse than one that fails to build.
  assert.throws(() => pack(root), /Pfad zu lang/)
})

test('the header is one a real tar accepts', (t) => {
  const root = fixture()
  const file = join(mkdtempSync(join(tmpdir(), 'wetter-tar-real-')), 'a.tar')
  writeFileSync(file, pack(root))

  let listing
  try {
    listing = execFileSync('tar', ['-tf', file], { encoding: 'utf8' })
  } catch (error) {
    // No `tar` on this machine — the round trip above still ran.
    if (error.code === 'ENOENT') return t.skip('kein tar vorhanden')
    throw error
  }

  const names = listing.trim().split('\n').sort()
  assert.deepEqual(names, listFiles(root))

  // And the contents, not just the names: a wrong size field lists fine and
  // extracts garbage.
  const shown = execFileSync('tar', ['-xOf', file, 'soil/moisture.csv'], { encoding: 'utf8' })
  assert.equal(shown, 'Göttingen;43,1;südlich\n')
})

test('the end-of-archive blocks stop the walk', () => {
  const buf = pack(fixture())
  // Two zero blocks at the end, and nothing yielded from them.
  assert.ok(buf.subarray(buf.length - 1024).every((b) => b === 0))
  assert.equal([...entries(buf)].length, 4)
})
