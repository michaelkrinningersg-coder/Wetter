import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The daily cycle of a gauge, and the trap it is built to avoid.
 *
 * This module exists because the first version of the analysis reported a
 * daily cycle that was not there. The Weser fell by about one and a half
 * centimetres a day that summer, and each hour was compared against the mean
 * of its calendar day — a baseline that sits too low for the morning hours and
 * too high for the evening ones. Out came a clean sawtooth, high just after
 * midnight and low in the late afternoon, and it looked exactly like the
 * evapotranspiration signal one expects in a dry August.
 *
 * The first test below is that mistake, written down: a series with a pure
 * trend and no daily cycle whatsoever. Anything the analysis reports for it is
 * an artefact of the method.
 *
 * `server/gauge-cycle.js` reads `gauge_readings`, so this file writes there
 * directly — the ids are the real ones because `findGauge` only knows those.
 */

const db = await freshArchive()
// `gauges.js` mirrors the CSV archive into the database at import time, and
// the committed one grows by an hour every hour. Pointing it at an empty
// directory keeps these assertions about the fixtures and nothing else.
process.env.GAUGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'wetter-gauges-'))
await import('../server/gauges.js')
const { gaugeCycle } = await import('../server/gauge-cycle.js')

const GAUGE = 'weser-wahmbeck'

const insert = db.prepare(
  'INSERT OR REPLACE INTO gauge_readings (gauge_id, ts, value) VALUES (?, ?, ?)',
)
const write = db.transaction((rows) => {
  for (const row of rows) insert.run(GAUGE, row.ts, row.value)
})

const clear = () => db.prepare('DELETE FROM gauge_readings').run()

/** `days` days of quarter-hourly readings, level given by `level(day, fraction)`. */
function fill(days, level, { from = Date.UTC(2026, 5, 1) } = {}) {
  const rows = []
  for (let d = 0; d < days; d++) {
    const date = new Date(from + d * 86_400_000).toISOString().slice(0, 10)
    for (let q = 0; q < 96; q++) {
      const hour = String(Math.floor(q / 4)).padStart(2, '0')
      const minute = String((q % 4) * 15).padStart(2, '0')
      rows.push({
        // A fixed +02:00 offset, like the sources deliver in summer.
        ts: `${date}T${hour}:${minute}:00+02:00`,
        value: level(d, q / 96),
      })
    }
  }
  write(rows)
  return rows.length
}

const profileOf = (result, key) => result.splits.find((s) => s.key === key)

test('a falling level without any daily cycle produces no daily cycle', () => {
  clear()
  // 1.5 cm a day, exactly the slope the real Weser had when this went wrong.
  fill(33, (d, f) => 147 - 1.5 * (d + f))

  const all = profileOf(gaugeCycle(GAUGE), 'all')

  assert.equal(all.coveredHours, 24, 'every hour of the clock was measured')
  // The centred window removes a linear trend exactly; what is left is the
  // rounding of the arithmetic, not a rhythm. The calendar-day baseline this
  // replaced reported 1.44 cm here.
  assert.ok(
    all.amplitude < 0.05,
    `a pure trend must not become a cycle, got ${all.amplitude.toFixed(3)} cm`,
  )
})

test('a real cycle survives a trend of the same size', () => {
  clear()
  // The same fall, plus a genuine 2 cm sine with its low at 06:00.
  const cycle = (f) => -Math.cos((f - 0.25) * 2 * Math.PI)
  fill(33, (d, f) => 147 - 1.5 * (d + f) + cycle(f))

  const all = profileOf(gaugeCycle(GAUGE), 'all')

  // Peak to trough of -cos is 2, and the hourly means round the extremes off
  // a little; the point is that the size survives, not that it is exact.
  assert.ok(
    Math.abs(all.amplitude - 2) < 0.15,
    `expected about 2 cm, got ${all.amplitude.toFixed(3)}`,
  )
  assert.equal(all.lowHour, 6)
  assert.equal(all.highHour, 18)
})

test('hours report the days behind them, not just the readings', () => {
  clear()
  fill(4, () => 100)

  const all = profileOf(gaugeCycle(GAUGE), 'all')
  const noon = all.hours[12]

  // Four quarter-hours a day over four days — the two numbers differ by the
  // factor that would otherwise make a single day look like sixteen.
  assert.equal(noon.readings, 4)
  assert.equal(noon.days, 4)
  assert.equal(all.days, 4)
})

test('an hour whose surroundings are too thin is dropped, not guessed', () => {
  clear()
  // Three hours of a single morning: nothing here has a full day around it.
  write([
    { ts: '2026-06-01T08:00:00+02:00', value: 100 },
    { ts: '2026-06-01T09:00:00+02:00', value: 101 },
    { ts: '2026-06-01T10:00:00+02:00', value: 102 },
  ])

  const result = gaugeCycle(GAUGE)
  assert.equal(result.range.hours, 3)
  assert.equal(result.range.usableHours, 0)
  assert.equal(profileOf(result, 'all').days, 0)
  assert.equal(profileOf(result, 'all').amplitude, null)
})

test('a window skewed towards one hour does not tilt the baseline', () => {
  clear()
  fill(10, () => 100)
  // Twenty extra readings in a single hour, all far above the level. Weighted
  // per reading they would drag that day's baseline up and hand every other
  // hour a negative deviation; weighted per hour of the clock they move only
  // their own hour.
  const extra = []
  for (let i = 0; i < 20; i++) {
    extra.push({ ts: `2026-06-05T03:${String(i * 2).padStart(2, '0')}:00+02:00`, value: 200 })
  }
  write(extra)

  const all = profileOf(gaugeCycle(GAUGE), 'all')
  const untouched = all.hours.filter((h) => h.hour !== 3 && h.mean !== null)

  for (const hour of untouched) {
    assert.ok(
      Math.abs(hour.mean) < 0.6,
      `hour ${hour.hour} moved by ${hour.mean.toFixed(2)} cm although only 03:00 was loaded`,
    )
  }
})

test('weekday and weekend are split by the local calendar date', () => {
  clear()
  // 1 June 2026 is a Monday; seven days cover exactly one of each weekday.
  fill(7, () => 100)

  const result = gaugeCycle(GAUGE)
  assert.equal(profileOf(result, 'weekday').days, 5)
  assert.equal(profileOf(result, 'weekend').days, 2)
})

test('an unknown gauge is refused rather than answered emptily', () => {
  assert.equal(gaugeCycle('elbe-dresden'), null)
})

test('a single measured hour yields no amplitude, because a span needs two', () => {
  clear()
  // Enough readings for one hour to have a full day around it, but only that
  // one hour ever measured: max minus min over a single value is zero, and
  // reporting it as an amplitude would be a number without a measurement.
  const rows = []
  for (let d = 0; d < 3; d++) {
    for (let h = 0; h < 24; h++) {
      // Every hour exists so the window is complete, but only 12:00 survives
      // into the profile — the rest is removed afterwards.
      rows.push({ ts: `2026-06-0${d + 1}T${String(h).padStart(2, '0')}:00:00+02:00`, value: 100 })
    }
  }
  write(rows)
  db.prepare("DELETE FROM gauge_readings WHERE ts NOT LIKE '%T12:%'").run()

  const all = profileOf(gaugeCycle(GAUGE), 'all')
  assert.equal(all.coveredHours, 0, 'without a full window nothing is usable at all')
  assert.equal(all.amplitude, null)
})
