import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The replay, end to end: baseline plus daily archive, out come places.
 *
 * `record-ranks.test.js` pins the arithmetic. This pins what the arithmetic is
 * wired to — and in particular the one rule that silently decides what the
 * page may show at all: a series is only read as deep as its own length
 * justifies. Getting that wrong produces a page that looks right and puts a
 * station measuring since 2020 beside one measuring since 1781.
 */

const db = await freshArchive()

// Both the baseline and the day list come out of this directory, so it has to
// be named before `records.js` prepares anything against it.
const dir = mkdtempSync(join(tmpdir(), 'wetter-records-'))
process.env.GERMANY_DATA_DIR = dir

const CUTOFF = '2025-01-27'
const DAY = '2025-06-01'

// `listDays` needs a day file to derive the cutoff from; its contents are
// irrelevant here because the rows are seeded straight into the table.
mkdirSync(join(dir, '2025'), { recursive: true })
writeFileSync(join(dir, '2025', `${CUTOFF}.csv`), 'station_id,temp_max\n', 'utf8')

/**
 * Three stations, identical histories, different lengths.
 *
 * Each holds the same ten best values, so any difference in what comes out is
 * the length rule and nothing else.
 */
const TOP_TEN = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21]

const STATIONS = [
  { id: 'LANG', years: 240, name: 'Lange Reihe' },
  { id: 'MITTE', years: 30, name: 'Mittlere Reihe' },
  { id: 'KURZ', years: 12, name: 'Kurze Reihe' },
  { id: 'NEU', years: 3, name: 'Neue Reihe' },
]

const baseline = ['# Stichtag ' + CUTOFF, 'station,kind,rank,value,date,since,days']
for (const station of STATIONS) {
  for (const [index, value] of TOP_TEN.entries()) {
    baseline.push(
      [
        station.id,
        'temp_max',
        index + 1,
        value,
        '2000-07-0' + ((index % 9) + 1),
        '1900-01-01',
        Math.round(station.years * 365.25),
      ].join(','),
    )
  }
}
writeFileSync(join(dir, 'records-baseline.csv'), baseline.join('\n') + '\n', 'utf8')

// Imported before the statements below are prepared: `records.js` pulls in
// `germany.js`, and that is what creates the two tables they name.
const { buildEvents, recordsForDate, recordDays } = await import('../server/records.js')

const insertStation = db.prepare(`
  INSERT OR REPLACE INTO germany_stations (id, network, name, state, lat, lon, elevation)
  VALUES (?, 'kl', ?, 'Testland', 51, 10, 100)
`)
const insertDay = db.prepare(
  'INSERT OR REPLACE INTO germany_daily (date, station_id, temp_max) VALUES (?, ?, ?)',
)

for (const station of STATIONS) insertStation.run(station.id, station.name)

/** Give every station the same value on the test day and replay. */
function replay(value) {
  db.prepare('DELETE FROM germany_daily').run()
  for (const station of STATIONS) insertDay.run(DAY, station.id, value)
  buildEvents({ force: true })
  return recordsForDate(DAY, 10)
}

/* -------------------------------------------------------------------------- */

test('a fourth place appears only for a series long enough to have one', () => {
  // Three values are better than 27.5 — 30, 29 and 28 — so it takes fourth
  // place and pushes 27 down.
  const events = replay(27.5)
  const byStation = new Map(events.map((e) => [e.station_id, e]))

  assert.equal(byStation.get('LANG')?.rank, 4, '240 Jahre dürfen bis Platz 10')
  assert.equal(byStation.get('MITTE')?.rank, 4, '30 Jahre dürfen bis Platz 5')

  // Twelve years reach third place at most, and this is a fourth — so the
  // station does not appear at all rather than appearing with a place it is
  // not entitled to.
  assert.equal(byStation.has('KURZ'), false, 'zwölf Jahre reichen nur bis Platz 3')
  assert.equal(byStation.has('NEU'), false, 'drei Jahre reichen nur bis Platz 1')
})

test('a record is a record whatever the series is worth', () => {
  const events = replay(31)
  assert.equal(events.length, STATIONS.length, 'Platz 1 steht jeder Reihe offen')
  for (const event of events) {
    assert.equal(event.rank, 1)
    assert.equal(event.previous, 30, 'verdrängt wird der bisherige Bestwert')
    assert.equal(event.shared, false)
  }
})

test('equalling a value shares its place and says so', () => {
  const events = replay(28)
  const long = events.find((e) => e.station_id === 'LANG')

  assert.equal(long.rank, 3, '28 ist der drittbeste Wert, also Platz 3')
  assert.equal(long.shared, true, 'gleicher Wert, kein verdrängter')
  assert.equal(long.previous, 28)
  // The station's own best stays visible next to the near miss, or a third
  // place is a number without a scale.
  assert.equal(long.best, 30)
})

test('a sixth place needs fifty years, and a fifth needs twenty', () => {
  // Five better values (30, 29, 28, 27, 26) put 25.5 in sixth place.
  const sixth = new Map(replay(25.5).map((e) => [e.station_id, e]))
  assert.equal(sixth.get('LANG')?.rank, 6)
  assert.equal(sixth.has('MITTE'), false, '30 Jahre reichen nicht bis Platz 6')

  // One value less in the way, and it is a fifth place — which thirty years
  // still reach.
  const fifth = new Map(replay(26.5).map((e) => [e.station_id, e]))
  assert.equal(fifth.get('MITTE')?.rank, 5)
  assert.equal(fifth.has('KURZ'), false)
})

test('a value that reaches nothing produces nothing', () => {
  const events = replay(5)
  assert.deepEqual(events, [], 'weit unter dem zehntbesten Wert')
  assert.deepEqual(recordDays(400, 10), [], 'und der Tag taucht in der Liste nicht auf')
})

test('the day list follows the level it is asked for', () => {
  replay(27.5) // two fourth places, no records

  assert.deepEqual(recordDays(400, 1), [], 'auf Rekordebene ist der Tag leer')
  assert.equal(recordDays(400, 3).length, 0, 'und bis Platz 3 ebenfalls')

  const deep = recordDays(400, 5)
  assert.equal(deep.length, 1)
  assert.equal(deep[0].date, DAY)
  assert.equal(deep[0].count, 2)
  assert.equal(deep[0].best, 4, 'der höchste an diesem Tag erreichte Platz')
})
