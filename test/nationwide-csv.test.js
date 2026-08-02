import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  COLUMNS,
  HEADER,
  formatRow,
  listYears,
  readAll,
  readStations,
  readYear,
  writeAll,
  writeStations,
} from '../server/nationwide-csv.js'

/**
 * The one-off pass over 1.28 million station-days writes its result into
 * committed CSV files, and the app reads them back for ever after. A round trip
 * that loses a column, or reads a null as a zero, would be invisible in the
 * views — a missing lapse rate and a lapse rate of nought look the same in a
 * chart, and only one of them is true.
 */

const dir = mkdtempSync(join(tmpdir(), 'wetter-nationwide-'))

/**
 * One day of every column the archive knows.
 *
 * Each value is chosen to survive its own column's rounding: the station count
 * is whole, and every measured column carries three decimals, which is the
 * finest any of them keeps.
 */
function fullRow(date, overrides = {}) {
  const row = { date }
  for (const column of COLUMNS) {
    if (column.key === 'date') continue
    if (column.key.endsWith('Station')) row[column.key] = `S-${date}`
    else if (column.digits === 0) row[column.key] = 42
    else row[column.key] = 1.5
  }
  return { ...row, ...overrides }
}

test('a row survives the round trip with every column intact', () => {
  const rows = [fullRow('1936-01-01'), fullRow('1936-06-15'), fullRow('1937-02-02')]
  writeAll(rows, dir)

  // The years come back as the four characters the filename carried; they are
  // only ever used to build paths and to form a cache signature.
  assert.deepEqual(listYears(dir), ['1936', '1937'])
  const back = readAll(dir)
  assert.equal(back.length, 3)

  for (const [at, row] of back.entries()) {
    for (const column of COLUMNS) {
      const before = rows[at][column.key]
      const after = row[column.key]
      assert.deepEqual(after, before, `${column.key} kam als ${after} zurück statt ${before}`)
    }
  }
})

test('an absent value comes back as null, not as nought', () => {
  const rows = [fullRow('1940-03-03', { lapse: null, lapseR2: null, absHi: null })]
  writeAll(rows, dir)

  const [back] = readYear(1940, dir)
  assert.equal(back.lapse, null, 'ein fehlender Gradient darf nicht zu null werden')
  assert.equal(back.lapseR2, null)
  assert.equal(back.absHi, null)
  assert.notEqual(back.gradN, null, 'die übrigen Spalten bleiben erhalten')
})

test('the header names every column, in order', () => {
  const written = readFileSync(join(dir, '1936.csv'), 'utf8').split('\n')
  assert.equal(written[0], HEADER)
  assert.deepEqual(HEADER.split(','), COLUMNS.map((c) => c.key))
})

test('a row is written as one line and reads back the same way', () => {
  // 3.25 is written with one decimal, because that is what the column declares
  // — the archive stores what the views show and not a digit more.
  const row = fullRow('1950-12-24', { meanHi: 3.25, meanHiStation: 'X 1' })
  const line = formatRow(row)
  assert.equal(line.includes('\n'), false, 'eine Zeile darf keinen Zeilenumbruch enthalten')
  writeFileSync(join(dir, '1950.csv'), `${HEADER}\n${line}\n`)

  const [back] = readYear(1950, dir)
  assert.equal(back.date, '1950-12-24')
  assert.equal(back.meanHi, 3.3, 'die Spalte ist auf eine Nachkommastelle festgelegt')
  assert.equal(back.meanHiStation, 'X 1')
})

test('the station register keeps its columns and its numbers', () => {
  const stations = [
    { id: '01691', name: 'Göttingen', state: 'Niedersachsen', lat: 51.5, lon: 9.95, elevation: 167, from: '1936-01-01', until: '2026-07-31' },
    { id: '05792', name: 'Zugspitze', state: 'Bayern', lat: 47.42, lon: 10.98, elevation: 2964, from: '1936-01-01', until: '2026-07-31' },
  ]
  writeStations(stations, dir)

  const back = readStations(dir)
  assert.equal(back.length, 2)
  assert.equal(back[0].id, '01691')
  assert.equal(back[0].elevation, 167)
  assert.equal(back[1].name, 'Zugspitze')
  assert.equal(typeof back[1].lat, 'number')
})

test('a year that was never written is an empty list, not an error', () => {
  assert.deepEqual(readYear(1899, dir), [])
})
