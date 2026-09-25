import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEEPEST,
  deepestFor,
  insertTop,
  KIND_BY_KEY,
  LEVELS,
  rankAmong,
} from '../server/records-kinds.js'

/**
 * Places, not just records.
 *
 * The view can be asked "did this station reach its own best three, five or
 * ten", and three rules decide what comes back. Each one is a decision that
 * could sensibly have gone the other way, which is why each one is written
 * down here rather than left to the reading of the code.
 *
 *  - A place is shared, not taken. The DWD publishes one decimal, so equalling
 *    the third-best value is common; whoever reaches third place is third,
 *    and the alternative lets the calendar decide which of two identical
 *    measurements counts.
 *  - How deep a series may be read follows its length. The top ten of 730 days
 *    is the upper 1.4 %; the top ten of 44,000 days is the upper 0.02 %. One
 *    column headed "Top 10" for both would invite a comparison the numbers do
 *    not support.
 *  - The collector and the replay order values with the same function, because
 *    they meet at the day the daily archive begins and a disagreement there
 *    would be a seam nothing else in the app could explain.
 */

const warm = KIND_BY_KEY.get('temp_max') // direction 'max'
const cold = KIND_BY_KEY.get('temp_min') // direction 'min'

const list = (kind, values) => {
  const out = []
  for (const value of values) insertTop(kind, out, { value, date: `2020-01-0${out.length + 1}` })
  return out
}

/* -------------------------------------------------------------------------- */

test('a shared place is the better place, for everyone who reaches it', () => {
  const top = list(warm, [30, 29, 28])

  // Two values are strictly warmer than 28, so 28 is third — and so is every
  // other 28. Neither of them is fourth.
  assert.equal(rankAmong(warm, 28, top), 3)
  assert.equal(rankAmong(warm, 28.0, top), 3)

  assert.equal(rankAmong(warm, 31, top), 1, 'wärmer als alles ist Platz 1')
  assert.equal(rankAmong(warm, 30, top), 1, 'gleich dem Rekord ist ebenfalls Platz 1')
  assert.equal(rankAmong(warm, 27, top), 4)
})

test('a cold record counts the other way round', () => {
  const top = list(cold, [-20, -18, -15])

  assert.deepEqual(
    top.map((e) => e.value),
    [-20, -18, -15],
    'kälter ist besser, also steht -20 oben',
  )
  assert.equal(rankAmong(cold, -25, top), 1)
  assert.equal(rankAmong(cold, -18, top), 2)
  assert.equal(rankAmong(cold, -10, top), 4)
})

test('the list stays sorted and never grows past ten', () => {
  const top = list(warm, [10, 40, 25, 30, 12, 38, 22, 35, 18, 28, 33, 20, 41])

  assert.equal(top.length, DEEPEST)
  assert.equal(top[0].value, 41, 'der beste Wert steht oben')
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].value >= top[i].value, `nicht sortiert bei ${i}`)
  }
  // Thirteen values went in, the three smallest are gone.
  assert.ok(!top.some((e) => e.value === 10))
  assert.ok(!top.some((e) => e.value === 12))
  assert.ok(!top.some((e) => e.value === 18))
})

test('a tie does not displace: the day that got there first keeps the slot', () => {
  const top = list(warm, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  const wasLast = top.at(-1).date
  assert.equal(top.length, DEEPEST)

  insertTop(warm, top, { value: 1, date: '2026-06-27' })

  assert.equal(top.length, DEEPEST)
  assert.equal(top.at(-1).date, wasLast, 'der ältere Tag behält den zehnten Platz')

  /*
   * Which costs the newer day nothing it was owed. It still reached tenth
   * place, and `rankAmong` still says so — the list only decides what future
   * days are ranked against, and two identical values rank everything
   * identically. Keeping the earlier date is the more informative archive:
   * it records when the value was first reached.
   */
  assert.equal(rankAmong(warm, 1, top), 10)
})

test('how deep a series may be read follows how long it has measured', () => {
  // The rule, as agreed: under ten years only the record counts at all.
  assert.equal(deepestFor(0), 1)
  assert.equal(deepestFor(2), 1)
  assert.equal(deepestFor(9.9), 1)

  assert.equal(deepestFor(10), 3)
  assert.equal(deepestFor(19.9), 3)

  assert.equal(deepestFor(20), 5)
  assert.equal(deepestFor(49.9), 5)

  assert.equal(deepestFor(50), 10)
  assert.equal(deepestFor(240), 10)

  // A series whose length is unknown is read as shallowly as possible rather
  // than as deeply — the safe direction for a number nobody can check.
  assert.equal(deepestFor(NaN), 1)
  assert.equal(deepestFor(undefined), 1)
})

test('every offered level is one a series can actually reach', () => {
  // The switch must not offer a depth that no rule ever grants, or a level
  // would silently be the same as the one before it.
  for (const level of LEVELS) {
    const reachable = [0, 10, 20, 50, 240].some((years) => deepestFor(years) === level)
    assert.ok(reachable, `Stufe ${level} wird von keiner Reihenlänge erreicht`)
  }
  assert.equal(Math.max(...LEVELS), DEEPEST)
})
