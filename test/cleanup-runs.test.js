import assert from 'node:assert/strict'
import test from 'node:test'

import { expired } from '../scripts/cleanup-runs.js'

/**
 * Which workflow runs get thrown away.
 *
 * The rule is three lines long and deletes things that cannot be brought back,
 * which is reason enough to write down what it must never do. Two of the four
 * cases below are the ones that would hurt: counting across workflows instead
 * of within them, which would let a chatty job evict every release; and
 * touching a run that has not finished, which on a runner includes the cleanup
 * itself.
 */

const DAY = 86_400_000
const NOW = Date.parse('2026-10-05T12:00:00Z')

/** A run `age` days old. */
const run = (id, workflow_id, age, extra = {}) => ({
  id,
  workflow_id,
  name: `Workflow ${workflow_id}`,
  created_at: new Date(NOW - age * DAY).toISOString(),
  status: 'completed',
  ...extra,
})

const ids = (runs, options) =>
  expired(runs, { now: NOW, ...options })
    .map((r) => r.id)
    .sort((a, b) => a - b)

/* -------------------------------------------------------------------------- */

test('the newest few of each workflow survive, however old they are', () => {
  // One workflow, nothing recent: five stay, the rest go.
  const runs = Array.from({ length: 9 }, (_, i) => run(100 + i, 1, 100 + i))

  assert.deepEqual(ids(runs, { keep: 5, days: 14 }), [105, 106, 107, 108])
})

test('counting is per workflow, not across all of them', () => {
  /*
   * The case this rules out: a job that runs nightly and one that runs on a
   * release. Count the five newest across the repository and the nightly owns
   * all five by Friday, taking every release page with it.
   */
  const nightly = Array.from({ length: 8 }, (_, i) => run(200 + i, 1, 20 + i))
  const release = Array.from({ length: 3 }, (_, i) => run(300 + i, 2, 60 + i * 30))

  const doomed = ids([...nightly, ...release], { keep: 5, days: 14 })

  // Three of the eight nightly runs go; all three releases are within their
  // own workflow's five and stay, even though two of them are older than
  // everything the nightly job produced.
  assert.deepEqual(doomed, [205, 206, 207])
})

test('anything young enough stays, even past the count', () => {
  const runs = Array.from({ length: 12 }, (_, i) => run(400 + i, 1, i))

  // Twelve runs from the last twelve days: the five newest survive the count,
  // the other seven survive the fortnight.
  assert.deepEqual(ids(runs, { keep: 5, days: 14 }), [])

  // Shorten the window and the ones past both rules go. 407 is exactly seven
  // days old and stays: the boundary belongs to the keeping side, because
  // "everything from the last seven days" reads as including the seventh.
  assert.deepEqual(ids(runs, { keep: 5, days: 7 }), [408, 409, 410, 411])

  // A minute past it, and it goes.
  const older = runs.map((r) => (r.id === 407 ? { ...r, created_at: new Date(NOW - 7 * DAY - 60_000).toISOString() } : r))
  assert.deepEqual(ids(older, { keep: 5, days: 7 }), [407, 408, 409, 410, 411])
})

test('a run that has not finished is never touched', () => {
  const runs = [
    ...Array.from({ length: 6 }, (_, i) => run(500 + i, 1, 100 + i)),
    // Old by every measure, and still going — on a runner this is the cleanup
    // looking at itself.
    run(599, 1, 200, { status: 'in_progress' }),
    run(598, 1, 300, { status: 'queued' }),
  ]

  const doomed = ids(runs, { keep: 5, days: 14 })
  assert.deepEqual(doomed, [505], 'nur der sechste abgeschlossene Lauf')
  assert.ok(!doomed.includes(599))
  assert.ok(!doomed.includes(598))
})

test('a workflow with fewer runs than the limit loses nothing', () => {
  const runs = [run(600, 1, 400), run(601, 1, 500), run(602, 1, 600)]
  assert.deepEqual(ids(runs, { keep: 5, days: 14 }), [])
})

test('runs sharing a timestamp are ordered, so the same one goes every time', () => {
  // Two runs can be created in the same second. Without the id as tiebreak the
  // sort is unstable across calls and a different one is deleted each time —
  // which looks like a flaky rule and is really an unordered comparison.
  const same = new Date(NOW - 100 * DAY).toISOString()
  const runs = [
    { id: 701, workflow_id: 1, name: 'A', created_at: same, status: 'completed' },
    { id: 702, workflow_id: 1, name: 'A', created_at: same, status: 'completed' },
    { id: 703, workflow_id: 1, name: 'A', created_at: same, status: 'completed' },
  ]

  const first = ids(runs, { keep: 2, days: 14 })
  const second = ids([...runs].reverse(), { keep: 2, days: 14 })
  assert.deepEqual(first, [701], 'die kleinste Kennung gilt als die älteste')
  assert.deepEqual(first, second, 'die Eingabereihenfolge darf nichts ändern')
})
