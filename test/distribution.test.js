import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The distribution view compares three reference periods as whole shapes. Two
 * things in it can be wrong without looking wrong: the quantile interpolation,
 * and the alignment of the three band lists onto one axis.
 */

const db = await freshArchive()
const { PERIODS, distributionFor, thresholdShift } = await import('../server/distribution.js')

/**
 * Three complete reference periods, each flat but offset: 1931–1960 runs one
 * degree below 1961–1990, which runs two below 1991–2020. Every quantile of the
 * later period must therefore sit exactly that far to the right.
 */
function threePeriods(station, offsets) {
  const rows = []
  for (const period of PERIODS) {
    const shift = offsets[period.key] ?? 0
    for (let year = period.from; year <= period.to; year++) {
      for (const date of days(`${year}-01-01`, `${year}-12-31`)) {
        // A sawtooth over the year gives the distribution a real spread.
        const doy = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000)
        rows.push({
          date,
          temp_mean: 10 + 10 * Math.sin((doy / 365) * 2 * Math.PI) + shift,
          temp_max: 14 + 10 * Math.sin((doy / 365) * 2 * Math.PI) + shift,
          temp_min: 6 + 10 * Math.sin((doy / 365) * 2 * Math.PI) + shift,
          precipitation: 2,
        })
      }
    }
  }
  seed(db, station, rows)
}

test('a period shifted by a constant shifts every quantile by the same amount', () => {
  const [first, , third] = PERIODS
  threePeriods('SHIFT', { [first.key]: 0, [PERIODS[1].key]: 1, [third.key]: 3 })

  const result = distributionFor('SHIFT', 'temp_mean')
  assert.ok(result, 'drei vollständige Perioden müssen reichen')
  assert.equal(result.periods.length, 3)

  const early = result.periods.find((p) => p.key === first.key)
  const late = result.periods.find((p) => p.key === third.key)
  for (const [at, entry] of late.quantiles.entries()) {
    const before = early.quantiles[at]
    assert.equal(entry.p, before.p)
    assert.ok(
      Math.abs(entry.value - before.value - 3) < 0.05,
      `Perzentil ${entry.p}: ${before.value} → ${entry.value}`,
    )
  }
  assert.ok(Math.abs(late.mean - early.mean - 3) < 0.05)
  assert.ok(Math.abs(result.comparison.meanChange - 3) < 0.05)
})

test('the periods come back in chronological order, whatever their keys look like', () => {
  const result = distributionFor('SHIFT', 'temp_mean')
  const froms = result.periods.map((p) => p.from)
  assert.deepEqual([...froms].sort((a, b) => a - b), froms, 'Perioden nicht chronologisch')
})

test('the band lists are aligned onto one axis, one row per band', () => {
  const result = distributionFor('SHIFT', 'temp_mean')
  const keys = result.periods.map((p) => p.key)

  let previous = -Infinity
  for (const row of result.bands) {
    assert.ok(row.from > previous, 'Bänder müssen aufsteigend und eindeutig sein')
    previous = row.from
    for (const key of keys) {
      assert.equal(typeof row[key], 'number', `Band ${row.from} ohne Anteil für ${key}`)
      assert.ok(row[key] >= 0 && row[key] <= 100)
    }
  }
  // Every period's shares add up to a hundred per cent across the whole axis.
  for (const key of keys) {
    const total = result.bands.reduce((sum, row) => sum + row[key], 0)
    assert.ok(Math.abs(total - 100) < 0.01, `${key} summiert sich auf ${total} %`)
  }
})

test('a period with too few days is left out rather than compared', () => {
  // Only the middle period is complete; the other two get a single year.
  const rows = []
  for (const date of days('1935-01-01', '1935-12-31')) rows.push({ date, temp_mean: 8 })
  for (let year = 1961; year <= 1990; year++) {
    for (const date of days(`${year}-01-01`, `${year}-12-31`)) rows.push({ date, temp_mean: 9 })
  }
  for (const date of days('1995-01-01', '1995-12-31')) rows.push({ date, temp_mean: 11 })
  seed(db, 'THIN', rows)

  assert.equal(
    distributionFor('THIN', 'temp_mean'),
    null,
    'mit einer einzigen vollständigen Periode gibt es nichts zu vergleichen',
  )
})

test('threshold counts are per year and carry the whole record behind them', () => {
  threePeriods('THRESH', { [PERIODS[0].key]: 0, [PERIODS[1].key]: 1, [PERIODS[2].key]: 3 })
  const shifts = thresholdShift('THRESH')
  assert.ok(shifts.length > 0)

  for (const entry of shifts) {
    for (const period of entry.periods) {
      assert.ok(period.perYear >= 0, `${entry.key}: negative Häufigkeit`)
      assert.ok(period.years > 0)
    }
    assert.ok(entry.ever.days >= 0)
    if (entry.ever.days > 0) {
      assert.ok(entry.ever.first && entry.ever.last, `${entry.key}: Tage ohne Datum`)
    }
  }

  // Warm thresholds have to become more frequent when every day gets warmer.
  const summer = shifts.find((s) => s.key === 'summer_day')
  if (summer) {
    const early = summer.periods[0]
    const late = summer.periods[summer.periods.length - 1]
    assert.ok(late.perYear >= early.perYear, 'Sommertage werden bei +3 K nicht seltener')
  }
})
