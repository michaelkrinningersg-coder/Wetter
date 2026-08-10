import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * Long windows in the gauge chart.
 *
 * Below a year every reading travels to the browser, as it always did. From a
 * year on that would be about 35,000 points for the Weser, so the answer
 * collapses to one row per day — and the thing worth testing is that the
 * collapse keeps the extremes. Thinning to every n-th reading would produce a
 * chart that looks better than the river behaved; the assertions below are
 * what stops that from creeping back in.
 */

const db = await freshArchive()
process.env.GAUGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'wetter-gauges-'))
const { DAILY_FROM_DAYS, findGauge, gaugeSeries } = await import('../server/gauges.js')

const gauge = findGauge('weser-wahmbeck')

const insert = db.prepare(
  'INSERT OR REPLACE INTO gauge_readings (gauge_id, ts, value) VALUES (?, ?, ?)',
)
const write = db.transaction((rows) => {
  for (const row of rows) insert.run(gauge.id, row.ts, row.value)
})
const clear = () => db.prepare('DELETE FROM gauge_readings').run()

/** Readings on the given day at the given hours. */
const onDay = (date, values) =>
  values.map((value, i) => ({
    ts: `${date}T${String(i).padStart(2, '0')}:00:00+02:00`,
    value,
  }))

test('a short window keeps every reading', () => {
  clear()
  const today = new Date().toISOString().slice(0, 10)
  write(onDay(today, [100, 120, 110]))

  const series = gaugeSeries(gauge, 7)
  assert.equal(series.mode, 'readings')
  assert.equal(series.readings.length, 3)
  assert.equal(series.daily.length, 0)
})

test('a long window keeps the extremes of every day, not a sample of them', () => {
  clear()
  // A single spike in the middle of an otherwise flat day: the value that a
  // thinned series would be most likely to drop, and the one a flood is made
  // of.
  const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
  write(onDay(day, [100, 100, 100, 100, 601, 100, 100, 100]))

  const series = gaugeSeries(gauge, DAILY_FROM_DAYS)
  assert.equal(series.mode, 'daily')
  assert.equal(series.readings.length, 0)

  const row = series.daily.find((d) => d.date === day)
  assert.equal(row.max, 601, 'der Scheitel muss die Verdichtung überleben')
  assert.equal(row.min, 100)
  assert.equal(row.count, 8)
  assert.ok(Math.abs(row.mean - (7 * 100 + 601) / 8) < 1e-9)
})

test('a day with one reading reports it as lowest, mean and highest alike', () => {
  clear()
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
  write(onDay(day, [42]))

  const row = gaugeSeries(gauge, null).daily.find((d) => d.date === day)
  // The view leans on `count` to decide whether "42 bis 42 cm" is a measured
  // range or a single reading wearing three hats.
  assert.deepEqual(
    { min: row.min, mean: row.mean, max: row.max, count: row.count },
    { min: 42, mean: 42, max: 42, count: 1 },
  )
})

test('null means the whole archive, however far back it reaches', () => {
  clear()
  const old = '2019-03-07'
  write([...onDay(old, [55]), ...onDay(new Date().toISOString().slice(0, 10), [60])])

  // A year would not reach 2019; the archive does.
  assert.equal(gaugeSeries(gauge, 365).daily.length, 1)
  assert.equal(gaugeSeries(gauge, null).daily.length, 2)
  assert.equal(gaugeSeries(gauge, null).daily[0].date, old)
})

test('the boundary belongs to the daily mode', () => {
  clear()
  write(onDay(new Date().toISOString().slice(0, 10), [1, 2]))

  assert.equal(gaugeSeries(gauge, DAILY_FROM_DAYS - 1).mode, 'readings')
  assert.equal(gaugeSeries(gauge, DAILY_FROM_DAYS).mode, 'daily')
})
