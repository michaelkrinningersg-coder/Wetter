import { db } from './db.js'

/**
 * A year in ten days.
 *
 * The nationwide "notable days" ranks the whole archive at once and answers
 * "which were the loudest days ever". This asks the smaller and more personal
 * question: take one year out of the hundred and sixty-eight, and say what
 * happened in it — automatically, for every year, without anyone curating.
 *
 * A day is notable when it is unusual *for its calendar day*, not for the year.
 * The 3rd of January at 14 °C is remarkable; the 3rd of July at 14 °C is
 * remarkable too, and in the other direction. Ranking each day against every
 * other 3rd of January in the record makes both statements without a seasonal
 * correction, and it produces a sentence a reader can check: "the warmest 3rd
 * of January in 168 years".
 *
 * Ten days chosen by picking the best day in each category first, then filling
 * with the highest-ranked remainder. Ranking by score alone would return the
 * same heatwave five times.
 */

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The ways a day can stand out.
 *
 * Two of them are derived rather than measured: the day's range is the gap
 * between its own maximum and minimum, and the jump is how far its mean moved
 * from the day before. Both are things people notice and neither is a column.
 */
export const YEARBOOK_CATEGORIES = [
  { key: 'hottest', label: 'Heißester Tag', field: 'temp_max', direction: 'max', unit: '°C', decimals: 1, accent: 'hot' },
  { key: 'coldest', label: 'Kälteste Nacht', field: 'temp_min', direction: 'min', unit: '°C', decimals: 1, accent: 'cold' },
  { key: 'warmest_mean', label: 'Wärmster Tag im Mittel', field: 'temp_mean', direction: 'max', unit: '°C', decimals: 1, accent: 'warm' },
  { key: 'coldest_mean', label: 'Kältester Tag im Mittel', field: 'temp_mean', direction: 'min', unit: '°C', decimals: 1, accent: 'cool' },
  { key: 'wettest', label: 'Nassester Tag', field: 'precipitation', direction: 'max', unit: 'mm', decimals: 1, accent: 'wet' },
  { key: 'windiest', label: 'Stärkste Bö', field: 'wind_max', direction: 'max', unit: 'm/s', decimals: 1, accent: 'brand' },
  { key: 'snowiest', label: 'Höchste Schneedecke', field: 'snow', direction: 'max', unit: 'cm', decimals: 0, accent: 'cool' },
  { key: 'sunniest', label: 'Sonnigster Tag', field: 'sunshine', direction: 'max', unit: 'h', decimals: 1, accent: 'warm' },
  { key: 'lowest_pressure', label: 'Tiefster Luftdruck', field: 'pressure', direction: 'min', unit: 'hPa', decimals: 1, accent: 'brand' },
  { key: 'widest_range', label: 'Größter Tagesgang', field: 'range', direction: 'max', unit: 'K', decimals: 1, accent: 'dry' },
  { key: 'biggest_jump', label: 'Größter Sprung zum Vortag', field: 'jump', direction: 'max', unit: 'K', decimals: 1, accent: 'neutral' },
]

const FIELDS = [...new Set(YEARBOOK_CATEGORIES.map((c) => c.field))]

/* -------------------------------------------------------------------------- */
/* The station's series, indexed by calendar day                              */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT date, year, month, day, strftime('%m-%d', date) AS key,
         temp_mean, temp_max, temp_min, precipitation, wind_max, snow, sunshine, pressure
  FROM daily WHERE station_id = ? ORDER BY date
`)

/**
 * Sorted values per calendar day, so a rank is a binary search.
 *
 * Building this costs one pass and about four megabytes; every year afterwards
 * is instant, which matters because the static build renders all 168 of them.
 * The comparison pool is the exact calendar day, not a window around it: 168
 * values are enough to say "the warmest 12th of August on record", and pooling
 * a fortnight would make that sentence untrue.
 */
const cache = new Map()

function indexFor(stationId) {
  const last = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?').get(stationId)
  const cacheKey = `${stationId}|${last?.last ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const rows = seriesStmt.all(stationId)
  if (rows.length === 0) {
    cache.set(cacheKey, null)
    return null
  }

  // The two derived quantities, computed while the rows are still in order.
  let previous = null
  for (const row of rows) {
    row.range =
      row.temp_max !== null && row.temp_min !== null ? row.temp_max - row.temp_min : null
    row.jump =
      previous && row.temp_mean !== null && previous.temp_mean !== null &&
      Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`) === 86_400_000
        ? Math.abs(row.temp_mean - previous.temp_mean)
        : null
    previous = row
  }

  const byKey = new Map()
  const byYear = new Map()
  for (const row of rows) {
    let day = byKey.get(row.key)
    if (!day) {
      day = Object.fromEntries(FIELDS.map((f) => [f, []]))
      byKey.set(row.key, day)
    }
    for (const field of FIELDS) {
      if (row[field] !== null && row[field] !== undefined) day[field].push(row[field])
    }

    if (!byYear.has(row.year)) byYear.set(row.year, [])
    byYear.get(row.year).push(row)
  }

  for (const day of byKey.values()) {
    for (const field of FIELDS) day[field].sort((a, b) => a - b)
  }

  const index = {
    rows,
    byKey,
    byYear,
    years: [...byYear.keys()].sort((a, b) => a - b),
    first: rows[0].date,
    last: rows.at(-1).date,
  }
  cache.set(cacheKey, index)
  return index
}

/** How many values in a sorted array are strictly below a value. */
function countBelow(sorted, value) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** How many are below or equal — the other end of the tie block. */
function countAtMost(sorted, value) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Rank within the calendar day, counting ties as sharing the place.
 *
 * The DWD publishes one decimal, so ties are common and a strict "how many are
 * above me" would give two identical values different ranks. Both get the
 * better one, and the count of equals travels along so the view can say "shared
 * with two other years".
 *
 * The score is a midrank, not one minus the rank, and that difference matters.
 * On the 1st of May the snow depth is 0 cm in 159 of 160 years; by rank that
 * day is first, and the first version of this page duly announced "highest snow
 * cover — best value for a 1st of May" under a value of nought. Counting ties
 * as half puts it at 0.50 instead of 1.00, which is what it is: exactly average.
 */
function rankOf(sorted, value, direction) {
  const n = sorted.length
  if (n === 0) return null

  const below = countBelow(sorted, value)
  const atMost = countAtMost(sorted, value)
  const equal = atMost - below
  const strictlyBetter = direction === 'max' ? n - atMost : below
  const strictlyWorse = direction === 'max' ? below : n - atMost

  return {
    rank: strictlyBetter + 1,
    of: n,
    ties: Math.max(0, equal - 1),
    /** Share of other years this day beats, ties counting half. */
    score: n > 1 ? (strictlyWorse + (equal - 1) / 2) / (n - 1) : 1,
  }
}

/**
 * How far above the field a day has to be before it is worth a sentence.
 *
 * Without a floor the filler picks whatever is left, and in a thin year that is
 * a day in the middle of its own distribution dressed up as a highlight.
 */
const MIN_SCORE = 0.9

/* -------------------------------------------------------------------------- */
/* One year                                                                   */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const HIGHLIGHTS = 10

/**
 * A year's own summary, for the header of the review.
 *
 * The place among all years is what turns "9,5 °C" into a statement. Years with
 * fewer than 330 measured days are excluded from the ranking rather than
 * ranked with a gap in them, and the count says so.
 */
function yearSummary(index, year) {
  const rows = index.byYear.get(year) ?? []
  const mean = (field) => {
    const values = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined)
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
  }
  const sum = (field) => {
    const values = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined)
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
  }

  const MIN_DAYS = 330
  const complete = []
  for (const [y, list] of index.byYear) {
    const temps = list.filter((r) => r.temp_mean !== null)
    if (temps.length < MIN_DAYS) continue
    complete.push({
      year: y,
      mean: temps.reduce((a, r) => a + r.temp_mean, 0) / temps.length,
      precipitation: list
        .filter((r) => r.precipitation !== null)
        .reduce((a, r) => a + r.precipitation, 0),
    })
  }

  const place = (list, key, direction) => {
    const me = list.find((e) => e.year === year)
    if (!me) return null
    const better = list.filter((e) =>
      direction === 'max' ? e[key] > me[key] : e[key] < me[key],
    ).length
    return { place: better + 1, of: list.length, value: me[key] }
  }

  return {
    year,
    days: rows.length,
    measured: rows.filter((r) => r.temp_mean !== null).length,
    minDays: MIN_DAYS,
    tempMean: mean('temp_mean'),
    precipitation: sum('precipitation'),
    sunshine: sum('sunshine'),
    warmthPlace: place(complete, 'mean', 'max'),
    wetPlace: place(complete, 'precipitation', 'max'),
  }
}

export function yearbook(stationId, year) {
  const index = indexFor(stationId)
  if (!index) return null

  const target = year ?? index.years.at(-1)
  const rows = index.byYear.get(target)
  if (!rows) {
    return {
      station: stationId,
      years: index.years,
      range: { first: index.first, last: index.last },
      year: target,
      hint: `Für ${target} liegen keine Messwerte vor.`,
      summary: null,
      days: [],
    }
  }

  // Every day, scored in every category it has a value for.
  const scored = []
  for (const row of rows) {
    const day = index.byKey.get(row.key)
    if (!day) continue

    const reasons = []
    for (const category of YEARBOOK_CATEGORIES) {
      const value = row[category.field]
      if (value === null || value === undefined) continue
      const ranked = rankOf(day[category.field], value, category.direction)
      if (!ranked || ranked.score < MIN_SCORE) continue
      reasons.push({ category: category.key, value, ...ranked })
    }
    if (reasons.length === 0) continue

    reasons.sort((a, b) => b.score - a.score || a.rank - b.rank)
    scored.push({
      date: row.date,
      month: row.month,
      day: row.day,
      label: `${row.day}. ${MONTHS[row.month - 1]}`,
      values: Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null])),
      reasons,
      score: reasons[0].score,
      best: reasons[0],
    })
  }

  // The winner of each category first, so the ten days give ten reasons.
  const chosen = new Map()
  for (const category of YEARBOOK_CATEGORIES) {
    let best = null
    for (const entry of scored) {
      const reason = entry.reasons.find((r) => r.category === category.key)
      if (!reason) continue
      if (!best || reason.score > best.reason.score || (reason.score === best.reason.score && reason.rank < best.reason.rank)) {
        best = { entry, reason }
      }
    }
    if (!best) continue
    const held = chosen.get(best.entry.date)
    if (held) held.headlines.push({ ...best.reason, leading: false })
    else
      chosen.set(best.entry.date, {
        ...best.entry,
        filler: false,
        headlines: [{ ...best.reason, leading: true }],
      })
  }

  const picked = [...chosen.values()].sort((a, b) => {
    const bestOf = (e) => Math.max(...e.headlines.map((h) => h.score))
    return bestOf(b) - bestOf(a) || a.date.localeCompare(b.date)
  })

  // A thin early year has fewer measured categories than places — wind and
  // sunshine did not exist in 1858. The remaining slots go to whatever else
  // stood out, flagged so the view does not present them as category winners:
  // they are the second-best pressure day, not "the" pressure day.
  if (picked.length < HIGHLIGHTS) {
    for (const entry of [...scored].sort((a, b) => b.score - a.score)) {
      if (picked.length >= HIGHLIGHTS) break
      if (chosen.has(entry.date)) continue
      chosen.set(entry.date, {
        ...entry,
        filler: true,
        headlines: [{ ...entry.best, leading: true }],
      })
      picked.push(chosen.get(entry.date))
    }
  }

  const strip = ({ score: _score, best: _best, ...rest }) => rest
  const top = picked.slice(0, HIGHLIGHTS)

  return {
    station: stationId,
    years: index.years,
    range: { first: index.first, last: index.last },
    year: target,
    categories: YEARBOOK_CATEGORIES,
    highlights: HIGHLIGHTS,
    minScore: MIN_SCORE,
    summary: yearSummary(index, target),
    days: [...top].sort((a, b) => a.date.localeCompare(b.date)).map(strip),
    /**
     * Eleven categories compete for ten places. The ones that missed the cut
     * are named rather than dropped — otherwise a year would silently lose its
     * wettest day and nobody could tell.
     */
    runnersUp: picked.slice(HIGHLIGHTS).map(strip),
  }
}

/** Which years the static build has to render. */
export function yearbookYears(stationId) {
  return indexFor(stationId)?.years ?? []
}
