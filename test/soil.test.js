import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The soil archive and what is asked of it.
 *
 * Two things here can be wrong without looking wrong. The first is the
 * comparison: "43 % of usable field capacity" is alarming in April and
 * ordinary in August, so the percentile has to be taken against the same time
 * of year and nothing else — a percentile against the whole archive would call
 * every August dry and every March wet, in every year, forever.
 *
 * The second is the merge. These files are rewritten whole because the DWD
 * revises days it has already published; a revision that appended instead of
 * replacing would leave two rows for one day, and no reader of the file could
 * say which one counts.
 */

const db = await freshArchive()
const soilDir = mkdtempSync(join(tmpdir(), 'wetter-soil-'))
process.env.SOIL_DATA_DIR = soilDir

const { readSoil, writeSoil, soilRange } = await import('../server/soil-csv.js')

/**
 * A whole archive of invented days.
 *
 * `bf_total` is a sawtooth over the year plus a per-year offset, so the same
 * calendar day differs between years by a known amount and a percentile has
 * something to rank.
 */
function inventedMoisture(years, total) {
  const rows = []
  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
      for (let day = 1; day <= last; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        rows.push({
          bf_0_10: 50,
          bf_10_20: 50,
          bf_20_30: 50,
          bf_30_40: 50,
          bf_40_50: 50,
          bf_50_60: 50,
          bf_total: total(year, month, day),
          evap_potential: 2,
          evap_real: 1,
          frost_depth: 0,
          date,
        })
      }
    }
  }
  return rows
}

const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

// Each year is flat at its own level: 2016 lowest, 2025 highest. The percentile
// of a given year is then known in advance.
writeSoil('moisture', inventedMoisture(YEARS, (year) => (year - 2015) * 10))

/**
 * Soil temperature with a deliberate damping and delay between two depths, so
 * the annual cycle has something to find.
 */
const temperatureRows = []
for (const year of YEARS) {
  for (let month = 1; month <= 12; month++) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    for (let day = 1; day <= last; day++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const doy = Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000,
      )
      const wave = (amplitude, shiftDays) =>
        10 + (amplitude / 2) * -Math.cos(((doy - shiftDays) / 365) * 2 * Math.PI)
      temperatureRows.push({
        date,
        t_2: null,
        t_5: wave(20, 0),
        t_10: wave(20, 0),
        t_20: wave(18, 0),
        // Half the amplitude and thirty days late: the thing the view claims
        // depth does to a year.
        t_50: wave(10, 30),
      })
    }
  }
}
writeSoil('temperature', temperatureRows)

const { percentile, soilOverview } = await import('../server/soil.js')

/* -------------------------------------------------------------------------- */

test('the archive survives a round trip, missing values included', () => {
  const rows = readSoil('temperature')
  assert.equal(rows.length, temperatureRows.length)
  // An empty cell has to come back as null, not as zero — a soil at 0 °C and a
  // soil nobody measured are not the same statement.
  assert.equal(rows[0].t_2, null)
  assert.ok(Math.abs(rows[0].t_5 - temperatureRows[0].t_5) < 1e-9)
})

test('a revised day replaces its predecessor instead of joining it', () => {
  const before = soilRange('moisture').days
  const day = '2020-06-15'

  writeSoil('moisture', [{ date: day, bf_total: 999 }])

  const after = readSoil('moisture')
  assert.equal(after.length, before, 'die Zahl der Tage darf sich nicht ändern')
  assert.equal(after.filter((r) => r.date === day).length, 1)
  assert.equal(after.find((r) => r.date === day).bf_total, 999)
  // Columns the revision did not mention become null rather than keeping a
  // stale value from a superseded row.
  assert.equal(after.find((r) => r.date === day).bf_0_10, null)

  // Put the fixture back so the later assertions rank the years they expect.
  writeSoil('moisture', [
    inventedMoisture([2020], (year) => (year - 2015) * 10).find((r) => r.date === day),
  ])
})

test('the comparison is taken against the same time of year, not the whole archive', () => {
  const overview = soilOverview({ days: 400 })
  const today = overview.moisture.today

  // 2025 is the wettest of the ten years, and every year is flat, so the last
  // day sits at the top of its calendar window whatever the season.
  assert.equal(today.total, 100)
  assert.ok(today.percentile > 90, `erwartet über 90, war ${today.percentile}`)

  // Fifteen calendar days times ten years, minus the days after the archive
  // ends: the window is the point, and it has to be visibly wider than one
  // date.
  assert.ok(today.samples > 100, `zu wenige Vergleichstage: ${today.samples}`)
})

test('ties count half, so a value matched by everything sits in the middle', () => {
  // The trap this avoids: counting only strictly-smaller comparisons puts a
  // value that every year matched at 0 %, and the view would call a perfectly
  // ordinary soil "außergewöhnlich trocken".
  assert.equal(percentile([60, 60, 60, 60], 60), 50)

  // The ordinary cases still have to come out right.
  assert.equal(percentile([1, 2, 3, 4], 5), 100)
  assert.equal(percentile([1, 2, 3, 4], 0), 0)
  assert.equal(percentile([0, 10], 10), 75)
  assert.equal(percentile([], 5), null)
})

test('depth damps the year and delays it', () => {
  const overview = soilOverview({ days: 400 })
  const byKey = Object.fromEntries(overview.temperature.cycles.map((c) => [c.key, c]))

  assert.ok(Math.abs(byKey.t_5.amplitude - 20) < 1.5, `5 cm: ${byKey.t_5.amplitude}`)
  assert.ok(Math.abs(byKey.t_50.amplitude - 10) < 1.5, `50 cm: ${byKey.t_50.amplitude}`)

  const dayOf = (md) =>
    Math.round(
      (Date.UTC(2024, Number(md.slice(0, 2)) - 1, Number(md.slice(3))) - Date.UTC(2024, 0, 1)) /
        86_400_000,
    )
  const lag = dayOf(byKey.t_50.peak) - dayOf(byKey.t_5.peak)
  assert.ok(Math.abs(lag - 30) <= 4, `erwartete Verzögerung 30 Tage, gemessen ${lag}`)
})

test('a depth nobody staffed reports no cycle rather than an invented one', () => {
  const overview = soilOverview({ days: 400 })
  const two = overview.temperature.cycles.find((c) => c.key === 't_2')

  // Every row carries null for 2 cm, so there is nothing to average and the
  // view filters the depth out by its sample count.
  assert.equal(two.amplitude, null)
  assert.equal(two.samples, 0)
})

test('the evaporation months are daily means, so a short month is not a dry one', () => {
  const overview = soilOverview({ days: 400 })
  for (const month of overview.evaporation.monthly) {
    assert.ok(Math.abs(month.potential - 2) < 1e-9, `${month.month}: ${month.potential}`)
    assert.ok(Math.abs(month.real - 1) < 1e-9)
    assert.ok(Math.abs(month.deficit - 1) < 1e-9)
  }
  // February is the shortest month and must not look different for it.
  const february = overview.evaporation.monthly.find((m) => m.month === 2)
  assert.ok(february.days < overview.evaporation.monthly.find((m) => m.month === 1).days)
})

test('the database mirrors the archive', () => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM soil_moisture').get().n
  assert.equal(n, soilRange('moisture').days)
})

test('the rank among years counts from the dry end and shares ties', () => {
  const standing = soilOverview({ days: 400 }).moisture.today.sameDate

  // Ten years, each flat at its own level, 2025 the wettest: the last day is
  // the wettest of its date, so tenth from the dry end.
  assert.equal(standing.years, 10)
  assert.equal(standing.place, 10)
  assert.equal(standing.drier, 9)
  assert.equal(standing.wetter, 0)
  assert.equal(standing.driest, 10)
  assert.equal(standing.wettest, 100)
})

test('the narrow and the wide comparison agree on the direction', () => {
  const today = soilOverview({ days: 400 }).moisture.today

  // They must not be the same number — one ranks 10 years, the other about
  // 150 days — but a value in the driest third of one cannot sit in the
  // wettest third of the other, or one of the two is measuring something else.
  assert.ok(today.percentile > 50)
  assert.ok(today.sameDate.percentile > 50)
})
