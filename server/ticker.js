import { db } from './db.js'

/**
 * What is running right now, measured against everything that ever ran.
 *
 * Every other analysis here looks backwards at closed events. This one is the
 * only figure in the project that changes from one day to the next: a streak
 * that is still going, with the distance to the record it is chasing and the
 * number of times something like it has happened before. Four dry days mean
 * nothing on their own; four out of a record of sixty-six, a stand that occurs
 * several times a year, is a sentence.
 *
 * Two families, one mechanism. "Serien" count days that keep meeting a
 * criterion — summer days, dry days, days above the calendar-day mean. "Pausen"
 * count days since something last happened — the last frost, the last snow
 * cover. The second is the first with the criterion negated, so both run
 * through the same walk and inherit the same guards.
 *
 * The reference day is the last day in this station's archive, not today. The
 * DWD publishes with a lag of a day or two, and a ticker that quietly counted
 * to the wall clock would add days nobody measured.
 */

const DAY = 86_400_000

/** A calendar day needs this many years before its mean is worth comparing to. */
const MIN_YEARS_FOR_MEAN = 30

/* -------------------------------------------------------------------------- */
/* What is being tracked                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `holds` is what the streak requires of every one of its days. For the
 * "Pausen" family that is the *absence* of the event, and `event` names the
 * thing whose last occurrence is being counted from.
 *
 * `column` is the measurement the criterion needs. A day where it is missing
 * ends the verified streak — see the two lengths below.
 */
const SPECS = [
  {
    key: 'summer',
    family: 'serie',
    label: 'Sommertage in Folge',
    note: 'Höchstwert mindestens 25 °C.',
    column: 'temp_max',
    accent: 'warm',
    holds: (r) => r.temp_max >= 25,
    breakLabel: 'letzter Tag unter 25 °C',
  },
  {
    key: 'hot',
    family: 'serie',
    label: 'Hitzetage in Folge',
    note: 'Höchstwert mindestens 30 °C.',
    column: 'temp_max',
    accent: 'hot',
    holds: (r) => r.temp_max >= 30,
    breakLabel: 'letzter Tag unter 30 °C',
  },
  // No "frostfreie Tage in Folge" here: that series is the exact negation of
  // the frost day and already appears below as "Tage seit dem letzten Frost",
  // which is the same walk with the better sentence.
  {
    key: 'frost',
    family: 'serie',
    label: 'Frosttage in Folge',
    note: 'Tiefstwert unter 0 °C.',
    column: 'temp_min',
    accent: 'cool',
    holds: (r) => r.temp_min < 0,
    breakLabel: 'letzter frostfreier Tag',
  },
  {
    key: 'ice',
    family: 'serie',
    label: 'Eistage in Folge',
    note: 'Auch der Höchstwert bleibt unter 0 °C.',
    column: 'temp_max',
    accent: 'cold',
    holds: (r) => r.temp_max < 0,
    breakLabel: 'letzter Tag über 0 °C',
  },
  {
    key: 'dry',
    family: 'serie',
    label: 'trockene Tage in Folge',
    note: 'Weniger als 1 mm Niederschlag.',
    column: 'precipitation',
    accent: 'dry',
    holds: (r) => r.precipitation < 1,
    breakLabel: 'letzter Tag mit mindestens 1 mm',
  },
  {
    key: 'wet',
    family: 'serie',
    label: 'Regentage in Folge',
    note: 'Mindestens 1 mm Niederschlag.',
    column: 'precipitation',
    accent: 'wet',
    holds: (r) => r.precipitation >= 1,
    breakLabel: 'letzter trockener Tag',
  },
  {
    key: 'above',
    family: 'serie',
    label: 'Tage über dem Kalendermittel',
    note: `Tagesmittel über dem Mittel desselben Kalendertages, gebildet aus mindestens ${MIN_YEARS_FOR_MEAN} Jahren.`,
    column: 'anomaly',
    accent: 'hot',
    holds: (r) => r.anomaly > 0,
    breakLabel: 'letzter Tag unter dem Mittel',
  },
  {
    key: 'below',
    family: 'serie',
    label: 'Tage unter dem Kalendermittel',
    note: `Tagesmittel unter dem Mittel desselben Kalendertages, gebildet aus mindestens ${MIN_YEARS_FOR_MEAN} Jahren.`,
    column: 'anomaly',
    accent: 'cold',
    holds: (r) => r.anomaly < 0,
    breakLabel: 'letzter Tag über dem Mittel',
  },
  {
    key: 'no_frost',
    family: 'pause',
    label: 'Tage seit dem letzten Frost',
    note: 'Gezählt wird der Abstand zum letzten Tiefstwert unter 0 °C.',
    column: 'temp_min',
    accent: 'good',
    holds: (r) => !(r.temp_min < 0),
    event: 'Frosttag',
    breakLabel: 'letzter Frosttag',
  },
  {
    key: 'no_ice',
    family: 'pause',
    label: 'Tage seit dem letzten Eistag',
    note: 'Abstand zum letzten Tag, an dem auch das Maximum unter 0 °C blieb.',
    column: 'temp_max',
    accent: 'good',
    holds: (r) => !(r.temp_max < 0),
    event: 'Eistag',
    breakLabel: 'letzter Eistag',
  },
  {
    key: 'no_hot',
    family: 'pause',
    label: 'Tage seit dem letzten Hitzetag',
    note: 'Abstand zum letzten Höchstwert von mindestens 30 °C.',
    column: 'temp_max',
    accent: 'cool',
    holds: (r) => !(r.temp_max >= 30),
    event: 'Hitzetag',
    breakLabel: 'letzter Hitzetag',
  },
  {
    key: 'no_heavy_rain',
    family: 'pause',
    label: 'Tage seit dem letzten Starkregen',
    note: 'Abstand zum letzten Tag mit mindestens 10 mm Niederschlag.',
    column: 'precipitation',
    accent: 'dry',
    holds: (r) => !(r.precipitation >= 10),
    event: 'Tag mit mindestens 10 mm',
    breakLabel: 'letzter Tag mit mindestens 10 mm',
  },
  {
    key: 'no_snow',
    family: 'pause',
    label: 'Tage seit der letzten Schneedecke',
    note: 'Abstand zum letzten Tag mit einer geschlossenen Decke von mindestens 1 cm.',
    column: 'snow',
    accent: 'cool',
    holds: (r) => !(r.snow >= 1),
    event: 'Tag mit Schneedecke',
    breakLabel: 'letzter Tag mit Schneedecke',
  },
]

/* -------------------------------------------------------------------------- */
/* The series                                                                 */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT date, strftime('%m-%d', date) AS key,
         temp_max, temp_min, temp_mean, precipitation, snow
  FROM daily WHERE station_id = ? ORDER BY date
`)

const cache = new Map()

function seriesFor(stationId) {
  const last = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?').get(stationId)
  const cacheKey = `${stationId}|${last?.last ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const rows = seriesStmt.all(stationId)
  if (rows.length === 0) {
    cache.set(cacheKey, null)
    return null
  }

  // The anomaly is a derived column so the two calendar-mean streaks can use
  // the same missing-value rule as every other criterion: no mean, no day.
  const byKey = new Map()
  for (const row of rows) {
    if (row.temp_mean === null) continue
    if (!byKey.has(row.key)) byKey.set(row.key, [])
    byKey.get(row.key).push(row.temp_mean)
  }
  const means = new Map()
  for (const [key, values] of byKey) {
    if (values.length < MIN_YEARS_FOR_MEAN) continue
    means.set(key, values.reduce((a, b) => a + b, 0) / values.length)
  }
  for (const row of rows) {
    const mean = means.get(row.key)
    row.anomaly = mean === undefined || row.temp_mean === null ? null : row.temp_mean - mean
    row.calendarMean = mean ?? null
  }

  const index = { rows, last: rows[rows.length - 1].date }
  cache.set(cacheKey, index)
  return index
}

const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

/* -------------------------------------------------------------------------- */
/* One tracked series                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every maximal run of days that meet the criterion, plus the current one.
 *
 * A run ends where the criterion fails, where a day is missing from the archive
 * and where the measurement is absent. The last of those three is what makes
 * the two lengths necessary: on 11–15 July 2026 this station reported no
 * minimum temperature at all, so only sixteen days can be *shown* to have been
 * frost-free, while the last recorded frost was 30 April, ninety-two days back.
 * Both numbers are true and they are not equally well supported, so both are
 * reported and labelled.
 */
function trackOne(index, spec) {
  const { rows } = index
  const reference = index.last

  const runs = []
  let start = null
  let length = 0
  let previous = null

  /** The last day on record that failed the criterion — the event itself. */
  let lastBreak = null
  let lastBreakValue = null
  /** How often the criterion ever failed. Zero changes what the row may say. */
  let events = 0

  const close = () => {
    if (start !== null) runs.push({ start, end: previous.date, days: length })
    start = null
    length = 0
  }

  for (const row of rows) {
    const contiguous = previous && daysBetween(previous.date, row.date) === 1
    if (previous && !contiguous) close()

    const value = row[spec.column]
    if (value === null || value === undefined) {
      close()
      previous = row
      continue
    }

    if (spec.holds(row)) {
      if (start === null) {
        start = row.date
        length = 0
      }
      length++
    } else {
      close()
      lastBreak = row.date
      lastBreakValue = value
      events++
    }
    previous = row
  }
  close()

  const running = runs.find((r) => r.end === reference) ?? null
  const past = running ? runs.filter((r) => r !== running) : runs

  const lengths = past.map((r) => r.days)
  const longest = runs.reduce((best, r) => (r.days > (best?.days ?? 0) ? r : best), null)

  const measured = rows.filter((r) => r[spec.column] !== null && r[spec.column] !== undefined)
  const first = measured[0]?.date ?? null
  const lastMeasured = measured[measured.length - 1]?.date ?? null
  const years =
    first && lastMeasured ? Math.max(daysBetween(first, lastMeasured) / 365.2425, 0) : 0

  const days = running?.days ?? 0

  // How far back the claim reaches when the gaps are stepped over: from the
  // last recorded failure of the criterion to the reference day. Counting how
  // many of those days actually carry a measurement is what keeps the second
  // number honest — for the frost-free stretch of summer 2026 that is 92 days
  // of which exactly 5 were never measured, not 76 as a naive difference
  // between the two lengths would suggest.
  const sinceDays = lastBreak ? daysBetween(lastBreak, reference) : null
  let measuredInWindow = 0
  if (lastBreak) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date <= lastBreak) break
      const value = rows[i][spec.column]
      if (value !== null && value !== undefined) measuredInWindow++
    }
  }

  /**
   * Which number the row leads with, and therefore what gets ranked.
   *
   * A stretch since the last frost is the sentence a reader wants; a streak of
   * summer days is the run itself. Ranking the other one would compare the
   * wrong thing — sixteen verified frost-free days would land at place 347
   * while the ninety-two-day stretch they belong to is far rarer.
   */
  /**
   * Whether the thing being counted ever happened here at all.
   *
   * The Brocken has never once reached 30 °C in 130 years. Left unchecked, the
   * row read "1.409 Tage seit dem letzten Hitzetag" — a number that in truth
   * counted from the last hole in the measurements, and a record of 27.381 days
   * that was simply the longest stretch between two such holes. Where the event
   * never occurred, the only true sentence is that it never occurred, and rank,
   * record and frequency are all withheld.
   */
  const never = spec.family === 'pause' ? events === 0 : longest === null

  /**
   * Whether the reference day itself could be judged.
   *
   * The Zugspitze has reported no snow depth at all since 1 February 2026. Of
   * the 180 days since the last snow cover, not one carries a measurement — and
   * the row proudly announced "Platz 1, Rekord übertroffen" on the strength of
   * nothing. A streak needs its last day to have been measured; without that
   * the honest statement is that the series stopped being recorded.
   */
  const measuredToday =
    rows[rows.length - 1][spec.column] !== null && rows[rows.length - 1][spec.column] !== undefined
  const stale = !measuredToday

  const lead = never || stale ? 0 : spec.family === 'pause' ? (sinceDays ?? days) : days
  const longer = lead > 0 ? lengths.filter((n) => n > lead).length : null
  const atLeast = lead > 0 ? lengths.filter((n) => n >= lead).length : null

  return {
    key: spec.key,
    family: spec.family,
    label: spec.label,
    note: spec.note,
    accent: spec.accent,
    event: spec.event ?? null,
    breakLabel: spec.breakLabel,
    reference,
    /** Whether the reference day itself could be judged at all. */
    measuredToday,
    /** True when this quantity has stopped being reported for this station. */
    stale,
    current: {
      days,
      start: running?.start ?? null,
      /** True when the verified run reaches all the way back to the last failure. */
      complete: lastBreak !== null && sinceDays === days,
    },
    since:
      lastBreak === null
        ? null
        : {
            days: sinceDays,
            date: lastBreak,
            value: lastBreakValue,
            measured: measuredInWindow,
            /** Days inside the stretch that carry no measurement at all. */
            missing: sinceDays - measuredInWindow,
          },
    events,
    never,
    record:
      longest && !never
        ? {
            days: longest.days,
            start: longest.start,
            end: longest.end,
            current: longest === running,
          }
        : null,
    /** The number the row leads with, and the one the rank refers to. */
    lead,
    leadBasis: spec.family === 'pause' ? 'since' : 'verified',
    /** Past runs only; the current one is not ranked against itself. */
    rank: longer === null ? null : longer + 1,
    runs: past.length,
    atLeast,
    perYear: atLeast !== null && years > 0 ? atLeast / years : null,
    range: { first, last: lastMeasured, days: measured.length, years },
  }
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function ticker(stationId) {
  const index = seriesFor(stationId)
  if (!index) return null

  const series = SPECS.map((spec) => trackOne(index, spec)).filter((s) => s.range.days > 0)

  return {
    station: stationId,
    reference: index.last,
    minYearsForMean: MIN_YEARS_FOR_MEAN,
    series,
  }
}

/**
 * The two or three lines worth putting on the front page.
 *
 * Rarity decides, not length: forty dry days would be remarkable, forty days
 * above the calendar mean rather less so, and only the frequency of comparable
 * runs can tell the two apart. Anything that happens more often than twice a
 * year is not news.
 */
const HEADLINE_LIMIT = 3
const HEADLINE_MAX_PER_YEAR = 2

export function tickerHeadlines(stationId, limit = HEADLINE_LIMIT) {
  const result = ticker(stationId)
  if (!result) return null

  return result.series
    .filter((s) => s.lead > 0 && s.perYear !== null && s.perYear <= HEADLINE_MAX_PER_YEAR)
    .sort((a, b) => a.perYear - b.perYear)
    .slice(0, limit)
    .map((s) => ({
      key: s.key,
      family: s.family,
      label: s.label,
      accent: s.accent,
      days: s.lead,
      verified: s.current.days,
      complete: s.current.complete,
      since: s.since?.days ?? null,
      record: s.record?.days ?? null,
      recordEnd: s.record?.end ?? null,
      rank: s.rank,
      runs: s.runs,
      perYear: s.perYear,
      reference: s.reference,
    }))
}
