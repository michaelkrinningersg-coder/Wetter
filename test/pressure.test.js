import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * Air pressure and its relation to the wind. The analysis makes two promises
 * that a wrong sign or a wrong window would break quietly: the readings are
 * station pressure and are never reduced to sea level, and a year enters the
 * series only when it was measured almost completely.
 */

const db = await freshArchive()
const { pressureAnalysis } = await import('../server/pressure.js')

/**
 * Ten years in which low pressure really does bring wind: the gust follows the
 * pressure exactly, so the correlation has to come out strongly negative.
 */
function windyLows(station, from, to, { skipDays = 0 } = {}) {
  const rows = []
  for (let year = from; year <= to; year++) {
    const all = days(`${year}-01-01`, `${year}-12-31`)
    const kept = all.slice(0, all.length - skipDays)
    for (const [at, date] of kept.entries()) {
      const swing = Math.sin(at / 9) * 25
      rows.push({
        date,
        pressure: 1013 + swing,
        wind_max: 12 - swing * 0.3,
        temp_mean: 9,
        temp_max: 13,
        temp_min: 5,
        precipitation: 1,
      })
    }
  }
  seed(db, station, rows)
}

test('the pressure is the station reading and is labelled as such', () => {
  windyLows('PRESS', 1990, 2009)
  const result = pressureAnalysis('PRESS')
  assert.ok(result, 'keine Auswertung')
  assert.equal(result.reduction, 'station', 'die Reihe darf nicht auf Meeresniveau gerechnet sein')
  assert.ok(result.note.length > 0)
  assert.equal(result.range.years >= 19, true)
})

test('low pressure and strong gusts come out as a negative correlation', () => {
  const result = pressureAnalysis('PRESS')
  assert.ok(result.wind.correlation.pressure < -0.9, `r = ${result.wind.correlation.pressure}`)
  assert.ok(result.wind.deep.meanGust > result.wind.deep.otherMeanGust, 'Tiefdruck muss windiger sein')
  assert.ok(result.wind.deep.limit < result.monthly[0].mean, 'die Tiefdruckgrenze liegt unter dem Mittel')
})

test('the bands are ordered, disjoint and each rests on enough days', () => {
  const result = pressureAnalysis('PRESS')
  let previous = -Infinity
  for (const band of result.wind.byPressure) {
    assert.ok(band.from >= previous, 'die Bänder überlappen')
    previous = band.to
    assert.ok(band.days >= result.minDaysPerBand, `Band ${band.from}: nur ${band.days} Tage`)
    assert.ok(band.mean <= band.max, 'ein Mittel über dem Maximum')
  }
})

test('a year measured only in part is left out of the annual series', () => {
  windyLows('THIN', 1990, 1999)
  // One more year that breaks off in October.
  windyLows('THIN', 2000, 2000, { skipDays: 90 })

  const result = pressureAnalysis('THIN')
  const years = result.annual.map((y) => y.year)
  assert.ok(years.includes(1999))
  assert.ok(!years.includes(2000), 'ein Jahr mit 275 Tagen gehört nicht in die Jahresreihe')
  assert.equal(result.minDaysPerYear, 330)
})

test('the extremes are the actual lowest and highest readings of the series', () => {
  const result = pressureAnalysis('PRESS')
  const lowest = result.extremes.lowest[0]
  const highest = result.extremes.highest[0]

  const trueLow = db
    .prepare('SELECT MIN(pressure) AS v FROM daily WHERE station_id = ?')
    .get('PRESS').v
  const trueHigh = db
    .prepare('SELECT MAX(pressure) AS v FROM daily WHERE station_id = ?')
    .get('PRESS').v

  assert.ok(Math.abs(lowest.pressure - trueLow) < 1e-9)
  assert.ok(Math.abs(highest.pressure - trueHigh) < 1e-9)
  for (let i = 1; i < result.extremes.lowest.length; i++) {
    assert.ok(result.extremes.lowest[i - 1].pressure <= result.extremes.lowest[i].pressure)
  }
})
