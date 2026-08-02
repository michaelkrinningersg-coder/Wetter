import assert from 'node:assert/strict'
import test from 'node:test'

import { days, everyYear, freshArchive, seed } from './helpers/fixture.js'

/**
 * Twelve questions whose answers appear in no ordinary record list. Three of
 * them have guards that would be invisible if they broke: differences may only
 * be taken over neighbouring days, a monthly share needs a month worth sharing,
 * and an anomaly needs a mean worth deviating from.
 */

const db = await freshArchive()
const { CURIOSITY_KEYS, curiosities } = await import('../server/curiosities.js')

const section = (result, key) => result.sections.find((s) => s.key === key)

test('a difference to the previous day is only taken over neighbouring days', () => {
  // Two days astride a three-day hole: 5 °C, then 25 °C. Twenty kelvin, and
  // entirely invented, because nobody measured what lay between.
  seed(db, 'JUMP', [
    { date: '2000-01-01', temp_mean: 5, temp_max: 8, temp_min: 2, pressure: 1000 },
    { date: '2000-01-05', temp_mean: 25, temp_max: 28, temp_min: 22, pressure: 1030 },
    // A genuine neighbouring pair, worth eight kelvin.
    { date: '2000-01-06', temp_mean: 17, temp_max: 20, temp_min: 14, pressure: 1010 },
  ])

  const result = curiosities('JUMP')
  const up = section(result, 'jump_up')
  const down = section(result, 'jump_down')
  assert.ok(up, 'keine Sprung-Auswertung')

  for (const day of [...up.days, ...down.days]) {
    assert.notEqual(day.date, '2000-01-05', 'über eine Archivlücke hinweg gibt es keinen Sprung')
  }
  assert.equal(down.days[0].date, '2000-01-06')
  assert.ok(Math.abs(down.days[0].value + 8) < 1e-9, `Sturz war ${down.days[0].value}`)
  assert.equal(down.signed, true, 'ein Sturz muss sein Vorzeichen behalten')
})

test('a drizzle in a dry month does not win the monthly share', () => {
  const rows = []
  // February: 3 mm in the whole month, all on one day. A hundred per cent, and
  // meaningless — the month never had anything to share.
  for (const date of days('2001-02-01', '2001-02-28')) {
    rows.push({ date, precipitation: date === '2001-02-10' ? 3 : 0, temp_mean: 3 })
  }
  // July: 60 of 80 mm on one day. Seventy-five per cent, and a real event.
  for (const date of days('2001-07-01', '2001-07-31')) {
    rows.push({
      date,
      precipitation: date === '2001-07-20' ? 60 : 20 / 30,
      temp_mean: 18,
    })
  }
  seed(db, 'SHARE', rows)

  const result = curiosities('SHARE')
  const share = section(result, 'downpour_share')
  assert.equal(result.minMonthRain, 20)
  assert.equal(share.days[0].date, '2001-07-20')
  for (const day of share.days) {
    assert.notEqual(day.date, '2001-02-10', 'ein 3-mm-Februar ist kein Monat, den ein Tag macht')
  }
})

test('an anomaly needs thirty years of the same calendar day', () => {
  // Twenty-eight ordinary years of one calendar day, and a wild twenty-ninth:
  // one short of the floor, so nothing may be said about it yet.
  const rows = everyYear(1972, 1999, '03-03').map((date) => ({ date, temp_mean: 4 }))
  rows.push({ date: '2000-03-03', temp_mean: 20 })
  seed(db, 'ANOM', rows)
  assert.equal(curiosities('ANOM').minYearsForMean, 30)
  assert.equal(
    section(curiosities('ANOM'), 'warm_anomaly'),
    undefined,
    'aus 29 Beobachtungen wäre das Mittel Rauschen',
  )

  // One more year, and the same day becomes rankable.
  seed(db, 'ANOM', [{ date: '2001-03-03', temp_mean: 4 }])
  const warm = section(curiosities('ANOM'), 'warm_anomaly')
  assert.ok(warm, 'ab dreißig Jahren muss die Abweichung gerechnet werden')
  assert.equal(warm.days[0].date, '2000-03-03')
})

test('summer frost and out-of-season snow are complete lists, not top tens', () => {
  const rows = []
  for (let year = 1990; year <= 2019; year++) {
    for (const date of days(`${year}-06-01`, `${year}-06-30`)) {
      rows.push({ date, temp_min: 8, temp_max: 20, temp_mean: 14, snow: 0 })
    }
  }
  // Two June nights below zero in thirty years.
  seed(db, 'RARE', rows)
  seed(db, 'RARE', [
    { date: '1995-06-05', temp_min: -1.5, temp_max: 12, temp_mean: 5, snow: 0 },
    { date: '2011-06-02', temp_min: -0.4, temp_max: 14, temp_mean: 7, snow: 0 },
  ])

  const frost = section(curiosities('RARE'), 'summer_frost')
  assert.ok(frost, 'kein Sommerfrost gefunden')
  assert.equal(frost.found, 2, 'genau zwei Nächte erfüllen die Bedingung')
  assert.equal(frost.days.length, 2, 'die Liste ist damit vollständig')
  assert.equal(frost.days[0].date, '1995-06-05', 'die kälteste zuerst')
})

test('every question keeps its list inside the stated limit', () => {
  const rows = []
  for (let year = 1950; year <= 1999; year++) {
    for (const date of days(`${year}-01-01`, `${year}-12-31`)) {
      const doy = Number(date.slice(5, 7)) * 31 + Number(date.slice(8, 10))
      rows.push({
        date,
        temp_mean: 10 + 12 * Math.sin(doy / 58),
        temp_max: 15 + 12 * Math.sin(doy / 58),
        temp_min: 5 + 12 * Math.sin(doy / 58),
        precipitation: (doy % 7) * 1.5,
        pressure: 1010 + (doy % 25),
        snow: 0,
        wind_max: 4 + (doy % 9),
      })
    }
  }
  seed(db, 'FULL', rows)

  const result = curiosities('FULL')
  assert.equal(result.limit, 10)
  assert.ok(result.sections.length >= 8, 'die meisten Fragen müssen Antworten finden')
  for (const entry of result.sections) {
    assert.ok(entry.days.length <= result.limit, `${entry.key} liefert zu viele Tage`)
    assert.ok(entry.days.length > 0, `${entry.key} steht leer in der Liste`)
    assert.ok(entry.found >= entry.days.length)
    assert.ok(CURIOSITY_KEYS.includes(entry.key))
    // Sorted by the question's own direction.
    for (let i = 1; i < entry.days.length; i++) {
      const before = entry.days[i - 1].value
      const now = entry.days[i].value
      assert.ok(
        entry.direction === 'max' ? before >= now : before <= now,
        `${entry.key} ist nicht nach ${entry.direction} sortiert`,
      )
    }
  }
})
