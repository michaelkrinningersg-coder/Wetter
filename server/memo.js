/**
 * Answers that stay true until the archive moves.
 *
 * Four modules in this project already did this by hand, and the six that did
 * not were the slow ones: the nationwide standing recomputed 1.28 million rows
 * on every request — 4.5 seconds, the same 4.5 seconds, for a table that
 * changes once a day when the collector runs.
 *
 * The rule the hand-written versions all follow, and the reason this is not a
 * plain `Map`: the key must contain the last day of the archive it reads. A
 * key of "station 01691" alone would serve yesterday's answer forever; a key of
 * "station 01691 up to 2026-09-22" answers instantly until a collector adds a
 * day, and then misses exactly once. Forgetting the stamp is the only way to
 * get this wrong, so `remembered` will not build a key without one.
 *
 * The stamp has to be cheap — see `coverage.js`, which is what it should
 * normally be. A stamp that costs as much as the computation saves nothing.
 */

import { stationStamp } from './coverage.js'

/** How many stamps to keep. Enough for three stations across a day boundary. */
const DEFAULT_LIMIT = 8

/**
 * Wrap `compute` so its result is reused while `stamp` returns the same value.
 *
 * Both are called with the wrapper's own arguments, so a per-station analysis
 * stamps per station. The stamp is the *entire* key — the arguments are not
 * appended to it, because appending them would look like it worked for an
 * options object (`{ days: 30 }` and `{ days: 400 }` both stringify to
 * "[object Object]") and silently serve one window's answer for another. What
 * distinguishes two answers belongs in the stamp, visibly.
 *
 * `null` and `undefined` results are remembered like any other: "this station
 * has no usable series" is an answer, and recomputing it costs the same as
 * computing it.
 *
 * @template {unknown[]} A
 * @template T
 * @param {(...args: A) => string} stamp Everything that distinguishes an answer.
 * @param {(...args: A) => T} compute
 * @param {{ limit?: number }} [options]
 * @returns {(...args: A) => T}
 */
export function remembered(stamp, compute, { limit = DEFAULT_LIMIT } = {}) {
  const cache = new Map()

  return (...args) => {
    const key = stamp(...args)

    if (cache.has(key)) {
      // Re-insert so the least recently used key is the one Map iterates
      // first, which is the one the eviction below drops.
      const value = cache.get(key)
      cache.delete(key)
      cache.set(key, value)
      return value
    }

    const value = compute(...args)
    cache.set(key, value)
    while (cache.size > limit) cache.delete(cache.keys().next().value)
    return value
  }
}

/**
 * The common case: one analysis, one station, valid until that station's own
 * series gains a day.
 *
 * Each wrapped function gets its own cache, so the limit is per analysis and
 * three stations fit twice over — once on each side of an import.
 */
export const perStation = (compute) =>
  remembered((stationId) => `${stationStamp(stationId)}|${stationId}`, compute, { limit: 6 })
