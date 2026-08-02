import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The eight-hour mean for ozone is the one figure here that a day cannot
 * compute on its own: the window runs across midnight, so the highest value of
 * a day may begin the evening before. Two things then have to hold — the window
 * is eight *consecutive* hours, and it is credited to the day it ends on. Both
 * are invisible in the output if they break.
 */

const db = await freshArchive()
const { buildDaily, maxEightHourMeans } = await import('../server/air.js')

const STATION = 'DETEST1'

/** Hourly rows, one per entry, missing fields stored as NULL. */
function seedHours(rows) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO air_hourly (station, date, hour, pm10, pm25, o3, no2, so2, co_8h)
    VALUES (@station, @date, @hour, @pm10, @pm25, @o3, @no2, @so2, @co_8h)
  `)
  const write = db.transaction((list) => {
    for (const row of list) {
      insert.run({
        station: STATION,
        pm10: null,
        pm25: null,
        o3: null,
        no2: null,
        so2: null,
        co_8h: null,
        ...row,
      })
    }
  })
  write(rows)
}

const hours = (date, values) => values.map((o3, hour) => ({ date, hour, o3 }))

test('the eight-hour window may span midnight and belongs to the day it ends on', () => {
  // Twenty flat hours, then a peak in the last hours of 2 January that only a
  // window reaching back into 1 January can catch at its full height.
  const first = hours('2020-01-01', Array.from({ length: 24 }, (_, h) => (h >= 20 ? 200 : 40)))
  const second = hours('2020-01-02', Array.from({ length: 24 }, (_, h) => (h < 4 ? 200 : 40)))

  const means = maxEightHourMeans([...first, ...second])
  // The window 20:00–03:00 is eight hours of 200 µg/m³ and ends on the 2nd.
  assert.equal(means.get('2020-01-02'), 200, 'das Fenster über Mitternacht fehlt')
  // The 1st can only reach a mixture, because its peak had just begun.
  assert.ok(means.get('2020-01-01') < 200, 'der 1. darf den Wert des 2. nicht bekommen')
})

test('a gap in the hourly series is not closed by pretending the hours adjoin', () => {
  // Four hours, an eight-hour hole, four hours. Naively concatenated these
  // eight readings would look like a window and report a mean of 300.
  const before = [0, 1, 2, 3].map((hour) => ({ date: '2020-02-01', hour, o3: 300 }))
  const after = [12, 13, 14, 15].map((hour) => ({ date: '2020-02-01', hour, o3: 300 }))

  const means = maxEightHourMeans([...before, ...after])
  assert.equal(means.get('2020-02-01'), undefined, 'über eine Messlücke gibt es kein Achtstundenmittel')
})

test('a day rolled up from hourly readings keeps mean, maximum and hour count apart', () => {
  // One row per hour carrying both quantities: two passes would replace each
  // other, since the hour is the key.
  seedHours(
    Array.from({ length: 24 }, (_, hour) => ({
      date: '2021-06-01',
      hour,
      o3: 50 + hour,
      no2: hour === 12 ? 210 : 20,
    })),
  )
  buildDaily()

  const day = db
    .prepare('SELECT * FROM air_daily WHERE station = ? AND date = ?')
    .get(STATION, '2021-06-01')
  assert.ok(day, 'kein Tageswert gebildet')
  assert.equal(day.o3_hours, 24)
  assert.equal(day.o3_max, 73, 'das Maximum ist der höchste Stundenwert')
  assert.ok(Math.abs(day.o3_mean - 61.5) < 1e-9, `Tagesmittel ${day.o3_mean}`)
  assert.equal(day.no2_max, 210, 'eine einzelne Spitzenstunde bleibt sichtbar')
  assert.ok(day.no2_mean < 30, 'und verschwindet im Tagesmittel')
})

test('a day with too few measured hours gets no mean, but keeps its maximum', () => {
  seedHours(
    [4, 5, 6].map((hour) => ({ date: '2021-07-01', hour, o3: 100 })),
  )
  buildDaily()

  const day = db
    .prepare('SELECT * FROM air_daily WHERE station = ? AND date = ?')
    .get(STATION, '2021-07-01')
  assert.equal(day.o3_hours, 3)
  assert.equal(day.o3_mean, null, 'aus drei Stunden entsteht kein Tagesmittel')
  assert.equal(day.o3_max, 100, 'der höchste gemessene Wert bleibt trotzdem stehen')
  assert.equal(day.o3_max8h, null, 'und ein Achtstundenmittel erst recht nicht')
})

test('the weekday is counted from Monday, so a chart needs no special case', () => {
  // 1 March 2021 was a Monday.
  seedHours(hours('2021-03-01', Array.from({ length: 24 }, () => 40)))
  seedHours(hours('2021-03-07', Array.from({ length: 24 }, () => 40)))
  buildDaily()

  const monday = db.prepare('SELECT weekday FROM air_daily WHERE date = ?').get('2021-03-01')
  const sunday = db.prepare('SELECT weekday FROM air_daily WHERE date = ?').get('2021-03-07')
  assert.equal(monday.weekday, 0)
  assert.equal(sunday.weekday, 6)
})
