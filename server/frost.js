import { db } from './db.js'
import { vegetation } from './queries.js'

/**
 * The gap between the start of growth and the last frost.
 *
 * Two things move independently. The growing season begins earlier — this
 * project measures that twice over, once from the temperature series and once,
 * entirely separately, from volunteers recording when a hazel flowered. The
 * last spring frost does not move at all. What lies between them is the stretch
 * in which plants are already growing and can still be killed, and it has grown
 * from about five weeks to about ten.
 *
 * That is the whole analysis. It needs no model: both dates are read off the
 * same station's own record.
 *
 * One threshold does need arguing about, and the payload argues it out loud.
 * The six-day 5 °C rule is scanned from 1 January, so a mild New Year sets the
 * "start of growth" to the first week of the year — thirteen times in 141 years,
 * spread across the whole record. Those years are not errors (the warm spell
 * really happened) but "growth began on 1 January" is not a claim worth making.
 * Excluding them shrinks the finding without reversing it, so all three
 * variants are computed and shipped together rather than one being picked and
 * called the answer.
 */

/**
 * The window a "spring frost" can fall in.
 *
 * From 1 February to the end of June. January frosts are winter, not a threat
 * to anything growing; and after June a frost at this latitude and altitude
 * would be a different phenomenon than the one this asks about — in 168 years
 * the latest ever falls well inside the window, so the upper bound never binds.
 */
const FROST_FROM = 32
const FROST_TO = 181

/** Below this, a year has too few frost days for its "last frost" to mean much. */
const MIN_FROST_DAYS = 1

const lastFrostStmt = db.prepare(`
  SELECT year,
         MAX(CAST(strftime('%j', date) AS INTEGER)) AS day,
         COUNT(*) AS frostDays,
         MIN(temp_min) AS coldest
  FROM daily
  WHERE station_id = ? AND temp_min < 0
    AND CAST(strftime('%j', date) AS INTEGER) BETWEEN ? AND ?
  GROUP BY year
  HAVING frostDays >= ?
  ORDER BY year
`)

const frostDateStmt = db.prepare(`
  SELECT date, temp_min FROM daily
  WHERE station_id = ? AND year = ? AND temp_min < 0
    AND CAST(strftime('%j', date) AS INTEGER) = ?
  LIMIT 1
`)

/**
 * The variants shipped side by side.
 *
 * `minStart` is the earliest day of the year a vegetation start is allowed to
 * count. 0 keeps everything the rule produced.
 */
export const FROST_VARIANTS = [
  { key: 'all', minStart: 0, label: 'Alle Jahre', note: 'Wie die Sechs-Tage-Regel sie liefert.' },
  {
    key: 'jan15',
    minStart: 15,
    label: 'Beginn ab 15. Januar',
    note: 'Ohne die Jahre, in denen ein milder Jahresanfang die Regel sofort auslöst.',
  },
  {
    key: 'feb',
    minStart: 31,
    label: 'Beginn ab Februar',
    note: 'Die strengste Auswahl — nur Jahre mit einem Beginn im eigentlichen Frühjahr.',
  },
]

/**
 * The risk window, year by year.
 *
 * A year only counts when both ends exist: the vegetation start comes from the
 * six-day rule this project already uses elsewhere, the last frost from the
 * same station's minimum temperatures. Years where the last frost falls before
 * the season starts get a negative window, which is not an error — it is a year
 * in which nothing was ever exposed, and dropping those would bias the mean
 * upward.
 */
export function frostRisk(stationId, { minStart = 0 } = {}) {
  const season = vegetation(stationId)
  if (!season?.records?.length) return null

  const byYear = new Map(season.records.map((r) => [r.year, r]))
  const frosts = lastFrostStmt.all(stationId, FROST_FROM, FROST_TO, MIN_FROST_DAYS)

  const points = []
  for (const frost of frosts) {
    const start = byYear.get(frost.year)
    if (!start) continue
    if (start.startDayOfYear <= minStart) continue

    const date = frostDateStmt.get(stationId, frost.year, frost.day)
    points.push({
      year: frost.year,
      /** Day of year the growing season began, by the six-day 5 °C rule. */
      start: start.startDayOfYear,
      startDate: start.startDate,
      /** Day of year of the last frost between February and June. */
      frost: frost.day,
      frostDate: date?.date ?? null,
      frostTemp: date?.temp_min ?? null,
      frostDays: frost.frostDays,
      /** Days of exposure. Negative means the frost came before growth began. */
      window: frost.day - start.startDayOfYear,
    })
  }

  if (points.length < 20) return null

  const mean = (list, pick) =>
    list.length === 0 ? null : list.reduce((a, p) => a + pick(p), 0) / list.length

  const first = points.slice(0, 30)
  const last = points.slice(-30)

  /** Years where the frost fell after growth had started — the exposed ones. */
  const exposed = points.filter((p) => p.window > 0)

  return {
    station: stationId,
    minStart,
    range: { first: points[0].year, last: points.at(-1).year, years: points.length },
    base: season.base,
    runLength: season.runLength,
    frostWindow: { from: FROST_FROM, to: FROST_TO },
    points,
    summary: {
      /** Thirty-year ends, the same span the project uses for reference periods. */
      earlyYears: [first[0].year, first.at(-1).year],
      lateYears: [last[0].year, last.at(-1).year],
      earlyStart: mean(first, (p) => p.start),
      lateStart: mean(last, (p) => p.start),
      earlyFrost: mean(first, (p) => p.frost),
      lateFrost: mean(last, (p) => p.frost),
      earlyWindow: mean(first, (p) => p.window),
      lateWindow: mean(last, (p) => p.window),
      exposedYears: exposed.length,
      exposedShare: exposed.length / points.length,
      /** The single widest exposure on record. */
      widest: points.reduce((a, b) => (b.window > a.window ? b : a)),
    },
  }
}

/**
 * All three variants at once.
 *
 * The point of shipping them together is that the reader sees how much the
 * headline depends on one methodological choice. It does depend on it — the
 * window grows either way, but "doubled" is only true for the unfiltered
 * version.
 */
export function frostRiskAll(stationId) {
  const variants = []
  for (const variant of FROST_VARIANTS) {
    const result = frostRisk(stationId, { minStart: variant.minStart })
    if (result) variants.push({ ...variant, ...result })
  }
  if (variants.length === 0) return null

  return {
    station: stationId,
    frostWindow: variants[0].frostWindow,
    base: variants[0].base,
    runLength: variants[0].runLength,
    variants,
  }
}
