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

const seriesStmt = (column) =>
  db.prepare(
    `SELECT date, year, CAST(strftime('%m', date) AS INTEGER) AS month,
            strftime('%m-%d', date) AS key, ${column} AS value
     FROM daily WHERE station_id = ? AND ${column} IS NOT NULL
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
  const rows = seriesStmt(field.column).all(stationId)
  const standing = new Map()
  const spells = []

  for (const row of rows) {
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
      }
      spells.push(spell)
      standing.set(row.key, { ...spell, spell, observations: 1 })
      continue
    }

    held.observations++
    held.spell.observations = held.observations

    if (!beats(field.direction, row.value, held.value)) continue

    held.spell.until = row.date
    held.spell.untilValue = row.value

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
    }
    spells.push(spell)

    held.value = row.value
    held.date = row.date
    held.year = row.year
    held.seeded = false
    held.spell = spell
  }

  return {
    standing,
    spells,
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
