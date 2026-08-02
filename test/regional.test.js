import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The areal means of the DWD, and the record balance built on them. Two things
 * here have gone wrong before and can go wrong silently: the order of the
 * periods, and the 1/k expectation that keeps a long series from looking
 * record-hungry simply for being long.
 */

const db = await freshArchive()
const { regionalBalance, regionalMeta, regionalSeries, classifyRegion } = await import(
  '../server/regional.js'
)

const PARAMETER = 'temp_mean'

/**
 * A region that does not exist.
 *
 * `regional.js` reads the committed DWD area means into the table the moment it
 * is imported, so a fixture under a real name would be mixed with a century and
 * a half of genuine values. An invented region keeps the arithmetic to itself.
 */
const REGION = 'Testregion'

/** Areal values for one region: `values[period][year] = value`. */
function seedRegional(region, byPeriod) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO regional_values (region, parameter, period, year, value)
    VALUES (?, ?, ?, ?, ?)
  `)
  const write = db.transaction(() => {
    for (const [period, years] of Object.entries(byPeriod)) {
      for (const [year, value] of Object.entries(years)) {
        insert.run(region, PARAMETER, period, Number(year), value)
      }
    }
  })
  write()
}

/** A hundred years of one period, warming by a hundredth of a degree a year. */
function warming(from, to, start, step) {
  const out = {}
  for (let year = from; year <= to; year++) out[year] = start + (year - from) * step
  return out
}

test('the periods come back in calendar order, not in the order object keys sort in', () => {
  // '10', '11' and '12' are canonical array indices in JavaScript and hoist to
  // the front of `Object.keys`. October once led the list for exactly that
  // reason, and the fix was an explicit order — which this pins.
  const periods = {}
  for (const period of ['year', 'winter', 'spring', 'summer', 'autumn']) {
    periods[period] = warming(1900, 1999, 8, 0.01)
  }
  for (let month = 1; month <= 12; month++) {
    periods[String(month).padStart(2, '0')] = warming(1900, 1999, 5, 0.01)
  }
  seedRegional(REGION, periods)

  const balance = regionalBalance(PARAMETER)
  assert.ok(balance, 'keine Bilanz gerechnet')
  const region = balance.regions.find((r) => r.name === REGION)
  const order = region.periods.map((p) => p.period)

  assert.equal(order[0], 'year', 'das Jahr steht voran')
  assert.deepEqual(order.slice(1, 5), ['winter', 'spring', 'summer', 'autumn'])
  assert.deepEqual(order.slice(5), [
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
  ])
})

test('a monotonically warming series sets every maximum and no minimum after the first', () => {
  const balance = regionalBalance(PARAMETER)
  const region = balance.regions.find((r) => r.name === REGION)

  // Seventeen periods, each rising every single year: every year is a new
  // high, and only the first year of each period is a low.
  assert.equal(region.totals.high, 17 * 100, 'jeder Wert einer steigenden Reihe ist ein Höchstwert')
  assert.equal(region.totals.low, 17, 'und nur der jeweils erste ein Tiefstwert')

  // Chance alone would give the sum of 1/k, which for a hundred values is
  // about 5.19 per period and direction.
  const expectedPerSeries = Array.from({ length: 100 }, (_, i) => 1 / (i + 1)).reduce(
    (a, b) => a + b,
    0,
  )
  // The module rounds each decade's expectation for display, so the sum drifts
  // by a few hundredths — close enough that the tolerance is about rounding
  // and not about the formula.
  assert.ok(
    Math.abs(region.totals.expected - 17 * expectedPerSeries) < 0.05,
    `Erwartung ${region.totals.expected} statt ${17 * expectedPerSeries}`,
  )
  assert.ok(region.totals.high > region.totals.expected * 10, 'ein Trend muss den Zufall schlagen')
})

test('the expectation falls off as one over k, so a long series is not record-hungry', () => {
  const region = regionalBalance(PARAMETER).regions.find((r) => r.name === REGION)
  const decades = region.decades

  const first = decades[0]
  const last = decades[decades.length - 1]
  assert.ok(
    first.expected > last.expected * 5,
    `das erste Jahrzehnt erwartet ${first.expected}, das letzte ${last.expected}`,
  )
  assert.equal(first.decade, 1900)
  assert.equal(last.decade, 1990)
  for (const decade of decades) {
    assert.ok(decade.expected > 0)
    assert.ok(decade.series > 0, 'ein Jahrzehnt ohne Reihen darf nicht auftauchen')
  }
})

test('a region is classified by its name, and the country is not a state', () => {
  assert.equal(classifyRegion('Deutschland'), 'national')
  assert.equal(classifyRegion('Niedersachsen'), 'state')
  assert.equal(classifyRegion('Brandenburg/Berlin'), 'combination')
})

test('an unknown parameter is refused rather than silently answered', () => {
  assert.equal(regionalBalance('gibtsnicht'), null)
  assert.equal(regionalSeries('gibtsnicht', 'year'), null)
  const meta = regionalMeta()
  assert.ok(meta.parameters.some((p) => p.key === PARAMETER))
})
