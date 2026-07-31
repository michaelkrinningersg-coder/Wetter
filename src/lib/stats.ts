/** Shared statistics helpers.
 *
 *  The original app inlined the same least-squares fit in `TempTrend` and
 *  `PrecipTrend` (and neither guarded against a zero denominator, which
 *  produces `NaN` trend lines when a filter leaves a single year selected).
 */

export interface LinearFit {
  slope: number
  intercept: number
  /** Value the fitted line takes at `x`. */
  at: (x: number) => number
}

export function linearFit(points: { x: number; y: number }[]): LinearFit | null {
  const n = points.length
  if (n < 2) return null

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const { x, y } of points) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }

  const denominator = n * sumXX - sumX * sumX
  // All x-values identical -> vertical line, no meaningful fit.
  if (denominator === 0) return null

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept, at: (x: number) => slope * x + intercept }
}

/** Linear-interpolated percentile over a pre-sorted ascending array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac
}

/**
 * Centered moving average over an x-axis that may have gaps.
 *
 * Used for the 30-year climate mean: a single regression line over 160+ years
 * asserts that the warming is linear, which it is not — very little happens
 * before ~1980 and then it steepens. A centered running mean shows that shape
 * instead of averaging it away.
 *
 * The window is centered, so the curve deliberately stops half a window short
 * of both ends: there is no honest 30-year mean centered on the last year.
 * `minCoverage` allows for missing years inside the window (early measurement
 * series have gaps) without inventing values for them.
 */
export function centeredMovingAverage(
  points: { x: number; y: number }[],
  window: number,
  minCoverage = 0.8,
): Map<number, number> {
  const byX = new Map(points.map((p) => [p.x, p.y]))
  const half = Math.floor(window / 2)
  const required = Math.ceil(window * minCoverage)
  const result = new Map<number, number>()

  for (const { x } of points) {
    let sum = 0
    let count = 0
    for (let offset = -half; offset <= half; offset++) {
      const value = byX.get(x + offset)
      if (value !== undefined) {
        sum += value
        count += 1
      }
    }
    if (count >= required) result.set(x, sum / count)
  }
  return result
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Extremum plus the record it came from, in one pass. */
export function extremeBy<T>(
  items: T[],
  value: (item: T) => number | null,
  direction: 'max' | 'min',
): T | null {
  let best: T | null = null
  let bestValue = direction === 'max' ? -Infinity : Infinity
  for (const item of items) {
    const v = value(item)
    if (v === null || !Number.isFinite(v)) continue
    if (direction === 'max' ? v > bestValue : v < bestValue) {
      bestValue = v
      best = item
    }
  }
  return best
}
