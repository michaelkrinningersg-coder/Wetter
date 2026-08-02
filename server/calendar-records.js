import { db } from './db.js'

/**
 * Records per calendar day, and the history of how they changed hands.
 *
 * One engine for several questions that all need the same walk through the
 * series: how old the standing records are, which calendar days hold records
 * from which era, which years left the most records behind, how long a record
 * survives, and which days came close without ever appearing in a list.
 *
 * The walk is in date order, so a value only counts as a record if it beat what
 * stood *before* it — the same rule the nationwide record replay uses. Every
 * time a record changes hands the old one gets an end date, which turns the
 * series into a list of spells rather than a list of dates.
 *
 * Calendar days are keyed by month and day, never by day of the year: the 1st
 * of March is day 60 in an ordinary year and 61 in a leap year, so a
 * `strftime('%j')` key would compare the 1st of March with the 29th of February
 * for a quarter of the record.
 */

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The quantities a record is worth stating for.
 *
 * Both directions where both are meaningful — the coldest daily mean is as much
 * a record as the warmest, and their ages differ in a way that is the whole
 * point of the age view. Only one direction where the other is trivial: the
 * lowest daily precipitation is zero on half of all days.
 */
export const RECORD_FIELDS = [
  {
    key: 'temp_max_high',
    column: 'temp_max',
    direction: 'max',
    label: 'Höchsttemperatur',
    short: 'Höchstwert',
    unit: '°C',
    decimals: 1,
    warm: true,
  },
  {
    key: 'temp_min_low',
    column: 'temp_min',
    direction: 'min',
    label: 'Tiefsttemperatur',
    short: 'Tiefstwert',
    unit: '°C',
    decimals: 1,
    warm: false,
  },
  {
    key: 'temp_mean_high',
    column: 'temp_mean',
    direction: 'max',
    label: 'Wärmstes Tagesmittel',
    short: 'Wärmstes Mittel',
    unit: '°C',
    decimals: 1,
    warm: true,
  },
  {
    key: 'temp_mean_low',
    column: 'temp_mean',
    direction: 'min',
    label: 'Kältestes Tagesmittel',
    short: 'Kältestes Mittel',
    unit: '°C',
    decimals: 1,
    warm: false,
  },
  {
    key: 'precipitation',
    column: 'precipitation',
    direction: 'max',
    label: 'Tagesniederschlag',
    short: 'Niederschlag',
    unit: 'mm',
    decimals: 1,
    warm: null,
    zeroIsAbsence: true,
  },
  {
    key: 'snow',
    column: 'snow',
    direction: 'max',
    label: 'Schneehöhe',
    short: 'Schnee',
    unit: 'cm',
    decimals: 0,
    warm: false,
    zeroIsAbsence: true,
  },
  {
    key: 'wind_max',
    column: 'wind_max',
    direction: 'max',
    label: 'Windböe',
    short: 'Bö',
    unit: 'm/s',
    decimals: 1,
    warm: null,
    note: 'Böen werden erst seit 1969 gemessen — die Reihe ist ein Drittel so lang wie die der Temperatur.',
  },
  {
    key: 'sunshine',
    column: 'sunshine',
    direction: 'max',
    label: 'Sonnenscheindauer',
    short: 'Sonne',
    unit: 'h',
    decimals: 1,
    warm: null,
    zeroIsAbsence: true,
    note: 'Die Sonnenscheindauer wird erst seit 1927 gemessen.',
  },
  {
    key: 'pressure_high',
    column: 'pressure',
    direction: 'max',
    label: 'Höchster Luftdruck',
    short: 'Druck hoch',
    unit: 'hPa',
    decimals: 1,
    warm: null,
  },
  {
    key: 'pressure_low',
    column: 'pressure',
    direction: 'min',
    label: 'Tiefster Luftdruck',
    short: 'Druck tief',
    unit: 'hPa',
    decimals: 1,
    warm: null,
  },
]

export const RECORD_FIELD_BY_KEY = new Map(RECORD_FIELDS.map((f) => [f.key, f]))

const beats = (direction, value, record) => (direction === 'max' ? value > record : value < record)

/* -------------------------------------------------------------------------- */
/* The walk                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A maximum of zero is not a record.
 *
 * Snow depth, rainfall and sunshine measure something that may simply not
 * happen, and their smallest possible value is nought. Left in, the snow record
 * of the 15th of July is "0 cm, set in 1858 and never beaten" — which is not a
 * record but the statement that it has never snowed on that day, dressed up as
 * one. It was also a large statement: 179 of the 192 records the year 1858 held
 * were exactly this.
 *
 * So for these three the series is the days on which the quantity occurred at
 * all. Everything downstream — the running maximum, the k-th-observation
 * expectation, the counts — then refers to that conditional sample, and calendar
 * days on which it never snowed simply have no snow record.
 */
const seriesStmt = (column, zeroIsAbsence) =>
  db.prepare(
    `SELECT date, year, CAST(strftime('%m', date) AS INTEGER) AS month,
            strftime('%m-%d', date) AS key, ${column} AS value
     FROM daily WHERE station_id = ? AND ${column} IS NOT NULL
       ${zeroIsAbsence ? `AND ${column} > 0` : ''}
     ORDER BY date`,
  )

/** The last day of the series — "today" for the purpose of ages. */
const lastDayStmt = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?')


const DAY = 86_400_000
const YEAR = 365.2425

const daysBetween = (from, to) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY

/**
 * Walk one field's whole series, keeping a record per calendar day.
 *
 * Returns the standing record for each of the 366 calendar days and every spell
 * a record ever had. A spell that was never beaten has `until = null` — it is
 * still running, which survival statistics call right-censored and which must
 * not be mistaken for a spell that ended today.
 *
 * `seeded` marks the first value a calendar day ever saw. It took the title
 * without beating anything, which for counting standing records is exactly
 * right — a day whose 1858 value was never exceeded in 168 years is a fact, not
 * an artefact — but for "how long does a record survive" it is a different kind
 * of event and can be excluded.
 */
function walk(stationId, field) {
  const rows = seriesStmt(field.column, field.zeroIsAbsence).all(stationId)
  const standing = new Map()
  const spells = []

  // How often each calendar day has been observed so far, and what that means
  // for the year currently being read. Under a stationary climate the k-th
  // observation of a calendar day is a record with probability 1/k — that is
  // the whole of classical record theory, and it is the only fair yardstick for
  // comparing a year that had to beat two predecessors with one that had to
  // beat a hundred and sixty.
  const ordinal = new Map()
  const byYear = new Map()

  for (const row of rows) {
    const k = (ordinal.get(row.key) ?? 0) + 1
    ordinal.set(row.key, k)

    let year = byYear.get(row.year)
    if (!year) {
      year = { year: row.year, opportunities: 0, expected: 0, set: 0, standing: 0 }
      byYear.set(row.year, year)
    }
    year.opportunities++
    year.expected += 1 / k

    const held = standing.get(row.key)

    if (!held) {
      const spell = {
        key: row.key,
        month: row.month,
        value: row.value,
        date: row.date,
        year: row.year,
        until: null,
        untilValue: null,
        seeded: true,
        observations: 1,
        // Which observation of this calendar day set the record, and which one
        // ended it. The difference is the fair clock: a record can only fall on
        // a day the station measured, and years in which it did not are not
        // years the record survived anything.
        ordinal: k,
        untilOrdinal: null,
      }
      spells.push(spell)
      standing.set(row.key, { ...spell, spell, observations: 1 })
      year.set++
      continue
    }

    held.observations++
    held.spell.observations = held.observations

    if (!beats(field.direction, row.value, held.value)) continue

    held.spell.until = row.date
    held.spell.untilValue = row.value
    held.spell.untilOrdinal = k

    const spell = {
      key: row.key,
      month: row.month,
      value: row.value,
      date: row.date,
      year: row.year,
      until: null,
      untilValue: null,
      seeded: false,
      observations: held.observations,
      ordinal: k,
      untilOrdinal: null,
    }
    spells.push(spell)
    year.set++

    held.value = row.value
    held.date = row.date
    held.year = row.year
    held.seeded = false
    held.spell = spell
  }

  // Which years the surviving records belong to — only knowable once the whole
  // series has been read. The running spells are censored at the last
  // observation of their own calendar day, not at the last day of the series.
  for (const held of standing.values()) {
    const year = byYear.get(held.year)
    if (year) year.standing++
    held.spell.untilOrdinal = ordinal.get(held.key) ?? held.spell.ordinal
  }

  return {
    standing,
    spells,
    byYear: [...byYear.values()].sort((a, b) => a.year - b.year),
    days: rows.length,
    // When the quantity was first measured, which is not the same as the
    // earliest standing record: the wind series starts in 1969 whatever its
    // records say, and "how long could this record have fallen" is a question
    // about the series, not about the record.
    first: rows[0]?.date ?? null,
    lastReading: rows.at(-1)?.date ?? null,
  }
}

/**
 * The walk is not cheap enough to repeat per request.
 *
 * Sixty thousand rows per field and ten fields is half a second, which is fine
 * once and wasteful on every reload. The archive only changes when the importer
 * runs, so the cache key is the station plus its last day.
 */
const cache = new Map()

export function recordWalk(stationId, fieldKey) {
  const field = RECORD_FIELD_BY_KEY.get(fieldKey)
  if (!field) return null

  const last = lastDayStmt.get(stationId)?.last ?? ''
  const key = `${stationId}|${fieldKey}|${last}`
  if (!cache.has(key)) cache.set(key, { ...walk(stationId, field), field, last })
  return cache.get(key)
}

export const lastDayOf = (stationId) => lastDayStmt.get(stationId)?.last ?? null

/* -------------------------------------------------------------------------- */
/* How old the standing records are                                           */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/**
 * A record's age, in the two units that mean something.
 *
 * Years for reading, days for sorting. Measured against the last day of the
 * series rather than the wall clock, so the page says the same thing whenever
 * it is rendered and the prerendered files do not drift from the live server.
 */
function ageOf(date, last) {
  const days = daysBetween(date, last)
  return { days, years: days / YEAR }
}

/** The best of a set of standing records, with the runner-up beside it. */
function bestOf(entries, field, last) {
  if (entries.length === 0) return null

  const sorted = [...entries].sort((a, b) =>
    field.direction === 'max' ? b.value - a.value : a.value - b.value,
  )
  const best = sorted[0]
  // The runner-up must be a different value, not merely a different calendar
  // day: three days sharing 38.7 °C would otherwise report a margin of zero.
  const runnerUp = sorted.find((e) => e.value !== best.value) ?? null

  return {
    value: best.value,
    date: best.date,
    year: best.year,
    seeded: best.seeded,
    observations: best.observations,
    ...ageOf(best.date, last),
    runnerUp: runnerUp
      ? {
          value: runnerUp.value,
          date: runnerUp.date,
          margin: Math.abs(best.value - runnerUp.value),
        }
      : null,
  }
}

export function recordAges(stationId) {
  const last = lastDayOf(stationId)
  if (!last) return null

  const fields = []
  for (const field of RECORD_FIELDS) {
    const walked = recordWalk(stationId, field.key)
    if (!walked || walked.days === 0) continue

    const entries = [...walked.standing.values()]
    const allTime = bestOf(entries, field, last)
    if (!allTime) continue

    const monthly = []
    for (let month = 1; month <= 12; month++) {
      const best = bestOf(
        entries.filter((e) => e.month === month),
        field,
        last,
      )
      if (best) monthly.push({ month, label: MONTHS[month - 1], ...best })
    }

    fields.push({
      key: field.key,
      label: field.label,
      short: field.short,
      unit: field.unit,
      decimals: field.decimals,
      direction: field.direction,
      warm: field.warm,
      note: field.note ?? null,
      days: walked.days,
      /** When the quantity was first measured — not when its oldest record was set. */
      first: walked.first,
      allTime,
      monthly,
      /** Mean age of the twelve monthly records — one number per category. */
      meanMonthlyAge:
        monthly.length === 0 ? null : monthly.reduce((a, m) => a + m.years, 0) / monthly.length,
    })
  }

  if (fields.length === 0) return null

  const warm = fields.filter((f) => f.warm === true)
  const cold = fields.filter((f) => f.warm === false)
  const mean = (list) =>
    list.length === 0 ? null : list.reduce((a, f) => a + (f.meanMonthlyAge ?? 0), 0) / list.length

  return {
    station: stationId,
    last,
    fields,
    summary: {
      warmAge: mean(warm),
      coldAge: mean(cold),
      warmFields: warm.length,
      coldFields: cold.length,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* The record calendar                                                        */
/* -------------------------------------------------------------------------- */

/** The 366 calendar keys in order, so the payload carries them once. */
function calendarKeys() {
  const keys = []
  const lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= lengths[month - 1]; day++) {
      keys.push(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
  }
  return keys
}

const CALENDAR_KEYS = calendarKeys()

/**
 * Every calendar day's standing record, for every category.
 *
 * The dates are not sent: a record's date is its year plus its calendar key, so
 * repeating it would be 3,660 redundant strings. Nor are the keys sent per
 * field — they are the same 366 for all of them.
 *
 * The 29th of February is in the list and is not a mistake. It has a quarter of
 * the observations the other days have, which makes its record easier to hold
 * and harder to break; the observation count travels with every tile so the
 * view can say so rather than quietly presenting it as an equal.
 */
export function recordCalendar(stationId) {
  const last = lastDayOf(stationId)
  if (!last) return null

  const fields = []
  for (const field of RECORD_FIELDS) {
    const walked = recordWalk(stationId, field.key)
    if (!walked || walked.days === 0) continue

    const entries = CALENDAR_KEYS.map((key) => {
      const held = walked.standing.get(key)
      return held ? [held.value, held.year, held.observations] : null
    })

    const years = entries.filter(Boolean).map((e) => e[1])
    fields.push({
      key: field.key,
      label: field.label,
      short: field.short,
      unit: field.unit,
      decimals: field.decimals,
      direction: field.direction,
      warm: field.warm,
      note: field.note ?? null,
      first: walked.first,
      /** [value, year, observations] per calendar key, null where never measured. */
      entries,
      covered: years.length,
      minYear: years.length > 0 ? Math.min(...years) : null,
      maxYear: years.length > 0 ? Math.max(...years) : null,
    })
  }

  if (fields.length === 0) return null
  return { station: stationId, last, days: CALENDAR_KEYS, fields }
}

/* -------------------------------------------------------------------------- */
/* Which years left the most records behind                                   */
/* -------------------------------------------------------------------------- */

/**
 * Two different questions that both get called "record year".
 *
 * *Standing* counts the records a year still holds today. It is the intuitive
 * reading — 2015 owns twelve calendar days of the heat record — but it favours
 * recent years mechanically, because a record from 1900 has had a century in
 * which to be beaten.
 *
 * *Set* counts the records a year established at the time, and it is compared
 * against what chance alone would have produced. Under a stationary climate the
 * k-th observation of a calendar day is a record with probability 1/k, so a
 * year's expected haul is the sum of 1/k over its days. That expectation falls
 * as the series grows, which is exactly the correction the raw count needs: the
 * 1880s set hundreds of records because almost every day was being seen for the
 * third time, and that is not news.
 *
 * The ratio of the two is the whole analysis. Above one means more records than
 * chance, and for Göttingen's heat records the 2010s sit at 2.5 while the cold
 * records of the same decade sit at 0.6.
 */
const DECADE = 10

function decadesOf(years) {
  const map = new Map()
  for (const year of years) {
    const decade = Math.floor(year.year / DECADE) * DECADE
    const entry = map.get(decade) ?? {
      decade,
      set: 0,
      expected: 0,
      standing: 0,
      opportunities: 0,
      years: 0,
    }
    entry.set += year.set
    entry.expected += year.expected
    entry.standing += year.standing
    entry.opportunities += year.opportunities
    entry.years++
    map.set(decade, entry)
  }

  return [...map.values()]
    .sort((a, b) => a.decade - b.decade)
    .map((entry) => ({
      ...entry,
      expected: Number(entry.expected.toFixed(2)),
      ratio: entry.expected > 0 ? entry.set / entry.expected : null,
    }))
}

function mergeYears(lists) {
  const map = new Map()
  for (const years of lists) {
    for (const year of years) {
      const entry = map.get(year.year) ?? {
        year: year.year,
        set: 0,
        expected: 0,
        standing: 0,
        opportunities: 0,
      }
      entry.set += year.set
      entry.expected += year.expected
      entry.standing += year.standing
      entry.opportunities += year.opportunities
      map.set(year.year, entry)
    }
  }
  return [...map.values()]
    .sort((a, b) => a.year - b.year)
    .map((entry) => ({ ...entry, expected: Number(entry.expected.toFixed(2)) }))
}

/** How many top years each ranking shows. */
const VINTAGES = 12

export function recordVintages(stationId) {
  const last = lastDayOf(stationId)
  if (!last) return null

  const fields = []
  for (const field of RECORD_FIELDS) {
    const walked = recordWalk(stationId, field.key)
    if (!walked || walked.days === 0) continue

    const years = walked.byYear.map((y) => ({ ...y, expected: Number(y.expected.toFixed(2)) }))
    fields.push({
      key: field.key,
      label: field.label,
      short: field.short,
      unit: field.unit,
      decimals: field.decimals,
      direction: field.direction,
      warm: field.warm,
      note: field.note ?? null,
      first: walked.first,
      years,
      decades: decadesOf(walked.byYear),
      totals: {
        set: walked.spells.length,
        standing: walked.standing.size,
        expected: Number(walked.byYear.reduce((a, y) => a + y.expected, 0).toFixed(1)),
      },
      top: [...years].sort((a, b) => b.standing - a.standing || b.set - a.set).slice(0, VINTAGES),
    })
  }

  if (fields.length === 0) return null

  const pick = (test) => fields.filter((f) => test(f.warm))
  const group = (list) => ({
    fields: list.length,
    years: mergeYears(list.map((f) => f.years)),
    decades: decadesOf(mergeYears(list.map((f) => f.years))),
  })

  return {
    station: stationId,
    last,
    vintages: VINTAGES,
    fields,
    groups: {
      alle: group(fields),
      warm: group(pick((w) => w === true)),
      kalt: group(pick((w) => w === false)),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* How long a record survives                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one question on this page that cannot be answered by counting.
 *
 * "How long does a record last" runs into two problems at once. The records
 * still standing have no end date — they are right-censored, and averaging only
 * the ones that already fell would answer a different and much shorter
 * question. And exposure is wildly unequal: a record set in 1870 has had 156
 * years in which to be beaten, one set in 2019 has had seven, so any comparison
 * across eras that ignores this reports the recent era as short-lived no matter
 * what happened.
 *
 * Kaplan-Meier solves both. At each moment a record fell, the survival estimate
 * is multiplied by (1 − fallen / still at risk); a censored record leaves the
 * risk set at its censoring time without ever counting as fallen. The curve is
 * therefore estimable exactly as far as the data reach and no further, which is
 * the honest place to stop drawing it.
 *
 * Seeded spells are excluded. The first value a calendar day ever saw took the
 * title without beating anything, and its survival is dominated by the coin
 * flip at the next observation — including them would pile short spells into
 * the earliest era, which is precisely the era comparison being made.
 */

/** Where the survival curve is evaluated, in years. */
const SURVIVAL_GRID = [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50, 75, 100, 125]

/**
 * The same curve on the fair clock, in further observations of the calendar day.
 *
 * Years are what a reader understands, and they are the wrong unit for
 * comparing eras. A record set at the third observation of its calendar day
 * falls quickly because two thirds of all later values beat a third-place
 * starting point; one set at the hundred-and-fiftieth is hard to beat by
 * construction. Comparing 1880 with 1990 on a calendar clock therefore measures
 * how long the series had been running, not what the weather did.
 *
 * Counted in observations the comparison becomes fair, because the stationary
 * expectation is exactly computable: a record set at the k-th observation
 * survives the next m with probability k/(k+m). The dashed line in the view is
 * that expectation for the same records, so the two curves answer "more or less
 * durable than chance" rather than "earlier or later in the archive".
 */
const STEP_GRID = [1, 2, 3, 5, 8, 12, 20, 30, 45, 65, 90, 120]

/**
 * The eras a record can be set in.
 *
 * Four blocks rather than decades: a Kaplan-Meier curve needs enough events to
 * be worth drawing, and a decade of one category yields a few dozen.
 */
export const SURVIVAL_ERAS = [
  { key: 'e1', from: 1858, to: 1900, label: 'bis 1900' },
  { key: 'e2', from: 1901, to: 1950, label: '1901–1950' },
  { key: 'e3', from: 1951, to: 2000, label: '1951–2000' },
  { key: 'e4', from: 2001, to: 9999, label: 'seit 2001' },
]

/**
 * Kaplan-Meier from a list of {duration, fell}.
 *
 * `fell` false means the record still stands and `duration` is how long it has
 * stood so far — the censoring time. Ties are handled the standard way: all
 * events at the same duration are applied in one step.
 */
function kaplanMeier(observations, grid) {
  const sorted = [...observations].sort((a, b) => a.duration - b.duration)
  const total = sorted.length
  if (total === 0) return null

  let atRisk = total
  let survival = 1
  let index = 0
  const steps = []

  while (index < sorted.length) {
    const time = sorted[index].duration
    let fell = 0
    let left = 0
    while (index < sorted.length && sorted[index].duration === time) {
      if (sorted[index].fell) fell++
      else left++
      index++
    }
    if (fell > 0 && atRisk > 0) {
      survival *= 1 - fell / atRisk
      steps.push({ time, survival, atRisk, fell })
    }
    atRisk -= fell + left
  }

  // The grid is only filled as far as anyone was still at risk. Beyond that the
  // estimate would be a flat line drawn from nothing.
  const lastObserved = sorted.at(-1).duration
  const curve = grid
    .filter((t) => t <= lastObserved)
    .map((t) => {
      const step = [...steps].reverse().find((s) => s.time <= t)
      const risk = sorted.filter((o) => o.duration >= t).length
      return { t, survival: step ? step.survival : 1, atRisk: risk }
    })

  const half = steps.find((s) => s.survival <= 0.5)
  const at = (t) => {
    const step = [...steps].reverse().find((s) => s.time <= t)
    return t <= lastObserved ? (step ? step.survival : 1) : null
  }

  return {
    n: total,
    events: sorted.filter((o) => o.fell).length,
    censored: sorted.filter((o) => !o.fell).length,
    median: half ? half.time : null,
    at10: at(10),
    at25: at(25),
    maxObserved: lastObserved,
    curve,
  }
}

function spellsOf(walked, last) {
  const out = []
  for (const spell of walked.spells) {
    if (spell.seeded) continue
    const end = spell.until ?? last
    out.push({
      key: spell.key,
      value: spell.value,
      date: spell.date,
      year: spell.year,
      until: spell.until,
      untilValue: spell.untilValue,
      fell: spell.until !== null,
      duration: daysBetween(spell.date, end) / YEAR,
      /** Which observation of this calendar day set it — the k of the 1/k rule. */
      ordinal: spell.ordinal,
      /** How many further observations it survived. */
      steps: (spell.untilOrdinal ?? spell.ordinal) - spell.ordinal,
    })
  }
  return out
}

const eraOf = (year) => SURVIVAL_ERAS.find((e) => year >= e.from && year <= e.to) ?? null

/**
 * What survival would look like if nothing had changed.
 *
 * For a record set at the k-th observation, the chance of surviving m more is
 * k/(k+m). Averaged over a cohort that is the curve chance alone would draw,
 * and it is not flat across eras — later records start from a larger k and are
 * expected to last longer. That is the whole point of showing it.
 */
function expectedCurve(spells, grid) {
  if (spells.length === 0) return []
  return grid.map((m) => ({
    t: m,
    survival: spells.reduce((a, s) => a + s.ordinal / (s.ordinal + m), 0) / spells.length,
  }))
}

const EMPTY = { n: 0, events: 0, censored: 0, median: null, at10: null, at25: null, curve: [] }

function stepSurvival(spells) {
  const observed = kaplanMeier(
    spells.map((s) => ({ duration: s.steps, fell: s.fell })),
    STEP_GRID,
  )
  if (!observed) return null

  const expected = expectedCurve(spells, STEP_GRID)
  const byStep = new Map(expected.map((e) => [e.t, e.survival]))

  return {
    ...observed,
    curve: observed.curve.map((point) => ({
      ...point,
      expected: byStep.get(point.t) ?? null,
      ratio: byStep.get(point.t) ? point.survival / byStep.get(point.t) : null,
    })),
    /** Mean ordinal of the cohort — how deep into the series these records sit. */
    meanOrdinal: spells.reduce((a, s) => a + s.ordinal, 0) / spells.length,
  }
}

function survivalFor(spells) {
  const inEra = (era) => spells.filter((s) => s.year >= era.from && s.year <= era.to)
  return {
    overall: kaplanMeier(spells, SURVIVAL_GRID),
    overallSteps: stepSurvival(spells),
    eras: SURVIVAL_ERAS.map((era) => ({
      ...era,
      ...(kaplanMeier(inEra(era), SURVIVAL_GRID) ?? EMPTY),
      steps: stepSurvival(inEra(era)),
    })),
  }
}

/**
 * The longest spell of each category, rather than the ten longest overall.
 *
 * Unfiltered, both lists fill up with the same two or three quantities: the
 * pressure series began in 1858 and its early records are essentially
 * unbeatable, so ten rows would say one thing ten times. One row per category
 * says ten things.
 */
function longestPerField(spells) {
  const best = new Map()
  for (const spell of spells) {
    const held = best.get(spell.field)
    if (!held || spell.duration > held.duration) best.set(spell.field, spell)
  }
  return [...best.values()].sort((a, b) => b.duration - a.duration)
}

export function recordSurvival(stationId) {
  const last = lastDayOf(stationId)
  if (!last) return null

  const perField = []
  const all = []
  for (const field of RECORD_FIELDS) {
    const walked = recordWalk(stationId, field.key)
    if (!walked || walked.days === 0) continue

    const spells = spellsOf(walked, last)
    if (spells.length === 0) continue

    perField.push({ field, spells })
    for (const spell of spells) all.push({ ...spell, field: field.key })
  }

  if (perField.length === 0) return null

  const describe = ({ field, spells }) => ({
    key: field.key,
    label: field.label,
    short: field.short,
    unit: field.unit,
    decimals: field.decimals,
    direction: field.direction,
    warm: field.warm,
    note: field.note ?? null,
    ...survivalFor(spells),
  })

  const group = (test) => {
    const spells = perField.filter((f) => test(f.field.warm)).flatMap((f) => f.spells)
    return { fields: perField.filter((f) => test(f.field.warm)).length, ...survivalFor(spells) }
  }

  const named = (spell) => {
    const field = RECORD_FIELD_BY_KEY.get(spell.field)
    return {
      field: spell.field,
      label: field?.label ?? spell.field,
      unit: field?.unit ?? '',
      decimals: field?.decimals ?? 1,
      value: spell.value,
      date: spell.date,
      until: spell.until,
      untilValue: spell.untilValue,
      years: spell.duration,
      era: eraOf(spell.year)?.label ?? null,
    }
  }

  return {
    station: stationId,
    last,
    grid: SURVIVAL_GRID,
    eras: SURVIVAL_ERAS,
    fields: perField.map(describe),
    groups: {
      alle: { fields: perField.length, ...survivalFor(all) },
      warm: group((w) => w === true),
      kalt: group((w) => w === false),
    },
    longest: {
      completed: longestPerField(all.filter((s) => s.fell)).map(named),
      standing: longestPerField(all.filter((s) => !s.fell)).map(named),
    },
  }
}
