import assert from 'node:assert/strict'
import test from 'node:test'

import { days, everyYear, freshArchive, seed } from './helpers/fixture.js'

/**
 * The oldest module of the project, and the one every other view leans on.
 * Tested here are the rules a reader would check by hand: the six-day rule of
 * the growing season, the twenty-five-day floor of the monthly ranking, and
 * the gap handling of the consecutive-day runs.
 */

const db = await freshArchive()
const api = await import('../server/queries.js')

/** A year of 0 °C days, with the named dates overridden. */
function blankYear(station, y, overrides = {}) {
  const rows = days(`${y}-01-01`, `${y}-12-31`).map((date) => ({
    date,
    temp_mean: 0,
    temp_max: 2,
    temp_min: -2,
    precipitation: 0,
    wind_max: 3,
  }))
  for (const row of rows) Object.assign(row, overrides[row.date] ?? {})
  seed(db, station, rows)
  return rows
}

/* -------------------------------------------------------------------------- */
/* Vegetation                                                                 */
/* -------------------------------------------------------------------------- */

test('the growing season starts on the first day of six warm days, not the first warm day', () => {
  const overrides = {}
  // A false start: five days at 8 °C, then cold again.
  for (const date of days('2001-03-01', '2001-03-05')) overrides[date] = { temp_mean: 8 }
  // The real start: six days from 1 April.
  for (const date of days('2001-04-01', '2001-12-31')) overrides[date] = { temp_mean: 8 }
  blankYear('VEG', 2001, overrides)

  const { records, base, runLength } = api.vegetation('VEG')
  assert.equal(base, 5)
  assert.equal(runLength, 6)

  const year = records.find((r) => r.year === 2001)
  assert.ok(year, 'kein Vegetationsjahr berechnet')
  assert.equal(year.startDate, '2001-04-01', 'fünf warme Tage im März dürfen nichts auslösen')
})

test('a cold snap in May does not close the season, one in September does', () => {
  const overrides = {}
  for (const date of days('2002-04-01', '2002-12-31')) overrides[date] = { temp_mean: 8 }
  for (const date of days('2002-05-10', '2002-05-20')) overrides[date] = { temp_mean: 2 }
  for (const date of days('2002-09-15', '2002-09-30')) overrides[date] = { temp_mean: 2 }
  blankYear('VEG2', 2002, overrides)

  const year = api.vegetation('VEG2').records.find((r) => r.year === 2002)
  assert.equal(year.startDate, '2002-04-01')
  assert.equal(year.endDate, '2002-09-14', 'die Kältewelle im Mai darf nicht schließen')
  assert.ok(year.growingDegreeDays > 0)
})

/* -------------------------------------------------------------------------- */
/* Monthly ranking                                                            */
/* -------------------------------------------------------------------------- */

test('a month below twenty-five measured days is shown but not ranked', () => {
  const rows = []
  for (let year = 1990; year <= 2009; year++) {
    for (const date of days(`${year}-06-01`, `${year}-06-30`)) {
      rows.push({ date, temp_mean: 15 + (year % 5) })
    }
  }
  // June 2010 breaks off after twelve days, and they are the warmest on record.
  for (const date of days('2010-06-01', '2010-06-12')) rows.push({ date, temp_mean: 30 })
  seed(db, 'HEAT', rows)

  const { records, minMonthDays } = api.heatmap('HEAT')
  assert.equal(minMonthDays, 25)

  const thin = records.find((r) => r.year === 2010 && r.month === 6)
  assert.ok(thin, 'der angebrochene Monat fehlt ganz')
  assert.equal(thin.rated, false)
  assert.equal(thin.rank, null, 'ohne genug Tage darf es keinen Rang geben')
  assert.ok(thin.avg_temp !== null, 'der Wert selbst wird trotzdem gezeigt')

  const full = records.find((r) => r.year === 2009 && r.month === 6)
  assert.equal(full.rated, true)
  assert.ok(full.rank >= 1 && full.rank <= full.total_years_for_month)
})

/* -------------------------------------------------------------------------- */
/* Spells                                                                     */
/* -------------------------------------------------------------------------- */

test('a run of days is broken by a gap in the archive, not silently joined', () => {
  const overrides = {}
  for (const date of days('2003-07-01', '2003-07-06')) overrides[date] = { temp_max: 32 }
  for (const date of days('2003-07-10', '2003-07-16')) overrides[date] = { temp_max: 32 }
  const rows = blankYear('SPELL', 2003, overrides).filter(
    (row) => !(row.date >= '2003-07-07' && row.date <= '2003-07-09'),
  )
  // Re-seed without the three days in between: they are absent, not cool.
  seed(db, 'SPELL2', rows)

  const result = api.spells('SPELL2', 'heat')
  assert.equal(result.totalCount, 2, 'über eine Datumslücke darf keine Periode laufen')
  assert.equal(result.records[0].days, 7)
  assert.equal(result.records[1].days, 6)
  assert.equal(result.minDays, 3)
})

test('a missing measurement ends a run as surely as a missing day', () => {
  const overrides = {}
  for (const date of days('2004-07-01', '2004-07-05')) overrides[date] = { temp_max: 32 }
  overrides['2004-07-06'] = { temp_max: null }
  for (const date of days('2004-07-07', '2004-07-12')) overrides[date] = { temp_max: 32 }
  blankYear('SPELL3', 2004, overrides)

  const result = api.spells('SPELL3', 'heat')
  assert.equal(result.totalCount, 2)
  assert.equal(result.records[0].days, 6)
})

test('an unknown spell kind is refused instead of guessed', () => {
  assert.equal(api.spells('SPELL3', 'gibtsnicht'), null)
  assert.ok(api.SPELL_KEYS.includes('heat'))
})

/* -------------------------------------------------------------------------- */
/* Record balance                                                             */
/* -------------------------------------------------------------------------- */

test('the record balance counts one holder per calendar day and direction', () => {
  // One calendar day, forty years, warming by a tenth each year: every year
  // sets the warm record, only the first holds the cold one.
  const rows = everyYear(1980, 2019, '05-05').map((date, at) => ({
    date,
    temp_max: 20 + at * 0.1,
    temp_min: 5 + at * 0.1,
    temp_mean: 12,
  }))
  seed(db, 'BAL', rows)

  const balance = api.recordBalance('BAL')
  assert.equal(balance.warmRecordCount, 1, 'ein Kalendertag hat genau einen stehenden Warmrekord')
  assert.equal(balance.coldRecordCount, 1)
  assert.equal(balance.topWarm[0].year, 2019, 'der wärmste Wert ist der letzte')
  assert.equal(balance.topCold[0].year, 1980, 'der kälteste der erste')
  assert.ok(balance.measuredYears >= 40)
})

/* -------------------------------------------------------------------------- */
/* Extremes                                                                   */
/* -------------------------------------------------------------------------- */

test('extreme days come back sorted and never exceed the requested count', () => {
  const rows = everyYear(1900, 1999, '08-08').map((date, at) => ({
    date,
    temp_max: 25 + (at % 17),
    temp_min: 10,
    temp_mean: 18,
    precipitation: at % 5,
  }))
  seed(db, 'EXT', rows)

  const top = api.extremeDays('EXT', 'temp_max_max', 10)
  assert.equal(top.length, 10)
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].value >= top[i].value, 'die Liste ist nicht absteigend sortiert')
  }
  assert.equal(api.extremeDays('EXT', 'gibtsnicht'), null)
  assert.ok(api.DAY_CATEGORY_KEYS.includes('temp_max_max'))
})
