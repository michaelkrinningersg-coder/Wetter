import { db } from './db.js'

/**
 * Where the running month stands, and how much of that is still open.
 *
 * A monthly figure is only ever quoted when the month is over. Halfway through
 * it is the most-asked question and the least-answered one: is this a warm
 * July? The honest answer has two parts, and this view keeps them apart.
 *
 * The first part is measured. The days that exist are compared with the *same
 * days* of every other year — 1 to 15 July against every other 1 to 15 July,
 * never against complete Julys. That comparison needs no forecast and is as
 * solid on the 3rd as on the 30th.
 *
 * The second part is open. What the month will finally read depends on days
 * nobody has seen, so the remainder is replayed from every year on record that
 * measured it completely: about 150 members, each giving one possible ending.
 * The spread of those endings is the answer to "how much can this still move",
 * and it is the reason the same view is nearly worthless on the 2nd and quite
 * firm on the 28th — for July 2023 the possible final place ran from 16th to
 * 134th of 152 after two days and from 39th to 66th after twenty-eight.
 */

/**
 * The project's existing rule for rating a month, reused here so the ranks
 * agree with the heatmap's. Twenty-five of thirty-one days is not arbitrary:
 * below it a monthly mean starts to describe the days that happened to be
 * measured rather than the month.
 */
const MIN_MONTH_DAYS = 25

/** How much of a partial window must be measured before it may be ranked. */
const MIN_WINDOW_SHARE = 0.9

/**
 * Means and sums behave differently when a month is incomplete.
 *
 * A mean over twenty days is an estimate of the month's mean. A sum over twenty
 * days is not an estimate of the month's sum — it is strictly less than it. The
 * `kind` decides how the projection puts the two halves together and how the
 * partial figure may be read.
 */
const FIELDS = [
  {
    key: 'temp',
    column: 'temp_mean',
    kind: 'mean',
    label: 'Mitteltemperatur',
    short: 'Temperatur',
    unit: '°C',
    decimals: 1,
    accent: 'hot',
    /** Rank 1 is the warmest, the wettest, the sunniest. */
    high: 'wärmster',
    low: 'kältester',
  },
  {
    key: 'precip',
    column: 'precipitation',
    kind: 'sum',
    label: 'Niederschlagssumme',
    short: 'Niederschlag',
    unit: 'mm',
    decimals: 1,
    accent: 'wet',
    high: 'nassester',
    low: 'trockenster',
  },
  {
    key: 'sun',
    column: 'sunshine',
    kind: 'sum',
    label: 'Sonnenscheindauer',
    short: 'Sonne',
    unit: 'h',
    decimals: 1,
    accent: 'warm',
    high: 'sonnigster',
    low: 'trübster',
  },
]

export const BALANCE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/** Length of a calendar month, leap years included. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/* -------------------------------------------------------------------------- */
/* The series                                                                 */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT year, month, day, temp_mean, precipitation, sunshine
  FROM daily WHERE station_id = ? AND month = ? ORDER BY year, day
`)

const lastStmt = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?')

const cache = new Map()

function monthFor(stationId, month) {
  const last = lastStmt.get(stationId)?.last ?? ''
  const cacheKey = `${stationId}|${month}|${last}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const rows = seriesStmt.all(stationId, month)
  if (rows.length === 0) {
    cache.set(cacheKey, null)
    return null
  }

  const byYear = new Map()
  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, [])
    byYear.get(row.year).push(row)
  }

  const index = { month, byYear, last }
  cache.set(cacheKey, index)
  return index
}

/* -------------------------------------------------------------------------- */
/* Aggregating one window                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sum or mean over the days of one year that fall inside `[from, to]`.
 *
 * Returns the number of days that carried a measurement alongside the value, so
 * every caller can decide for itself whether that is enough — none of them may
 * treat a gap as a zero.
 */
function aggregate(days, field, from, to) {
  let sum = 0
  let count = 0
  for (const day of days) {
    if (day.day < from || day.day > to) continue
    const value = day[field.column]
    if (value === null || value === undefined) continue
    sum += value
    count++
  }
  if (count === 0) return { value: null, days: 0 }
  return { value: field.kind === 'mean' ? sum / count : sum, days: count, sum }
}

/** Places counting from the high end; ties share the better place. */
function rankOf(values, value) {
  if (value === null) return null
  let better = 0
  for (const other of values) if (other > value) better++
  return better + 1
}

/* -------------------------------------------------------------------------- */
/* The live part                                                              */
/* -------------------------------------------------------------------------- */

const QUANTILES = [0.1, 0.5, 0.9]

function quantile(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

/**
 * The ensemble: every past year's remainder, pasted onto this year's beginning.
 *
 * A member only counts when it measured *every* remaining day. Scaling a
 * member's partial sum up to full length would invent rain that was never
 * recorded, and for the mean it would silently weight some years more than
 * others — with a hundred and fifty candidates there is no need for either.
 */
function project(index, field, year, cut, length, observed) {
  const restDays = length - cut
  if (restDays <= 0) return null
  if (observed.value === null) return null

  const members = []
  for (const [otherYear, days] of index.byYear) {
    if (otherYear === year) continue
    const rest = aggregate(days, field, cut + 1, length)
    if (rest.days < restDays) continue
    members.push(
      field.kind === 'mean'
        ? (observed.sum + rest.sum) / (observed.days + rest.days)
        : observed.sum + rest.sum,
    )
  }
  if (members.length === 0) return null

  members.sort((a, b) => a - b)
  return {
    members: members.length,
    restDays,
    min: members[0],
    max: members[members.length - 1],
    quantiles: QUANTILES.map((p) => ({ p, value: quantile(members, p) })),
  }
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `asOf` pretends the archive ended on an earlier day.
 *
 * It exists so the projection can be checked against a month whose ending is
 * already known: replay July 2023 as it looked on the 10th, then compare the
 * spread with what actually happened. Without that seam the interesting half of
 * this module could only ever be verified by waiting.
 */
export function monthBalance(stationId, month, asOf = null) {
  const index = monthFor(stationId, month)
  if (!index) return null

  const reference = asOf && asOf < index.last ? asOf : index.last
  const [lastYear, lastMonth, lastDay] = reference.split('-').map(Number)
  const running = lastMonth === month ? lastYear : null
  const cut = running === null ? null : lastDay

  const years = [...index.byYear.keys()].sort((a, b) => a - b)

  const fields = FIELDS.map((field) => {
    const length = (year) => daysInMonth(year, month)

    /* ---- every year's complete month ------------------------------------- */
    const history = []
    for (const year of years) {
      const days = index.byYear.get(year)
      const full = aggregate(days, field, 1, length(year))
      history.push({
        year,
        value: full.value,
        days: full.days,
        of: length(year),
        rated: full.days >= MIN_MONTH_DAYS,
      })
    }

    const rated = history.filter((h) => h.rated)
    const values = rated.map((h) => h.value)
    for (const entry of history) {
      entry.rank = entry.rated ? rankOf(values, entry.value) : null
      entry.total = rated.length
    }

    /* ---- the running month ----------------------------------------------- */
    let live = null
    if (running !== null && cut !== null) {
      const days = index.byYear.get(running) ?? []
      const monthLength = length(running)
      const observed = aggregate(days, field, 1, cut)
      // A complete month is judged by the project's own rule; a partial window
      // by its own length, so the 3rd of the month is not held to 25 days.
      const needed =
        cut >= monthLength ? MIN_MONTH_DAYS : Math.ceil(cut * MIN_WINDOW_SHARE)

      // The same window in every other year, so the measured part of the month
      // is compared with a measured part and not with a whole one.
      const windowValues = []
      for (const [otherYear, otherDays] of index.byYear) {
        if (otherYear === running) continue
        if (cut > daysInMonth(otherYear, month)) continue
        const window = aggregate(otherDays, field, 1, cut)
        if (window.days < needed) continue
        windowValues.push(window.value)
      }

      const enough = observed.days >= needed
      const projection = enough
        ? project(index, field, running, cut, monthLength, observed)
        : null

      // Where each possible ending would land among the complete months. The
      // high end of the spread is the low rank number for every field here,
      // because rank 1 always means the largest value.
      const rankAt = (value) => (value === null ? null : rankOf(values, value))
      const spread = projection
        ? {
            best: rankAt(projection.max),
            worst: rankAt(projection.min),
            p10: rankAt(projection.quantiles[0].value),
            p50: rankAt(projection.quantiles[1].value),
            p90: rankAt(projection.quantiles[2].value),
          }
        : null

      live = {
        year: running,
        cut,
        monthLength,
        measured: observed.days,
        /** Days of the window that carry no measurement — the silent ones. */
        missing: cut - observed.days,
        needed,
        enough,
        value: observed.value,
        window: {
          years: windowValues.length,
          rank: enough ? rankOf(windowValues, observed.value) : null,
          total: windowValues.length + (enough ? 1 : 0),
        },
        projection,
        rankSpread: spread,
        complete: cut >= monthLength,
      }
    }

    return {
      key: field.key,
      label: field.label,
      short: field.short,
      unit: field.unit,
      decimals: field.decimals,
      accent: field.accent,
      kind: field.kind,
      high: field.high,
      low: field.low,
      history,
      rated: rated.length,
      live,
    }
  })

  return {
    station: stationId,
    month,
    monthName: MONTHS[month - 1],
    reference,
    archiveLast: index.last,
    running,
    years,
    minMonthDays: MIN_MONTH_DAYS,
    minWindowShare: MIN_WINDOW_SHARE,
    quantiles: QUANTILES,
    fields,
  }
}

/**
 * The one tile the dashboard shows: where the running month stands right now.
 *
 * Only the temperature, and only when the measured part is large enough to be
 * ranked at all — a headline that says "place 3 of 168" on the strength of four
 * days would be worse than no headline.
 */
export function monthBalanceHeadline(stationId) {
  const last = lastStmt.get(stationId)?.last
  if (!last) return null

  const month = Number(last.slice(5, 7))
  const result = monthBalance(stationId, month)
  const field = result?.fields.find((f) => f.key === 'temp')
  const live = field?.live
  if (!live || !live.enough || live.value === null) return null

  return {
    year: live.year,
    month,
    monthName: result.monthName,
    reference: result.reference,
    cut: live.cut,
    monthLength: live.monthLength,
    measured: live.measured,
    missing: live.missing,
    complete: live.complete,
    value: live.value,
    unit: field.unit,
    decimals: field.decimals,
    window: live.window,
    spread: live.rankSpread,
    members: live.projection?.members ?? null,
  }
}
