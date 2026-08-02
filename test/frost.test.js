import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * Late-frost risk is the distance between two dates that are each defined by a
 * rule, so both rules have to hold: the growing season starts on the first of
 * six days at or above five degrees, and only frost between February and June
 * counts — a frost in January is winter, not a late frost.
 */

const db = await freshArchive()
const { FROST_VARIANTS, frostRisk, frostRiskAll } = await import('../server/frost.js')

/**
 * Twenty-five springs, because a single one is not a risk analysis: the module
 * refuses to answer below twenty years, which is itself worth knowing.
 *
 * `shape(year)` decides when the warmth starts and where the frosts fall; every
 * year not named runs warm from 1 April with a frost on 10 March.
 */
function springs(station, from, to, shape = () => ({})) {
  const rows = []
  for (let y = from; y <= to; y++) {
    const { startFrom = `${y}-04-01`, frostDates = [`${y}-03-10`], warmUntil = `${y}-10-31` } =
      shape(y) ?? {}
    for (const date of days(`${y}-01-01`, `${y}-12-31`)) {
      rows.push({
        date,
        temp_mean: date >= startFrom && date <= warmUntil ? 9 : 1,
        temp_max: 12,
        temp_min: frostDates.includes(date) ? -2 : 4,
        precipitation: 1,
      })
    }
  }
  seed(db, station, rows)
}

test('the season starts on the first of six warm days and the last spring frost is found', () => {
  springs('FROST', 1990, 2014, (y) =>
    y === 2001 ? { frostDates: ['2001-01-20', '2001-04-20'] } : {},
  )
  const result = frostRisk('FROST')
  const year = result.points.find((p) => p.year === 2001)

  assert.ok(year, 'kein Jahr berechnet')
  assert.equal(year.startDate, '2001-04-01')
  assert.equal(year.frostDate, '2001-04-20', 'der Januarfrost gehört nicht in das Fenster')
  assert.equal(year.frostTemp, -2)
  assert.equal(year.window, year.frost - year.start, 'das Fenster ist der Abstand der beiden Tage')
  assert.ok(year.window > 0, 'ein Frost nach Vegetationsbeginn ist eine Gefährdung')
})

test('a frost before the season begins gives a negative window, not a zero', () => {
  springs('EARLY', 1990, 2014)
  const year = frostRisk('EARLY').points.find((p) => p.year === 2002)
  assert.equal(year.frostDate, '2002-03-10')
  assert.ok(year.window < 0, 'Frost vor dem Austrieb ist keine Gefährdung')
})

test('a year without frost inside the window is left out rather than counted as zero', () => {
  springs('NONE', 1990, 2014, (y) => (y === 2003 ? { frostDates: [] } : {}))
  const year = frostRisk('NONE').points.find((p) => p.year === 2003)
  assert.ok(
    year === undefined || year.frostDate === null,
    'ohne Frost darf kein Fenster von null Tagen entstehen',
  )
})

test('the three variants differ only in the earliest start they will accept', () => {
  assert.equal(FROST_VARIANTS.length, 3)
  const all = frostRiskAll('FROST')
  assert.equal(all.variants.length, 3)

  for (const variant of all.variants) {
    assert.equal(typeof variant.minStart, 'number')
    for (const point of variant.points) {
      assert.ok(point.start >= variant.minStart, `${point.year}: Beginn vor der Untergrenze`)
    }
  }
  const limits = all.variants.map((v) => v.minStart)
  assert.deepEqual([...new Set(limits)], limits, 'zwei gleiche Untergrenzen wären eine Variante')
  assert.deepEqual([...limits].sort((a, b) => a - b), limits, 'die Varianten stehen nicht nach Strenge')
  assert.equal(all.base, 5)
  assert.equal(all.runLength, 6)
})

test('a mild January starts the season in the loose variant and in no other', () => {
  // Six mild days from 5 January, then winter again until April: the six-day
  // rule fires at once, which is exactly the case the stricter variants drop.
  springs('MILD', 1990, 2014, (y) =>
    y === 2004
      ? { frostDates: ['2004-04-25'], startFrom: '2004-01-05', warmUntil: '2004-10-31' }
      : {},
  )
  seed(
    db,
    'MILD',
    days('2004-01-13', '2004-03-31').map((date) => ({
      date,
      temp_mean: 1,
      temp_max: 12,
      temp_min: 4,
      precipitation: 1,
    })),
  )

  const all = frostRiskAll('MILD')
  const loose = all.variants.find((v) => v.minStart === 0)
  const looseYear = loose.points.find((p) => p.year === 2004)
  assert.equal(looseYear.startDate, '2004-01-05', 'ohne Untergrenze zählt der Januar')

  for (const variant of all.variants.filter((v) => v.minStart >= 15)) {
    const year = variant.points.find((p) => p.year === 2004)
    assert.equal(
      year,
      undefined,
      `Untergrenze ${variant.minStart}: ein Beginn am 5. Januar darf nicht durchgehen`,
    )
  }
})
