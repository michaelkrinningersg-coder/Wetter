import { db } from './db.js'

/**
 * Weather as episodes rather than as days.
 *
 * Every other list in this project ranks single days. Memory does not work that
 * way: nobody remembers 9 August 2003, they remember *the summer of 2003*. An
 * episode is a run of days that belong together, and it carries three numbers a
 * single day cannot — how long it lasted, how strong it was, and how often
 * something like it has happened.
 *
 * Two definitions run side by side, because they answer different questions:
 *
 *   Schwelle   Fixed limits, the meteorological conventions: 30 °C, 25 °C,
 *              0 °C, 1 mm. Every sentence is literally checkable, and the
 *              numbers agree with the older "Perioden & Serien" view.
 *   Relativ    The 90th and 10th percentile of the day's own calendar day,
 *              taken from 1961–1990. This is the ETCCDI construction behind
 *              WSDI and CSDI, and it finds what no fixed limit can: the warm
 *              spell of 20 days that ran from 20 December 2022 into January,
 *              where 12 °C is as far above normal as 33 °C is in August.
 *
 * The relative definition needs a base period rather than the whole record. A
 * percentile taken over 1858–2026 would move with the climate it is supposed to
 * measure: by construction a tenth of all days would exceed it, evenly spread,
 * and the trend would vanish into its own yardstick. Against 1961–1990 the
 * count is free to rise, and it does — 15 warm episodes in the 2000s and again
 * in the 2010s against 4 in the 1960s and 1980s.
 */

const DAY = 86_400_000

/* -------------------------------------------------------------------------- */
/* The base period for the relative definition                                */
/* -------------------------------------------------------------------------- */

const BASE = { from: 1961, to: 1990 }

/**
 * Days either side of the calendar day that feed its percentile.
 *
 * Thirty values — one per base year — would put the threshold for 15 February
 * at the mercy of a single mild fortnight in 1974. A window of ±7 days raises
 * the sample to about 450 and smooths the thresholds along the year without
 * flattening the seasonal cycle, which is what the ETCCDI indices do as well.
 */
const WINDOW = 7

/** Below this the base period is too thin to build a threshold from. */
const MIN_BASE_YEARS = 20
const MIN_BASE_SAMPLE = 200

/* -------------------------------------------------------------------------- */
/* The kinds                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What each field means:
 *
 *   `column`    the measured quantity that drives the episode
 *   `limit`     the fixed threshold, or null when the percentile supplies it
 *   `passes`    whether a day belongs to an episode
 *   `excess`    that day's contribution to the strength, always non-negative
 *   `minDays`   how long the longest unbroken run inside an episode must be
 *
 * The absolute thresholds are the ones the older view already uses, so both
 * sub-views tell the same story about the same summer. The relative kinds use
 * six days rather than three because that is the WSDI/CSDI definition, and
 * borrowing a standard's name obliges one to borrow its rule.
 */
const KINDS = [
  {
    key: 'heat',
    mode: 'schwelle',
    label: 'Hitzeepisoden',
    short: 'Hitze',
    note: 'Tage mit einem Höchstwert von mindestens 30 °C.',
    column: 'temp_max',
    unit: '°C',
    decimals: 1,
    limit: 30,
    minDays: 3,
    accent: 'hot',
    peak: 'max',
    peakLabel: 'Höchstwert',
    severityLabel: 'Gradtage über 30 °C',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v) => v >= 30,
    excess: (v) => v - 30,
  },
  {
    key: 'summer',
    mode: 'schwelle',
    label: 'Sommerepisoden',
    short: 'Sommer',
    note: 'Sommertage in Folge, Höchstwert mindestens 25 °C.',
    column: 'temp_max',
    unit: '°C',
    decimals: 1,
    limit: 25,
    minDays: 5,
    accent: 'warm',
    peak: 'max',
    peakLabel: 'Höchstwert',
    severityLabel: 'Gradtage über 25 °C',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v) => v >= 25,
    excess: (v) => v - 25,
  },
  {
    key: 'frost',
    mode: 'schwelle',
    label: 'Frostepisoden',
    short: 'Frost',
    note: 'Frosttage in Folge, Tiefstwert unter 0 °C.',
    column: 'temp_min',
    unit: '°C',
    decimals: 1,
    limit: 0,
    minDays: 10,
    accent: 'cool',
    peak: 'min',
    peakLabel: 'Tiefstwert',
    severityLabel: 'Kältesumme',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v) => v < 0,
    excess: (v) => -v,
  },
  {
    key: 'ice',
    mode: 'schwelle',
    label: 'Dauerfrostepisoden',
    short: 'Dauerfrost',
    note: 'Eistage in Folge — auch das Maximum bleibt unter 0 °C.',
    column: 'temp_max',
    unit: '°C',
    decimals: 1,
    limit: 0,
    minDays: 5,
    accent: 'cold',
    peak: 'min',
    peakLabel: 'höchster Tageswert',
    severityLabel: 'Kältesumme',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v) => v < 0,
    excess: (v) => -v,
  },
  {
    key: 'wet',
    mode: 'schwelle',
    label: 'Niederschlagsepisoden',
    short: 'Niederschlag',
    note: 'Tage in Folge mit mindestens 1 mm Niederschlag.',
    column: 'precipitation',
    unit: 'mm',
    decimals: 1,
    limit: 1,
    minDays: 7,
    accent: 'wet',
    peak: 'max',
    peakLabel: 'nassester Tag',
    severityLabel: 'Niederschlagssumme',
    severityUnit: 'mm',
    severityDecimals: 1,
    passes: (v) => v >= 1,
    excess: (v) => v,
  },
  {
    key: 'dry',
    mode: 'schwelle',
    label: 'Trockenepisoden',
    short: 'Trockenheit',
    note: 'Tage in Folge mit weniger als 1 mm — die meteorologische Definition eines niederschlagsfreien Tages.',
    column: 'precipitation',
    unit: 'mm',
    decimals: 1,
    limit: 1,
    minDays: 10,
    accent: 'dry',
    peak: 'sum',
    peakLabel: 'Niederschlag insgesamt',
    // A dry spell has no magnitude above a threshold; what it has is length.
    // Counting the dry days is the honest measure, and the little rain that did
    // fall is reported next to it rather than hidden.
    severityLabel: 'trockene Tage',
    severityUnit: 'd',
    severityDecimals: 0,
    passes: (v) => v < 1,
    excess: () => 1,
  },
  {
    key: 'warm',
    mode: 'relativ',
    label: 'Warmepisoden',
    short: 'Warm',
    note: 'Höchstwert über dem 90. Perzentil des eigenen Kalendertages (WSDI).',
    column: 'temp_max',
    unit: '°C',
    decimals: 1,
    limit: null,
    percentile: 0.9,
    minDays: 6,
    accent: 'hot',
    peak: 'max',
    peakLabel: 'Höchstwert',
    severityLabel: 'Gradtage über der Schwelle',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v, limit) => v > limit,
    excess: (v, limit) => v - limit,
  },
  {
    key: 'cold',
    mode: 'relativ',
    label: 'Kälteepisoden',
    short: 'Kalt',
    note: 'Tiefstwert unter dem 10. Perzentil des eigenen Kalendertages (CSDI).',
    column: 'temp_min',
    unit: '°C',
    decimals: 1,
    limit: null,
    percentile: 0.1,
    minDays: 6,
    accent: 'cold',
    peak: 'min',
    peakLabel: 'Tiefstwert',
    severityLabel: 'Gradtage unter der Schwelle',
    severityUnit: 'K·d',
    severityDecimals: 1,
    passes: (v, limit) => v < limit,
    excess: (v, limit) => limit - v,
  },
]

export const EPISODE_KEYS = KINDS.map((k) => k.key)

const KIND_BY_KEY = new Map(KINDS.map((k) => [k.key, k]))

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/* -------------------------------------------------------------------------- */
/* The series                                                                 */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT date, year, month, strftime('%m-%d', date) AS key,
         temp_max, temp_min, precipitation
  FROM daily WHERE station_id = ? ORDER BY date
`)

const cache = new Map()

function seriesFor(stationId) {
  const last = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?').get(stationId)
  const cacheKey = `${stationId}|${last?.last ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const rows = seriesStmt.all(stationId)
  const index = rows.length === 0 ? null : { rows, thresholds: new Map() }
  cache.set(cacheKey, index)
  return index
}

/* -------------------------------------------------------------------------- */
/* Percentile thresholds                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One threshold per calendar day, from the base period only.
 *
 * Keyed by `%m-%d` rather than by day of the year: 1 March is the 60th day in
 * three years out of four and the 61st in the fourth, and a threshold that
 * slides by one day every leap year would be quietly wrong every February.
 */
function thresholdsFor(index, column, percentile) {
  const cacheKey = `${column}|${percentile}`
  if (index.thresholds.has(cacheKey)) return index.thresholds.get(cacheKey)

  const byKey = new Map()
  const years = new Set()
  for (const row of index.rows) {
    if (row.year < BASE.from || row.year > BASE.to) continue
    const value = row[column]
    if (value === null) continue
    years.add(row.year)
    if (!byKey.has(row.key)) byKey.set(row.key, [])
    byKey.get(row.key).push(value)
  }

  const keys = [...byKey.keys()].sort()
  const result = { limits: new Map(), years: years.size, covered: 0, keys: keys.length }

  if (years.size >= MIN_BASE_YEARS) {
    for (let i = 0; i < keys.length; i++) {
      const pool = []
      for (let offset = -WINDOW; offset <= WINDOW; offset++) {
        // The calendar wraps: 1 January borrows from late December.
        const at = (i + offset + keys.length) % keys.length
        pool.push(...byKey.get(keys[at]))
      }
      if (pool.length < MIN_BASE_SAMPLE) continue
      pool.sort((a, b) => a - b)
      result.limits.set(keys[i], pool[Math.floor(pool.length * percentile)])
      result.covered++
    }
  }

  index.thresholds.set(cacheKey, result)
  return result
}

/* -------------------------------------------------------------------------- */
/* Finding the episodes                                                       */
/* -------------------------------------------------------------------------- */

const isNextDay = (a, b) => Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`) === DAY

/**
 * Runs of qualifying days, with single interruptions bridged.
 *
 * Two lengths come out of this, and both are reported, because neither alone is
 * honest. A single 29 °C day in the middle of August 2018 does not end the heat
 * wave as anyone lived it — bridged, that episode runs 17 days. But "17 days"
 * must not be read as 17 days above 30 °C, which is why the longest unbroken
 * run inside it (12 days) travels with it. By that second measure the record
 * still belongs to August 2003, with 13 days and no interruption at all.
 *
 * Two rules keep the bridging from inventing episodes:
 *
 *   - Only a *measured* day may bridge. A gap in the archive ends the episode,
 *     because a day nobody recorded cannot be shown to have been close.
 *   - The bridge extends an episode, it never creates one: the longest
 *     unbroken run must already reach the minimum on its own. Without that
 *     rule two separate two-day spells either side of a cool day would become
 *     a "five-day heat wave", and the count for Göttingen would jump from 88
 *     to 190.
 */
function findEpisodes(rows, kind, limits) {
  const episodes = []

  let group = null
  let run = null
  let pendingBreak = null
  let previous = null

  const close = () => {
    if (group) {
      const built = build(group, kind)
      if (built) episodes.push(built)
    }
    group = null
    run = null
    pendingBreak = null
  }

  for (const row of rows) {
    if (previous && !isNextDay(previous.date, row.date)) close()
    previous = row

    const value = row[kind.column]
    const limit = kind.limit === null ? (limits?.get(row.key) ?? null) : kind.limit
    if (value === null || limit === null) {
      close()
      continue
    }

    if (kind.passes(value, limit)) {
      if (!group) group = { days: [], breaks: [], runs: [] }
      if (!run) {
        if (pendingBreak !== null) group.breaks.push(pendingBreak)
        pendingBreak = null
        run = { length: 0 }
        group.runs.push(run)
      }
      run.length++
      group.days.push({ date: row.date, value, limit, excess: kind.excess(value, limit) })
      continue
    }

    // A measured day below the threshold: either the first interruption, which
    // may still be bridged, or the second, which ends the episode.
    if (run) {
      run = null
      pendingBreak = row.date
    } else if (pendingBreak !== null) {
      close()
    }
  }
  close()

  return episodes
}

function build(group, kind) {
  const core = Math.max(...group.runs.map((r) => r.length))
  if (core < kind.minDays) return null

  const days = group.days
  const first = days[0]
  const last = days[days.length - 1]

  let severity = 0
  let peak = first
  let sum = 0
  let limitSum = 0
  for (const day of days) {
    severity += day.excess
    sum += day.value
    limitSum += day.limit
    // A dry spell has no peak worth naming — the driest day is 0 mm, as are
    // most of the others. Its `total` carries the information instead.
    if (kind.peak === 'max' && day.value > peak.value) peak = day
    if (kind.peak === 'min' && day.value < peak.value) peak = day
  }

  return {
    start: first.date,
    end: last.date,
    year: Number(first.date.slice(0, 4)),
    month: Number(first.date.slice(5, 7)),
    /** Calendar days from the first qualifying day to the last. */
    span: days.length + group.breaks.length,
    /** The longest unbroken run inside — the length that needs no footnote. */
    core,
    /** Days actually over the threshold. */
    hits: days.length,
    breaks: group.breaks.length,
    severity,
    peak: kind.peak === 'sum' ? null : { value: peak.value, date: peak.date },
    /** For dry spells the total rain, which is the number that means something. */
    total: sum,
    mean: sum / days.length,
    limitMean: limitSum / days.length,
  }
}

/* -------------------------------------------------------------------------- */
/* Aggregates                                                                 */
/* -------------------------------------------------------------------------- */

const decadeOf = (year) => Math.floor(year / 10) * 10

/**
 * How much of each decade the station actually measured this quantity.
 *
 * Without it the 1880s look quiet for heat episodes, when in truth the maximum
 * thermometer only starts in April 1885 — five years, not ten.
 */
function decadeCoverage(rows, column) {
  const counts = new Map()
  for (const row of rows) {
    if (row[column] === null) continue
    const decade = decadeOf(row.year)
    counts.set(decade, (counts.get(decade) ?? 0) + 1)
  }
  return counts
}

const LIST = 15

export function episodes(stationId, kindKey = 'heat') {
  const kind = KIND_BY_KEY.get(kindKey)
  if (!kind) return null

  const index = seriesFor(stationId)
  if (!index) return null

  const kinds = KINDS.map((k) => ({
    key: k.key,
    mode: k.mode,
    label: k.label,
    short: k.short,
    minDays: k.minDays,
  }))

  let limits = null
  let base = null
  if (kind.mode === 'relativ') {
    const thresholds = thresholdsFor(index, kind.column, kind.percentile)
    limits = thresholds.limits
    base = {
      from: BASE.from,
      to: BASE.to,
      window: WINDOW,
      years: thresholds.years,
      covered: thresholds.covered,
      minYears: MIN_BASE_YEARS,
    }
    if (thresholds.covered === 0) {
      return {
        station: stationId,
        kind: meta(kind),
        kinds,
        base,
        hint:
          `Für die relative Betrachtung fehlt die Basisperiode ${BASE.from}–${BASE.to}:` +
          ` diese Station hat darin nur ${thresholds.years} Jahre mit Messwerten.` +
          ' Ohne feste Vergleichsschwelle ließe sich nur die Reihe an sich selbst messen,' +
          ' und der Trend verschwände in seinem eigenen Maßstab.',
        range: null,
        counts: null,
        decades: [],
        months: [],
        strongest: [],
        longest: [],
        recent: [],
        current: null,
      }
    }
  }

  const measured = index.rows.filter((r) => r[kind.column] !== null)
  const found = findEpisodes(index.rows, kind, limits)

  // Strength decides the rank, not length: a four-day episode at 38 °C is a
  // bigger event than a nine-day one that never left 30 °C, and only the
  // strength says so.
  const bySeverity = [...found].sort((a, b) => b.severity - a.severity)
  bySeverity.forEach((episode, at) => {
    episode.rank = at + 1
  })

  const first = measured[0]?.date ?? null
  const last = measured[measured.length - 1]?.date ?? null
  const years =
    first && last
      ? (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (DAY * 365.2425)
      : 0

  // An empirical statement, not a fitted distribution: the r-th strongest
  // episode was matched or beaten r times in the years on record.
  for (const episode of found) {
    episode.returnYears = years > 0 && episode.rank > 0 ? years / episode.rank : null
    episode.percentile = found.length > 1 ? 1 - (episode.rank - 1) / (found.length - 1) : null
    episode.current = episode.end === last
  }

  const coverage = decadeCoverage(index.rows, kind.column)
  const decades = [...coverage.keys()].sort((a, b) => a - b).map((decade) => {
    const inDecade = found.filter((e) => decadeOf(e.year) === decade)
    return {
      decade,
      count: inDecade.length,
      days: inDecade.reduce((s, e) => s + e.span, 0),
      meanSeverity:
        inDecade.length > 0 ? inDecade.reduce((s, e) => s + e.severity, 0) / inDecade.length : null,
      maxSeverity: inDecade.length > 0 ? Math.max(...inDecade.map((e) => e.severity)) : null,
      /** Measured days in the decade, so a short one is not read as a quiet one. */
      measured: coverage.get(decade) ?? 0,
      share: (coverage.get(decade) ?? 0) / 3652.5,
    }
  })

  const months = MONTHS.map((label, at) => ({
    month: at + 1,
    label,
    count: found.filter((e) => e.month === at + 1).length,
  }))

  return {
    station: stationId,
    kind: meta(kind),
    kinds,
    base,
    range: { first, last, days: measured.length, years },
    counts: {
      episodes: found.length,
      withBreaks: found.filter((e) => e.breaks > 0).length,
      days: found.reduce((s, e) => s + e.span, 0),
      hits: found.reduce((s, e) => s + e.hits, 0),
      perDecade: years > 0 ? (found.length / years) * 10 : null,
    },
    decades,
    months,
    strongest: bySeverity.slice(0, LIST),
    longest: [...found]
      .sort((a, b) => b.span - a.span || b.core - a.core || b.severity - a.severity)
      .slice(0, LIST),
    recent: [...found].sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, LIST),
    current: found.find((e) => e.current) ?? null,
  }
}

function meta(kind) {
  return {
    key: kind.key,
    mode: kind.mode,
    label: kind.label,
    short: kind.short,
    note: kind.note,
    unit: kind.unit,
    decimals: kind.decimals,
    minDays: kind.minDays,
    limit: kind.limit,
    percentile: kind.percentile ?? null,
    accent: kind.accent,
    peak: kind.peak,
    peakLabel: kind.peakLabel,
    severityLabel: kind.severityLabel,
    severityUnit: kind.severityUnit,
    severityDecimals: kind.severityDecimals,
  }
}
