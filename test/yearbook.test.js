import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The yearbook once announced "höchste Schneedecke — 0 cm, geteilt mit 159
 * weiteren Jahren" three times in one edition. A rank alone cannot see the
 * difference between winning and being tied with everybody; a midrank can.
 */

const db = await freshArchive()
const { yearbook } = await import('../server/yearbook.js')

/** A full year of unremarkable days, with the named dates overridden. */
function plainYear(station, y, overrides = {}) {
  const rows = days(`${y}-01-01`, `${y}-12-31`).map((date) => ({
    date,
    temp_mean: 9,
    temp_max: 13,
    temp_min: 5,
    precipitation: 2,
    wind_max: 6,
    snow: 0,
    sunshine: 4,
    pressure: 1013,
  }))
  for (const row of rows) Object.assign(row, overrides[row.date] ?? {})
  return rows
}

test('a snowless day tied with every other year is not the snowiest of anything', () => {
  const rows = []
  for (const y of Array.from({ length: 40 }, (_, i) => 1980 + i)) rows.push(...plainYear('SNOW', y))
  seed(db, 'SNOW', rows)

  const edition = yearbook('SNOW', 2019)
  for (const day of edition.days) {
    for (const reason of day.reasons) {
      assert.notEqual(
        reason.category,
        'snowiest',
        `${day.date} wurde als schneereichster Tag geführt, mit null Zentimetern`,
      )
    }
  }
})

test('ties halve the score, so only a genuine winner clears the floor', () => {
  const rows = []
  for (const y of Array.from({ length: 40 }, (_, i) => 1980 + i)) {
    rows.push(...plainYear('REAL', y, y === 2019 ? { '2019-01-15': { snow: 22, temp_mean: -4 } } : {}))
  }
  seed(db, 'REAL', rows)

  const edition = yearbook('REAL', 2019)
  const snowDay = edition.days.find((d) => d.date === '2019-01-15')
  assert.ok(snowDay, 'ein 22-cm-Tag gehört in den Jahresrückblick')

  const reason = snowDay.reasons.find((r) => r.category === 'snowiest')
  assert.ok(reason, 'und zwar als schneereichster Tag')
  assert.equal(reason.rank, 1)
  assert.equal(reason.ties, 0)
  assert.equal(reason.score, 1, 'ohne Gleichstand ist die Punktzahl voll')
  assert.ok(reason.score >= edition.minScore)
})

test('every selected day clears the score floor', () => {
  const rows = []
  for (const y of Array.from({ length: 30 }, (_, i) => 1990 + i)) {
    rows.push(
      ...plainYear('FLOOR', y, {
        [`${y}-07-20`]: { temp_max: 25 + (y % 7), temp_mean: 20 + (y % 5) },
        [`${y}-01-10`]: { temp_min: -5 - (y % 9), temp_mean: -3 },
      }),
    )
  }
  seed(db, 'FLOOR', rows)

  const edition = yearbook('FLOOR', 2015)
  for (const day of edition.days) {
    if (day.filler) continue
    const best = Math.max(...day.reasons.map((r) => r.score))
    assert.ok(
      best >= edition.minScore,
      `${day.date} steht mit einer Punktzahl von ${best} in der Liste`,
    )
  }
})
