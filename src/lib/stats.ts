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
  /** Half-width of the 95 % confidence band for the mean response at `x`. */
  confidenceAt: (x: number) => number
  /** Coefficient of determination — how much of the variance the line explains. */
  r2: number
  /** Standard error of the slope. */
  slopeError: number
  /** Two-sided t statistic for H0: slope = 0. */
  tStatistic: number
  /** True when |t| clears the 95 % threshold for this sample size. */
  isSignificant: boolean
  n: number
}

/**
 * Critical two-sided t value at alpha = 0.05.
 *
 * Interpolating a full t-distribution would be overkill here: the series has
 * dozens to hundreds of years, and the value converges to 1.96 quickly.
 */
function tCritical(df: number): number {
  if (df <= 1) return 12.71
  if (df <= 2) return 4.3
  if (df <= 5) return 2.57
  if (df <= 10) return 2.23
  if (df <= 20) return 2.09
  if (df <= 30) return 2.04
  if (df <= 60) return 2.0
  if (df <= 120) return 1.98
  return 1.96
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
  const at = (x: number) => slope * x + intercept

  const meanX = sumX / n
  const meanY = sumY / n

  let ssTotal = 0
  let ssResidual = 0
  let ssX = 0
  for (const { x, y } of points) {
    ssTotal += (y - meanY) ** 2
    ssResidual += (y - at(x)) ** 2
    ssX += (x - meanX) ** 2
  }

  const df = n - 2
  const r2 = ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal
  // Residual variance; df <= 0 means the line passes exactly through the data
  // and no dispersion can be estimated.
  const residualVariance = df > 0 ? ssResidual / df : 0
  const slopeError = df > 0 && ssX > 0 ? Math.sqrt(residualVariance / ssX) : 0
  const tStatistic = slopeError > 0 ? slope / slopeError : 0
  const tCrit = tCritical(df)

  const confidenceAt = (x: number) => {
    if (df <= 0 || ssX === 0) return 0
    return (
      tCrit *
      Math.sqrt(residualVariance * (1 / n + (x - meanX) ** 2 / ssX))
    )
  }

  return {
    slope,
    intercept,
    at,
    confidenceAt,
    r2,
    slopeError,
    tStatistic,
    isSignificant: Math.abs(tStatistic) > tCrit,
    n,
  }
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
