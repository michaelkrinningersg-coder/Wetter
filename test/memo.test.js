import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The rule that makes a remembered answer safe to serve.
 *
 * Every expensive analysis in this app is now held until the archive behind it
 * moves, which turned 4.5 seconds per request into 18 milliseconds. The whole
 * construction rests on one question: can the archive change without the stamp
 * changing? If it can, the app shows yesterday's numbers and says nothing.
 *
 * The obvious stamp is the newest day, and it is wrong. `fetch-germany.js
 * --backfill` walks the DWD's rolling window and fills in the days *behind*
 * the newest one — the archive gains a hundred days while `MAX(date)` sits
 * still. The first test below is that case, and it is the one that a plain
 * last-date stamp fails.
 */

const db = await freshArchive()
// Imported for its schema: `germany_daily` and `daily` are created by the
// modules that own them, and the stamps below read both.
await import('../server/germany.js')
const { stationStamp, tableStamp } = await import('../server/coverage.js')
const { perStation, remembered } = await import('../server/memo.js')

const insert = db.prepare(
  'INSERT OR REPLACE INTO germany_daily (date, station_id, temp_max) VALUES (?, ?, ?)',
)
const insertStation = db.prepare(
  'INSERT OR REPLACE INTO daily (station_id, date, year, month, day, temp_max)' +
    ' VALUES (?, ?, ?, ?, ?, ?)',
)

/* -------------------------------------------------------------------------- */

test('a day added behind the newest one still changes the stamp', () => {
  insert.run('2026-09-20', 'A', 20)
  const before = tableStamp('germany_daily')

  // A backfill: older than the newest day the archive holds, so `MAX(date)`
  // does not move.
  insert.run('2026-09-01', 'A', 18)

  assert.notEqual(
    tableStamp('germany_daily'),
    before,
    'ein nachgetragener Tag muss den Stempel ändern, sonst bleibt die Antwort falsch',
  )
})

test('the same rule holds for one station', () => {
  insertStation.run('01691', '2026-09-20', 2026, 9, 20, 24)
  const before = stationStamp('01691')

  insertStation.run('01691', '2026-09-01', 2026, 9, 1, 22)
  assert.notEqual(stationStamp('01691'), before)

  // And a different station is a different stamp, or two stations would share
  // one answer.
  insertStation.run('00722', '2026-09-20', 2026, 9, 20, 11)
  assert.notEqual(stationStamp('00722'), stationStamp('01691'))
})

test('the answer is computed once and then handed out', () => {
  let calls = 0
  const analyse = remembered(() => tableStamp('germany_daily'), () => ++calls)

  assert.equal(analyse(), 1)
  assert.equal(analyse(), 1)
  assert.equal(analyse(), 1)
  assert.equal(calls, 1, 'dreimal gefragt, einmal gerechnet')

  insert.run('2026-09-21', 'A', 21)
  assert.equal(analyse(), 2, 'nach einer Änderung muss neu gerechnet werden')
})

test('the stamp is the whole key, so two windows cannot share an answer', () => {
  // The trap this rules out: appending the arguments to the stamp looks like
  // it works until an options object turns up, because `{ days: 30 }` and
  // `{ days: 400 }` both stringify to "[object Object]".
  const seen = []
  const analyse = remembered(
    ({ days }) => `fest|${days}`,
    ({ days }) => {
      seen.push(days)
      return days
    },
  )

  assert.equal(analyse({ days: 30 }), 30)
  assert.equal(analyse({ days: 400 }), 400)
  assert.equal(analyse({ days: 30 }), 30)
  assert.deepEqual(seen, [30, 400])
})

test('a null answer is remembered like any other', () => {
  let calls = 0
  const analyse = remembered(
    () => 'fest',
    () => {
      calls++
      return null
    },
  )

  assert.equal(analyse(), null)
  assert.equal(analyse(), null)
  assert.equal(calls, 1, '"diese Station hat keine Reihe" ist auch eine Antwort')
})

test('the cache stays small, and drops what was asked for longest ago', () => {
  const computed = []
  const analyse = remembered(
    (n) => `fest|${n}`,
    (n) => {
      computed.push(n)
      return n
    },
    { limit: 2 },
  )

  analyse(1)
  analyse(2)
  analyse(1) // 1 is now the most recent, so 2 is the one to go
  analyse(3)

  analyse(1)
  assert.deepEqual(computed, [1, 2, 3], '1 muss noch da sein')

  analyse(2)
  assert.deepEqual(computed, [1, 2, 3, 2], '2 war das älteste und musste weichen')
})

test('per station means per station', () => {
  const computed = []
  const analyse = perStation((stationId) => {
    computed.push(stationId)
    return stationId
  })

  analyse('01691')
  analyse('00722')
  analyse('01691')
  assert.deepEqual(computed, ['01691', '00722'])

  insertStation.run('01691', '2026-09-22', 2026, 9, 22, 25)
  analyse('01691')
  analyse('00722')
  assert.deepEqual(
    computed,
    ['01691', '00722', '01691'],
    'nur die Station, deren Reihe gewachsen ist, wird neu gerechnet',
  )
})
