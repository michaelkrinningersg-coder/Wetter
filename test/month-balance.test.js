import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The running month rests on two rules that are easy to state and easy to
 * break: the measured part is compared with the same days of other years, and
 * an ensemble member has to have measured the whole remainder.
 */

const db = await freshArchive()
const { monthBalance } = await import('../server/month-balance.js')

/**
 * Julys of a made-up station. Each year is `base` degrees flat, so every figure
 * below can be worked out by hand.
 */
function julys(station, temps) {
  const rows = []
  for (const [year, base] of Object.entries(temps)) {
    for (const date of days(`${year}-07-01`, `${year}-07-31`)) {
      rows.push({ date, temp_mean: base, precipitation: 1 })
    }
  }
  seed(db, station, rows)
}

test('the partial month is ranked against the same window, not against whole months', () => {
  const temps = {}
  for (let year = 1970; year <= 2019; year++) temps[year] = 10 + (year % 10)
  julys('WINDOW', temps)

  // The running year: fifteen days at 25 °C, warmer than any complete July.
  const rows = days('2020-07-01', '2020-07-15').map((date) => ({
    date,
    temp_mean: 25,
    precipitation: 1,
  }))
  seed(db, 'WINDOW', rows)

  const result = monthBalance('WINDOW', 7)
  const field = result.fields.find((f) => f.key === 'temp')
  const live = field.live

  assert.equal(result.running, 2020)
  assert.equal(live.cut, 15)
  assert.equal(live.measured, 15)
  assert.equal(live.value, 25)
  assert.equal(live.window.rank, 1, 'wärmster 1. bis 15. Juli aller Jahre')
  assert.equal(live.window.total, 51, 'fünfzig Vergleichsjahre plus das laufende')
  assert.equal(live.complete, false)
})

test('a sum is projected onto the whole month, a mean is weighted by days', () => {
  const temps = {}
  for (let year = 1970; year <= 2019; year++) temps[year] = 20
  julys('SUM', temps)
  const rows = days('2020-07-01', '2020-07-10').map((date) => ({
    date,
    temp_mean: 30,
    precipitation: 2,
  }))
  seed(db, 'SUM', rows)

  const result = monthBalance('SUM', 7)
  const temp = result.fields.find((f) => f.key === 'temp').live
  const rain = result.fields.find((f) => f.key === 'precip').live

  // Ten days at 30 °C and twenty-one from a year that ran at 20 °C:
  // (10·30 + 21·20) / 31 = 23.2258…
  const expected = (10 * 30 + 21 * 20) / 31
  for (const entry of temp.projection.quantiles) {
    assert.ok(Math.abs(entry.value - expected) < 1e-9, `Mittel hochgerechnet auf ${entry.value}`)
  }
  // The sum is 10·2 mm observed plus 21·1 mm from the member.
  for (const entry of rain.projection.quantiles) {
    assert.ok(Math.abs(entry.value - (20 + 21)) < 1e-9, `Summe hochgerechnet auf ${entry.value}`)
  }
  assert.equal(rain.projection.restDays, 21)
})

test('a year that did not measure the whole remainder is not an ensemble member', () => {
  const temps = {}
  for (let year = 1970; year <= 1999; year++) temps[year] = 20
  julys('MEMBER', temps)

  // Two years whose July breaks off on the 20th: they can begin a comparison
  // but must not end one.
  for (const year of [2000, 2001]) {
    seed(
      db,
      'MEMBER',
      days(`${year}-07-01`, `${year}-07-20`).map((date) => ({ date, temp_mean: 20, precipitation: 1 })),
    )
  }
  seed(
    db,
    'MEMBER',
    days('2020-07-01', '2020-07-10').map((date) => ({ date, temp_mean: 25, precipitation: 1 })),
  )

  const live = monthBalance('MEMBER', 7).fields.find((f) => f.key === 'temp').live
  assert.equal(live.projection.members, 30, 'nur die dreißig vollständigen Jahre zählen')
})

test('a month with too few measured days is shown but not ranked', () => {
  const temps = {}
  for (let year = 1970; year <= 2019; year++) temps[year] = 20
  julys('THIN', temps)
  // Twelve days only — below the twenty-five the heatmap also demands.
  seed(
    db,
    'THIN',
    days('2020-07-01', '2020-07-12').map((date) => ({ date, temp_mean: 30, precipitation: 1 })),
  )

  const result = monthBalance('THIN', 7)
  const entry = result.fields.find((f) => f.key === 'temp').history.find((h) => h.year === 2020)
  assert.equal(entry.value, 30, 'der Wert wird gezeigt')
  assert.equal(entry.rated, false, 'aber nicht eingeordnet')
  assert.equal(entry.rank, null)
  assert.equal(result.minMonthDays, 25)
})

test('asOf replays the month as it looked earlier, and the spread narrows', () => {
  const temps = {}
  for (let year = 1970; year <= 2019; year++) temps[year] = 15 + (year % 11)
  julys('ASOF', temps)
  seed(
    db,
    'ASOF',
    days('2020-07-01', '2020-07-31').map((date) => ({ date, temp_mean: 21, precipitation: 1 })),
  )

  const early = monthBalance('ASOF', 7, '2020-07-05').fields[0].live
  const late = monthBalance('ASOF', 7, '2020-07-28').fields[0].live
  const width = (live) => live.projection.max - live.projection.min

  assert.equal(early.cut, 5)
  assert.equal(late.cut, 28)
  assert.ok(
    width(late) < width(early),
    `die Spanne wuchs von ${width(early)} auf ${width(late)}, statt zu schrumpfen`,
  )
})
