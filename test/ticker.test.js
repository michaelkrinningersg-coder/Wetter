import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The ticker shipped three wrong sentences before it shipped a right one, and
 * each of them is fenced off here: a run that stops at a missing measurement,
 * an event that never happened at all, and a quantity that is no longer
 * reported.
 */

const db = await freshArchive()
const { ticker } = await import('../server/ticker.js')

const pick = (result, key) => result.series.find((s) => s.key === key)

test('a measurement gap splits the verified run from the stretch since the event', () => {
  // Frost on 1 February, then frost-free to 30 April — but 20 to 24 April
  // carry no minimum at all.
  const rows = days('2020-01-01', '2020-04-30').map((date) => ({
    date,
    temp_min: date === '2020-02-01' ? -3 : 5,
    temp_max: 12,
    precipitation: 0,
    temp_mean: 8,
    snow: 0,
  }))
  for (const row of rows) {
    if (row.date >= '2020-04-20' && row.date <= '2020-04-24') row.temp_min = null
  }
  seed(db, 'GAP', rows)

  const frost = pick(ticker('GAP'), 'no_frost')
  assert.equal(frost.since.days, 89, 'Abstand zum letzten Frost, Lücken eingerechnet')
  assert.equal(frost.since.missing, 5, 'genau die fünf Tage ohne Messwert')
  assert.equal(frost.current.days, 6, 'lückenlos belegt sind nur die Tage nach der Lücke')
  assert.equal(frost.current.complete, false)
  // The head figure is the one the row leads with, and it gets the rank.
  assert.equal(frost.lead, frost.since.days)
  assert.equal(frost.leadBasis, 'since')
})

test('an event that never happened is named as such instead of counted from a gap', () => {
  // A cool station: the maximum never reaches thirty, so "days since the last
  // hot day" has no event to count from. Reported naively it became the
  // distance to the last hole in the measurements.
  const rows = days('2010-01-01', '2010-12-31').map((date) => ({
    date,
    temp_max: 15,
    temp_min: 5,
    temp_mean: 10,
    precipitation: 1,
    snow: 0,
  }))
  rows[100].temp_max = null
  seed(db, 'COOL', rows)

  const hot = pick(ticker('COOL'), 'no_hot')
  assert.equal(hot.never, true, 'kein Hitzetag in der ganzen Reihe')
  assert.equal(hot.lead, 0, 'ohne Ereignis darf keine Zahl geführt werden')
  assert.equal(hot.record, null)
  assert.equal(hot.rank, null)

  // The matching "Hitzetage in Folge" is empty for the same reason.
  const series = pick(ticker('COOL'), 'hot')
  assert.equal(series.never, true)
  assert.equal(series.record, null)
})

test('a quantity that stopped being reported cannot carry a running streak', () => {
  // Snow measured until the end of January, nothing after — the archive goes on
  // for months. The first version announced a record-breaking snowless run on
  // the strength of no measurements at all.
  const rows = days('2015-01-01', '2015-06-30').map((date) => ({
    date,
    temp_max: 10,
    temp_min: 2,
    temp_mean: 6,
    precipitation: 1,
    snow: date <= '2015-01-31' ? (date === '2015-01-05' ? 4 : 0) : null,
  }))
  seed(db, 'STALE', rows)

  const snow = pick(ticker('STALE'), 'no_snow')
  assert.equal(snow.stale, true, 'am Stichtag liegt kein Messwert vor')
  assert.equal(snow.lead, 0, 'ohne letzten Tag keine laufende Reihe')
  assert.equal(snow.measuredToday, false)
  assert.equal(snow.range.last, '2015-01-31', 'zuletzt gemessen')
})

test('a clean run reports one length and ranks it against completed runs', () => {
  const rows = days('2016-01-01', '2016-12-31').map((date) => ({
    date,
    temp_max: 10,
    temp_min: 2,
    temp_mean: 6,
    precipitation: 5,
    snow: 0,
  }))
  // Three earlier dry spells of two, three and four days, then five at the end.
  const dry = ['2016-03-01', '2016-03-02']
    .concat(['2016-05-01', '2016-05-02', '2016-05-03'])
    .concat(['2016-07-01', '2016-07-02', '2016-07-03', '2016-07-04'])
    .concat(days('2016-12-27', '2016-12-31'))
  for (const row of rows) if (dry.includes(row.date)) row.precipitation = 0

  seed(db, 'DRY', rows)
  const spell = ticker('DRY').series.find((s) => s.key === 'dry')
  assert.equal(spell.current.days, 5)
  assert.equal(spell.current.complete, true, 'kein Tag ohne Messwert im Zeitraum')
  assert.equal(spell.rank, 1, 'die längste Reihe, also Platz eins')
  assert.equal(spell.runs, 3, 'drei abgeschlossene Reihen zum Vergleich')
  assert.equal(spell.record.days, 5)
  assert.equal(spell.record.current, true, 'der Rekord ist die laufende Reihe selbst')
})
