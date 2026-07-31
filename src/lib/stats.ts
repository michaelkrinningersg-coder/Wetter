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
