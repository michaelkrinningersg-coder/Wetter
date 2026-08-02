import assert from 'node:assert/strict'
import test from 'node:test'

import { everyYear, freshArchive, seed } from './helpers/fixture.js'

/**
 * Regression tests for the three mistakes the record walk actually made.
 */

const db = await freshArchive()
const { RECORD_FIELD_BY_KEY, nearMisses, recordAges } = await import(
  '../server/calendar-records.js'
)

const STATION = 'TEST1'

/* -------------------------------------------------------------------------- */

test('a maximum of nought is absence, not a snow record', () => {
  // Sixty 1 May with no snow at all, and one with eight centimetres.
  const rows = everyYear(1900, 1959, '05-01').map((date) => ({ date, snow: 0, temp_mean: 12 }))
  rows.push({ date: '1960-05-01', snow: 8, temp_mean: 9 })
  seed(db, STATION, rows)

  const field = RECORD_FIELD_BY_KEY.get('snow')
  assert.equal(field.zeroIsAbsence, true, 'Schnee muss als „null heißt kein Ereignis" markiert sein')

  const ages = recordAges(STATION)
  const snow = ages.fields.find((f) => f.key === 'snow')
  assert.ok(snow, 'keine Schneeauswertung')
  assert.equal(snow.allTime.value, 8)
  assert.equal(snow.allTime.date, '1960-05-01')
  // The sixty snowless years must not appear as a series of records at all.
  assert.equal(snow.days, 1, 'schneefreie Tage dürfen nicht in die Reihe zählen')
  assert.equal(snow.allTime.seeded, true, 'der einzige Schneetag kann nichts geschlagen haben')
})

test('temperature records are kept per calendar day, not per day of the year', () => {
  // 1 March is the 60th day of a common year and the 61st of a leap year. If
  // the walk keyed on the day number, the leap years would be ranked against
  // 29 February and this record would land on the wrong date.
  const rows = []
  for (const year of [1996, 1997, 1998, 1999, 2000]) {
    rows.push({ date: `${year}-02-28`, temp_max: 5 })
    if (year % 4 === 0) rows.push({ date: `${year}-02-29`, temp_max: 25 })
    rows.push({ date: `${year}-03-01`, temp_max: year === 1997 ? 20 : 6 })
  }
  seed(db, 'LEAP', rows)

  const { fields } = recordAges('LEAP')
  const warm = fields.find((f) => f.key === 'temp_max_high')
  const march = warm.monthly.find((m) => m.month === 3)
  assert.equal(march.value, 20)
  assert.equal(march.date, '1997-03-01', 'der Märzrekord darf nicht auf einen 29. Februar rutschen')
})

/* -------------------------------------------------------------------------- */

test('near misses use a relative margin for rain and an absolute one for temperature', async () => {
  const { NEAR_MARGINS, NEAR_MIN_ORDINAL } = await import('../server/calendar-records.js')
  assert.equal(NEAR_MARGINS.precipitation.relative, true)
  assert.equal(NEAR_MARGINS.temp_max_high.relative, false)

  // Forty 3 July of drizzle, then a 5.1 mm record, then a 1.0 mm day. The old
  // fixed margin of five millimetres called that last day a near miss, because
  // 5.1 − 1.0 is less than five; a tenth of the record is 0.51 mm and is not.
  const rows = []
  let year = 1900
  for (; year < 1940; year++) {
    rows.push({ date: `${year}-07-03`, precipitation: 0.2 + (year % 3) * 0.1, temp_max: 20 })
  }
  rows.push({ date: `${year}-07-03`, precipitation: 5.1, temp_max: 20 })
  rows.push({ date: `${year + 1}-07-03`, precipitation: 1.0, temp_max: 20 })
  rows.push({ date: `${year + 2}-07-03`, precipitation: 4.8, temp_max: 20 })
  seed(db, 'RAIN', rows)

  const result = nearMisses('RAIN')
  const rain = result.fields.find((f) => f.key === 'precipitation')
  assert.equal(
    rain.closest.find((n) => n.date === `${year + 1}-07-03`),
    undefined,
    '1,0 mm ist kein Fast-Rekord von 5,1 mm',
  )
  assert.ok(
    rain.closest.find((n) => n.date === `${year + 2}-07-03`),
    '4,8 mm liegt innerhalb eines Zehntels von 5,1 mm und ist einer',
  )

  assert.equal(result.minObservation, NEAR_MIN_ORDINAL)
  for (const entry of rain.closest) {
    assert.ok(
      entry.observation >= NEAR_MIN_ORDINAL,
      `Fast-Rekord an Beobachtung ${entry.observation} — zu früh in der Reihe`,
    )
  }
})

test('a value just under a temperature record is a near miss', () => {
  const rows = everyYear(1900, 1939, '08-05').map((date, at) => ({
    date,
    temp_max: 25 + (at % 5) * 0.2,
  }))
  rows.push({ date: '1940-08-05', temp_max: 31 })
  rows.push({ date: '1941-08-05', temp_max: 30.7 })
  seed(db, 'WARM', rows)

  const rain = nearMisses('WARM').fields.find((f) => f.key === 'temp_max_high')
  const hit = rain.closest.find((n) => n.date === '1941-08-05')
  assert.ok(hit, '0,3 K unter dem Rekord muss ein Fast-Rekord sein')
  assert.ok(Math.abs(hit.gap - 0.3) < 1e-9, `Abstand war ${hit.gap}`)
  assert.equal(hit.rank, 2)
})
