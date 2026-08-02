import assert from 'node:assert/strict'
import test from 'node:test'

import { everyYear, freshArchive, seed } from './helpers/fixture.js'

/**
 * Kaplan-Meier with right censoring. The trap it exists to avoid: a record that
 * still stands has not "survived for ever", it has survived *so far*, and
 * counting it as either fallen or immortal bends the curve. The other trap is
 * the fair clock — a record set at the third observation of its calendar day is
 * beaten by two thirds of all later values, which says nothing about the
 * weather and everything about where in the archive it sits.
 */

const db = await freshArchive()
const { recordSurvival } = await import('../server/calendar-records.js')

/**
 * One calendar day, one value per year, so every spell can be counted by hand.
 * The values climb by one every ten years: each new record therefore stands for
 * exactly ten years before the next beats it.
 */
function ladder(station, from, to, monthDay = '06-15') {
  const rows = everyYear(from, to, monthDay).map((date, at) => ({
    date,
    temp_max: 20 + Math.floor(at / 10),
    temp_min: 10,
    temp_mean: 15,
    precipitation: 1,
  }))
  seed(db, station, rows)
}

test('a record that still stands is censored, not counted as fallen', () => {
  ladder('CENSOR', 1900, 1999)
  const result = recordSurvival('CENSOR')
  const field = result.fields.find((f) => f.key === 'temp_max_high')
  assert.ok(field?.overall, 'keine Überlebenskurve')

  const { n, events, censored } = field.overall
  assert.equal(n, events + censored, 'jede Reihe ist entweder gefallen oder zensiert')
  assert.equal(censored, 1, 'genau der stehende Rekord ist zensiert')
  assert.ok(events > 0)
})

test('the estimate never rises and stays inside nought and one', () => {
  const field = recordSurvival('CENSOR').fields.find((f) => f.key === 'temp_max_high')
  let previous = 1
  for (const point of field.overall.curve) {
    assert.ok(point.survival >= 0 && point.survival <= 1, `S(${point.t}) = ${point.survival}`)
    assert.ok(point.survival <= previous + 1e-12, `S steigt bei t = ${point.t}`)
    assert.ok(point.atRisk >= 0)
    previous = point.survival
  }
})

test('records that all stand exactly ten years put the median at ten', () => {
  const field = recordSurvival('CENSOR').fields.find((f) => f.key === 'temp_max_high')
  // Each record is beaten by the value ten years later, so half of them have
  // fallen by the time ten years are up — and none before.
  assert.ok(field.overall.median !== null, 'kein Median geschätzt')
  assert.ok(
    field.overall.median >= 9 && field.overall.median <= 11,
    `Median bei ${field.overall.median} statt bei zehn Jahren`,
  )
  const atFive = field.overall.curve.find((p) => p.t === 5)
  assert.ok(atFive && atFive.survival > 0.99, 'vor zehn Jahren darf keiner gefallen sein')
})

test('the observation clock carries the expectation k/(k+m) beside the estimate', () => {
  const field = recordSurvival('CENSOR').fields.find((f) => f.key === 'temp_max_high')
  assert.ok(field.overallSteps, 'keine Kurve auf der Beobachtungsuhr')
  assert.ok(field.overallSteps.meanOrdinal > 0, 'ohne mittleres k ist die Uhr nicht fair')

  for (const point of field.overallSteps.curve) {
    if (point.expected === null || point.expected === undefined) continue
    assert.ok(point.expected > 0 && point.expected <= 1, `Erwartung ${point.expected} bei m = ${point.t}`)
    // k/(k+m) falls as m grows, and never below zero.
    assert.ok(point.ratio === null || point.ratio >= 0)
  }
  const grid = field.overallSteps.curve.map((p) => p.t)
  assert.deepEqual([...grid].sort((a, b) => a - b), grid, 'Beobachtungsgitter nicht aufsteigend')
})

test('a series too short for a curve returns nothing rather than a straight line', () => {
  ladder('SHORT', 1990, 1994)
  const result = recordSurvival('SHORT')
  if (result === null) return // nothing to draw, which is the honest answer

  const field = result.fields.find((f) => f.key === 'temp_max_high')
  assert.ok(
    !field?.overall || field.overall.n <= 4,
    'aus fünf Jahren darf keine belastbare Kurve entstehen',
  )
})

test('the longest completed spell and the longest standing one are kept apart', () => {
  ladder('SPELLS', 1900, 1999)
  const result = recordSurvival('SPELLS')
  assert.ok(Array.isArray(result.longest.completed))
  assert.ok(Array.isArray(result.longest.standing))

  for (const spell of result.longest.completed) {
    assert.ok(spell.until, 'eine abgeschlossene Reihe braucht ein Ende')
    assert.ok(spell.until > spell.date)
  }
  for (const spell of result.longest.standing) {
    assert.equal(spell.until, null, 'eine stehende Reihe hat kein Ende')
  }
})
