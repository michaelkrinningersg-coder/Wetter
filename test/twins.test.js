import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The nearest-neighbour search over whole days. Two properties carry it: the
 * quantities are standardised, so five millimetres of rain and five degrees are
 * not added together as if they were the same size, and the week either side of
 * the reference day is excluded — otherwise yesterday's twin is the day before
 * yesterday, which is true and useless.
 */

const db = await freshArchive()
const { TWIN_SETS, weatherTwins } = await import('../server/twins.js')

const FIELDS = TWIN_SETS[0].fields.map((f) => f.key)

/** Rows carrying every quantity the seven-field set needs. */
function fullDays(station, from, to, shape) {
  const rows = days(from, to).map((date, at) => {
    const row = { date }
    for (const [key, value] of Object.entries(shape(date, at))) row[key] = value
    return row
  })
  seed(db, station, rows)
  return rows
}

test('the twin of a repeated day is the other copy of it', () => {
  // A flat year with two identical outliers, four months apart.
  fullDays('TWIN', '2000-01-01', '2000-12-31', (date) => {
    const odd = date === '2000-03-15' || date === '2000-07-15'
    return {
      temp_mean: odd ? 25 : 10,
      temp_max: odd ? 31 : 14,
      temp_min: odd ? 19 : 6,
      precipitation: odd ? 40 : 2,
      pressure: odd ? 980 : 1013,
      humidity: odd ? 95 : 70,
      cloud: odd ? 8 : 4,
    }
  })

  const result = weatherTwins('TWIN', '2000-03-15')
  assert.ok(result.twins.length > 0)
  assert.equal(result.twins[0].date, '2000-07-15', 'der zweite Ausreißer ist der Zwilling')
  assert.ok(result.twins[0].distance < 0.01, `Abstand ${result.twins[0].distance} statt fast null`)
})

test('the week either side of the reference day is excluded', () => {
  fullDays('GAP', '2000-01-01', '2000-12-31', (date, at) => ({
    // A slow drift, so the nearest neighbours really are the adjacent days.
    temp_mean: 10 + at * 0.01,
    temp_max: 14 + at * 0.01,
    temp_min: 6 + at * 0.01,
    precipitation: 2,
    pressure: 1013,
    humidity: 70,
    cloud: 4,
  }))

  const result = weatherTwins('GAP', '2000-06-15')
  assert.equal(result.minGapDays, 7)
  for (const twin of result.twins) {
    const apart = Math.abs(Date.parse(twin.date) - Date.parse('2000-06-15')) / 86_400_000
    assert.ok(apart > 7, `${twin.date} liegt nur ${apart} Tage entfernt`)
  }
})

test('each quantity is standardised, so a wide one does not swamp a narrow one', () => {
  // Pressure swings by fifty units, cloud cover by four. Without standardising,
  // pressure alone would decide every distance.
  fullDays('SCALE', '2000-01-01', '2000-12-31', (date, at) => ({
    temp_mean: 10,
    temp_max: 14,
    temp_min: 6,
    precipitation: 2,
    pressure: 1013 + (at % 2 === 0 ? 25 : -25),
    humidity: 70,
    cloud: at % 4,
  }))

  const result = weatherTwins('SCALE', '2000-06-15')
  const field = result.fields.find((f) => f.key === 'pressure')
  const cloud = result.fields.find((f) => f.key === 'cloud')
  assert.ok(field.sd > 20, 'der Druck streut in seinen eigenen Einheiten weit')
  assert.ok(cloud.sd < 2)

  // A difference of one standard deviation counts the same in both.
  for (const twin of result.twins) {
    for (const diff of twin.differences) {
      const meta = result.fields.find((f) => f.key === diff.key)
      assert.ok(
        Math.abs(diff.sigma - diff.difference / meta.sd) < 1e-9,
        `${diff.key}: Sigma passt nicht zur Standardabweichung`,
      )
    }
  }
})

test('a day missing one of the quantities cannot be compared, and says so', () => {
  fullDays('PART', '2000-01-01', '2000-12-31', () => ({
    temp_mean: 10,
    temp_max: 14,
    temp_min: 6,
    precipitation: 2,
    pressure: 1013,
    humidity: 70,
    cloud: 4,
  }))
  seed(db, 'PART', [{ date: '2001-01-01', temp_mean: 10, temp_max: 14 }])

  const result = weatherTwins('PART', '2001-01-01')
  assert.ok(result.hint, 'ein unvollständiger Tag braucht einen Hinweis')
  assert.match(result.hint, /vollständig/)
  assert.equal(result.reference, null)
  assert.deepEqual(result.twins, [])
})

test('both quantity sets are offered and the fuller one covers fewer days', () => {
  fullDays('SETS', '1990-01-01', '1999-12-31', (date, at) => ({
    temp_mean: 10 + (at % 20),
    temp_max: 14 + (at % 20),
    temp_min: 6 + (at % 20),
    precipitation: at % 7,
    pressure: 1013 + (at % 30),
    humidity: 60 + (at % 30),
    cloud: at % 8,
    // Wind and sunshine only in the second half of the decade.
    wind_max: date >= '1995-01-01' ? 5 + (at % 10) : null,
    sunshine: date >= '1995-01-01' ? at % 12 : null,
  }))

  const kern = weatherTwins('SETS', '1999-06-15', 'kern')
  const voll = weatherTwins('SETS', '1999-06-15', 'voll')
  assert.equal(kern.fields.length, 7)
  assert.equal(voll.fields.length, 9)
  assert.ok(
    voll.available.days < kern.available.days,
    'der vollere Satz muss weniger Tage abdecken',
  )
  assert.deepEqual(FIELDS.length, 7)
})
