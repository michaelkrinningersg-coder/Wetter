import { db } from './db.js'

/**
 * How the whole distribution moved, not just its middle.
 *
 * Every other trend in this project reports a mean: one number a decade, a line
 * through a cloud. "One degree warmer" is true and says almost nothing about
 * what changed — a mean can rise because the cold tail shortened, because the
 * warm tail grew, or because everything shifted together, and those are
 * different climates.
 *
 * With 60,000 daily values there is no need to guess. The same days, sorted
 * into bands and counted per reference period, show which part of the year
 * actually moved.
 *
 * Shares rather than counts, because the periods hold slightly different
 * numbers of valid days and a bar chart of raw counts would show that instead
 * of the climate.
 */

/**
 * The reference periods compared.
 *
 * The two WMO normals plus the one before them, so the sequence is three equal
 * thirty-year blocks rather than two arbitrary ends. 1961–1990 is the middle
 * one and the usual point of comparison.
 */
export const PERIODS = [
  { key: 'p1931', from: 1931, to: 1960, label: '1931–1960' },
  { key: 'p1961', from: 1961, to: 1990, label: '1961–1990' },
  { key: 'p1991', from: 1991, to: 2020, label: '1991–2020' },
]

/**
 * The quantities whose distribution is worth showing.
 *
 * Each carries the band width its scale calls for: two degrees for daily
 * temperature means, which spread over about forty; five for the maxima, which
 * spread further.
 */
export const DISTRIBUTION_FIELDS = [
  {
    key: 'temp_mean',
    column: 'temp_mean',
    label: 'Tagesmittel der Temperatur',
    short: 'Tagesmittel',
    unit: '°C',
    width: 2,
    decimals: 1,
  },
  {
    key: 'temp_max',
    column: 'temp_max',
    label: 'Tageshöchsttemperatur',
    short: 'Höchsttemperatur',
    unit: '°C',
    width: 2,
    decimals: 1,
  },
  {
    key: 'temp_min',
    column: 'temp_min',
    label: 'Tagestiefsttemperatur',
    short: 'Tiefsttemperatur',
    unit: '°C',
    width: 2,
    decimals: 1,
  },
]

export const FIELD_BY_KEY = new Map(DISTRIBUTION_FIELDS.map((f) => [f.key, f]))

/**
 * Percentiles reported alongside the bands.
 *
 * The tails are the point — a distribution can shift at the 5th percentile
 * without moving the 95th, and saying so in numbers is more precise than any
 * bar chart.
 */
const QUANTILES = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]

/* -------------------------------------------------------------------------- */

const valuesStmt = (column) =>
  db.prepare(
    `SELECT ${column} AS value FROM daily
     WHERE station_id = ? AND year BETWEEN ? AND ? AND ${column} IS NOT NULL
     ORDER BY ${column}`,
  )

/** Linear-interpolated quantile over a sorted array. */
function quantile(sorted, p) {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

/**
 * How many days a period needs before it is offered.
 *
 * Thirty years is about 10,900 days; below 9,000 the period has lost a fifth of
 * itself and its tails are no longer comparable with a complete one.
 */
const MIN_DAYS = 9000

export function distributionFor(stationId, fieldKey) {
  const field = FIELD_BY_KEY.get(fieldKey)
  if (!field) return null

  const read = valuesStmt(field.column)

  const periods = []
  for (const period of PERIODS) {
    const sorted = read.all(stationId, period.from, period.to).map((r) => r.value)
    if (sorted.length < MIN_DAYS) continue

    const bands = new Map()
    for (const value of sorted) {
      const from = Math.floor(value / field.width) * field.width
      bands.set(from, (bands.get(from) ?? 0) + 1)
    }

    periods.push({
      ...period,
      days: sorted.length,
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      quantiles: QUANTILES.map((p) => ({ p, value: quantile(sorted, p) })),
      bands: [...bands.entries()]
        .map(([from, count]) => ({
          from,
          to: from + field.width,
          days: count,
          share: (count / sorted.length) * 100,
        }))
        .sort((a, b) => a.from - b.from),
    })
  }

  if (periods.length < 2) return null

  // One aligned band list, so the view can put the periods side by side without
  // reconciling three different sets of bins.
  const edges = new Set()
  for (const period of periods) for (const band of period.bands) edges.add(band.from)

  const aligned = [...edges]
    .sort((a, b) => a - b)
    .map((from) => {
      const row = { from, to: from + field.width }
      for (const period of periods) {
        row[period.key] = period.bands.find((b) => b.from === from)?.share ?? 0
      }
      return row
    })

  const first = periods[0]
  const last = periods.at(-1)

  /** Where the change is largest, in percentage points. */
  const shifts = aligned
    .map((row) => ({
      from: row.from,
      to: row.to,
      change: row[last.key] - row[first.key],
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

  return {
    field,
    minDays: MIN_DAYS,
    periods,
    bands: aligned,
    comparison: {
      from: first.label,
      to: last.label,
      meanChange: last.mean - first.mean,
      quantileChange: QUANTILES.map((p) => ({
        p,
        from: first.quantiles.find((q) => q.p === p)?.value ?? null,
        to: last.quantiles.find((q) => q.p === p)?.value ?? null,
      })).map((q) => ({ ...q, change: q.to !== null && q.from !== null ? q.to - q.from : null })),
      biggestGain: shifts.find((s) => s.change > 0) ?? null,
      biggestLoss: shifts.find((s) => s.change < 0) ?? null,
    },
  }
}

/**
 * Threshold counts as days per year, which is what a reader can picture.
 *
 * The bands answer "how much of the year", these answer "how many days" — the
 * same fact in the unit people actually use when they say a summer was hot.
 */
const THRESHOLDS = [
  { key: 'ice', column: 'temp_max', op: '<', value: 0, label: 'Eistage', note: 'Höchstwert unter 0 °C' },
  { key: 'frost', column: 'temp_min', op: '<', value: 0, label: 'Frosttage', note: 'Tiefstwert unter 0 °C' },
  { key: 'summer', column: 'temp_max', op: '>=', value: 25, label: 'Sommertage', note: 'Höchstwert ab 25 °C' },
  { key: 'hot', column: 'temp_max', op: '>=', value: 30, label: 'Heiße Tage', note: 'Höchstwert ab 30 °C' },
  {
    key: 'tropical',
    column: 'temp_min',
    op: '>=',
    value: 20,
    label: 'Tropennächte',
    note: 'Tiefstwert ab 20 °C',
  },
]

/**
 * How many days the oldest period must hold before a percentage is formed.
 *
 * The absolute change is always sayable: minus six ice days is minus six ice
 * days whatever the starting point. A percentage is not, because it divides by
 * that starting point — and on the Brocken the oldest period holds exactly one
 * tropical night. The change to four of them is "+260 %", a number that looks
 * authoritative and would swing by hundreds of points if that single night had
 * fallen either side of the period boundary.
 *
 * Ten is a floor, not a guarantee of precision: even there a single day moves
 * the result by ten points. Below it the figure is not shaky but meaningless,
 * so it is left out rather than qualified.
 */
const MIN_BASE_DAYS = 10

function relativeChange(base, now) {
  if (base.perYear === 0 || base.days < MIN_BASE_DAYS) return null
  return ((now.perYear - base.perYear) / base.perYear) * 100
}

export function thresholdShift(stationId) {
  const out = []

  for (const threshold of THRESHOLDS) {
    const perPeriod = []
    for (const period of PERIODS) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS hits,
                  (SELECT COUNT(DISTINCT year) FROM daily
                   WHERE station_id = ? AND year BETWEEN ? AND ? AND ${threshold.column} IS NOT NULL) AS years
           FROM daily
           WHERE station_id = ? AND year BETWEEN ? AND ? AND ${threshold.column} ${threshold.op} ?`,
        )
        .get(
          stationId,
          period.from,
          period.to,
          stationId,
          period.from,
          period.to,
          threshold.value,
        )

      if (!row || row.years < 25) continue
      perPeriod.push({ ...period, perYear: row.hits / row.years, days: row.hits, years: row.years })
    }

    if (perPeriod.length < 2) continue

    // The whole record, not just the three periods. Göttingen has had three
    // tropical nights since 1858 and none since 1988 — "0.0 per year" is
    // correct but reads like a gap, and the count says what it actually is.
    const ever = db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM daily
         WHERE station_id = ? AND ${threshold.column} ${threshold.op} ?`,
      )
      .get(stationId, threshold.value)

    const base = perPeriod[0]
    const now = perPeriod.at(-1)

    out.push({
      ...threshold,
      periods: perPeriod,
      change: now.perYear - base.perYear,
      changePercent: relativeChange(base, now),
      ever: { days: ever?.n ?? 0, first: ever?.first ?? null, last: ever?.last ?? null },
    })
  }

  return out
}

export function distributionOverview(stationId) {
  const fields = []
  for (const field of DISTRIBUTION_FIELDS) {
    const result = distributionFor(stationId, field.key)
    if (result) fields.push(result)
  }
  if (fields.length === 0) return null

  return {
    station: stationId,
    periods: PERIODS,
    minDays: MIN_DAYS,
    quantiles: QUANTILES,
    minBaseDays: MIN_BASE_DAYS,
    fields,
    thresholds: thresholdShift(stationId),
  }
}

export const DISTRIBUTION_FIELD_KEYS = DISTRIBUTION_FIELDS.map((f) => f.key)
