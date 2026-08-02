import assert from 'node:assert/strict'
import test from 'node:test'

import { addReading, eastKm, finishShape, northKm, solve } from '../server/nationwide-shape.js'

/**
 * The only module in this project that is pure arithmetic, and therefore the
 * only one that can be tested without an archive at all.
 */

test('solve returns the exact solution of a small system', () => {
  // 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
  const x = solve(
    [
      [2, 1],
      [1, 3],
    ],
    [5, 10],
  )
  assert.equal(x.length, 2)
  assert.ok(Math.abs(x[0] - 1) < 1e-9, `x war ${x[0]}`)
  assert.ok(Math.abs(x[1] - 3) < 1e-9, `y war ${x[1]}`)
})

test('solve reports a singular system instead of returning nonsense', () => {
  // The second row is twice the first: no unique solution exists.
  const x = solve(
    [
      [1, 2],
      [2, 4],
    ],
    [3, 6],
  )
  assert.equal(x, null)
})

test('northKm and eastKm shrink east-west distances with the cosine of latitude', () => {
  // One degree of latitude is about 111 km everywhere.
  assert.ok(Math.abs(northKm(51) - northKm(50) - 111) < 2)
  // One degree of longitude is shorter the further north one goes.
  const atFifty = eastKm(50, 11) - eastKm(50, 10)
  const atFiftyFive = eastKm(55, 11) - eastKm(55, 10)
  assert.ok(atFifty > atFiftyFive, 'ein Längengrad wird nach Norden hin nicht kürzer')
  assert.ok(Math.abs(atFifty - 111 * Math.cos((50 * Math.PI) / 180)) < 1)
})

/** A synthetic country where temperature depends only on altitude. */
function station(id, lat, lon, elevation, temp) {
  return {
    station: { id, name: id, state: 'XX', elevation, lat, lon },
    row: { temp_mean: temp, temp_max: temp + 5, temp_min: temp - 5 },
  }
}

test('a day built from a known lapse rate is recovered by the fit', () => {
  const days = new Map()
  // −0,65 K per 100 m, spread over a grid so position cannot explain anything.
  const built = []
  let n = 0
  for (let lat = 48; lat <= 54; lat += 0.5) {
    for (let lon = 7; lon <= 13; lon += 0.5) {
      const elevation = ((n * 37) % 900) + 50
      built.push(station(`S${n}`, lat, lon, elevation, 20 - 0.0065 * elevation))
      n++
    }
  }
  for (const entry of built) addReading(days, '2020-06-01', entry.station, entry.row)

  const [shape] = finishShape(days)
  assert.ok(shape, 'kein Tag berechnet')
  assert.equal(shape.date, '2020-06-01')
  assert.equal(shape.stations, built.length)
  assert.ok(Math.abs(shape.lapse - -0.65) < 0.02, `Höhengradient war ${shape.lapse}`)
  assert.ok(shape.lapseR2 > 0.99, `Bestimmtheitsmaß nur ${shape.lapseR2}`)
  // With no horizontal signal in the data the horizontal gradients must vanish.
  assert.ok(Math.abs(shape.gradN) < 0.02, `Nord-Süd-Gefälle ${shape.gradN}`)
  assert.ok(Math.abs(shape.gradE) < 0.02, `West-Ost-Gefälle ${shape.gradE}`)
})

test('a day with too few stations carries extremes but no fitted slope', () => {
  const days = new Map()
  for (let i = 0; i < 5; i++) {
    addReading(days, '2020-06-02', station(`T${i}`, 50 + i * 0.1, 10, 100 * i, 20 - i).station, {
      temp_mean: 20 - i,
      temp_max: 25 - i,
      temp_min: 15 - i,
    })
  }
  const [shape] = finishShape(days)
  assert.equal(shape.stations, 5)
  assert.equal(shape.lapse, null, 'aus fünf Stationen darf kein Gradient gerechnet werden')
  assert.equal(shape.gradH, null)
  // The extremes need no fit and must survive.
  assert.equal(shape.absHi, 25)
  assert.equal(shape.absLo, 11)
})
