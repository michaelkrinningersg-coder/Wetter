import { db } from './db.js'
import { readSoil } from './soil-csv.js'
import { DERIVED_FIELDS, MOISTURE_LAYERS, SOIL_STATION, TEMPERATURE_DEPTHS } from './soil-sources.js'

/**
 * The ground under Göttingen.
 *
 * Three questions the air above it cannot answer:
 *
 *  - How much water is left, and at which depth? The top ten centimetres react
 *    to every shower; half a metre down, a summer is written that took months.
 *  - Is that unusual? A percentage of usable field capacity means nothing on
 *    its own — 43 % sounds low and is perfectly normal in August. Only the same
 *    calendar day in the other 34 years says which.
 *  - What does the soil do with the heat? Depth damps the year and delays it,
 *    and the delay is measurable in weeks.
 *
 * The moisture is **modelled**, not measured, and that is stated wherever it is
 * shown. The temperature is measured.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

const MOISTURE_COLUMNS = DERIVED_FIELDS.map((f) => f.key)
const TEMPERATURE_COLUMNS = TEMPERATURE_DEPTHS.map((d) => d.key)

db.exec(`
  CREATE TABLE IF NOT EXISTS soil_moisture (
    date TEXT PRIMARY KEY,
    ${MOISTURE_COLUMNS.map((c) => `${c} REAL`).join(',\n    ')}
  );

  CREATE TABLE IF NOT EXISTS soil_temperature (
    date TEXT PRIMARY KEY,
    ${TEMPERATURE_COLUMNS.map((c) => `${c} REAL`).join(',\n    ')}
  );
`)

/* -------------------------------------------------------------------------- */
/* Archive -> database                                                        */
/* -------------------------------------------------------------------------- */

function importer(table, columns) {
  const insert = db.prepare(`
    INSERT INTO ${table} (date, ${columns.join(', ')})
    VALUES (@date, ${columns.map((c) => `@${c}`).join(', ')})
    ON CONFLICT (date) DO UPDATE SET
      ${columns.map((c) => `${c} = excluded.${c}`).join(',\n      ')}
  `)
  return db.transaction((rows) => {
    for (const row of rows) {
      insert.run({ date: row.date, ...Object.fromEntries(columns.map((c) => [c, row[c] ?? null])) })
    }
  })
}

const writeMoisture = importer('soil_moisture', MOISTURE_COLUMNS)
const writeTemperature = importer('soil_temperature', TEMPERATURE_COLUMNS)

const countStmt = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`)
const moistureCount = countStmt('soil_moisture')
const temperatureCount = countStmt('soil_temperature')

/**
 * Load the archive.
 *
 * Unlike the append-only archives, these files are rewritten whole whenever the
 * DWD revises a past day, so a row already in the database can legitimately
 * change — hence the upsert rather than a "skip what we have".
 */
export function importSoil({ force = false } = {}) {
  const moisture = readSoil('moisture')
  const temperature = readSoil('temperature')

  const before = moistureCount.get().n + temperatureCount.get().n
  if (force || before === 0 || moisture.length + temperature.length !== before) {
    if (moisture.length > 0) writeMoisture(moisture)
    if (temperature.length > 0) writeTemperature(temperature)
  }

  return { moisture: moisture.length, temperature: temperature.length }
}

const loaded = importSoil()
if (loaded.moisture > 0 || loaded.temperature > 0) {
  console.log(
    `Bodenarchiv geladen: ${loaded.moisture.toLocaleString('de-DE')} Tage Feuchte,` +
      ` ${loaded.temperature.toLocaleString('de-DE')} Tage Temperatur`,
  )
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const rangeOf = (table) =>
  db.prepare(`SELECT COUNT(*) AS days, MIN(date) AS first, MAX(date) AS last FROM ${table}`).get()

const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length

/** Linear-interpolated quantile of a sorted array. */
function quantile(sorted, p) {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/**
 * Where a value stands among its comparisons, in percent.
 *
 * Ties count half, the same midrank the yearbook and the newsroom use: a value
 * matched by every comparison sits at 50 %, not at 0 or 100.
 */
export function percentile(values, value) {
  if (values.length === 0) return null
  let below = 0
  let equal = 0
  for (const v of values) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return ((below + equal / 2) / values.length) * 100
}

/** Every `MM-DD` of a leap year, so 29 February has a place. */
function calendarDays() {
  const out = []
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(2024, m, 0)).getUTCDate()
    for (let d = 1; d <= last; d++) {
      out.push(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
  }
  return out
}

const CALENDAR = calendarDays()

/** Days either side of a calendar day that count as the same time of year. */
const WINDOW = 7

/**
 * Group every row by calendar day, then widen each group by ±WINDOW days.
 *
 * Thirty-five values for one date is a thin sample for a percentile; fifteen
 * calendar days of them is 525 and still describes the same part of the year.
 */
function byCalendarWindow(rows, column) {
  const byDay = new Map(CALENDAR.map((md) => [md, []]))
  for (const row of rows) {
    if (row[column] === null || row[column] === undefined) continue
    byDay.get(row.date.slice(5))?.push(row[column])
  }

  const widened = new Map()
  for (let i = 0; i < CALENDAR.length; i++) {
    const values = []
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const at = (i + d + CALENDAR.length) % CALENDAR.length
      values.push(...byDay.get(CALENDAR[at]))
    }
    widened.set(CALENDAR[i], values)
  }
  return widened
}

/* -------------------------------------------------------------------------- */
/* Analyses                                                                   */
/* -------------------------------------------------------------------------- */

const allMoisture = db.prepare('SELECT * FROM soil_moisture ORDER BY date')
const allTemperature = db.prepare('SELECT * FROM soil_temperature ORDER BY date')
const recentMoisture = db.prepare('SELECT * FROM soil_moisture WHERE date >= ? ORDER BY date')
const recentTemperature = db.prepare('SELECT * FROM soil_temperature WHERE date >= ? ORDER BY date')

const since = (last, days) =>
  new Date(Date.parse(`${last}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

/**
 * The annual cycle of one column, averaged over every year.
 *
 * Smoothed over the same ±7 days, because the question is where the warm part
 * of the year sits, and a single hot week would otherwise decide it.
 */
function annualCycle(rows, column) {
  const windows = byCalendarWindow(rows, column)
  return CALENDAR.map((md) => {
    const values = windows.get(md)
    return { md, value: values.length > 0 ? mean(values) : null, samples: values.length }
  })
}

export function soilOverview({ days = 365 } = {}) {
  const moistureRange = rangeOf('soil_moisture')
  const temperatureRange = rangeOf('soil_temperature')

  if (!moistureRange.last && !temperatureRange.last) {
    return {
      station: SOIL_STATION,
      range: { moisture: moistureRange, temperature: temperatureRange },
      hint:
        'Noch keine Bodendaten im Archiv. Einmal `npm run fetch:soil -- --backfill`' +
        ' ausführen — das holt 1991 bis heute in einem Durchgang.',
      moisture: null,
      temperature: null,
      evaporation: null,
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Moisture                                                               */
  /* ---------------------------------------------------------------------- */

  const moistureRows = allMoisture.all()
  const moistureWindow = moistureRange.last
    ? recentMoisture.all(since(moistureRange.last, days))
    : []

  const totalWindows = byCalendarWindow(moistureRows, 'bf_total')
  const climatology = CALENDAR.map((md) => {
    const sorted = [...totalWindows.get(md)].sort((a, b) => a - b)
    return {
      md,
      p10: quantile(sorted, 0.1),
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      samples: sorted.length,
    }
  })

  const latest = moistureWindow.at(-1) ?? null

  /**
   * The same date in every year, without the ±7-day widening.
   *
   * The widened window is the better *percentile* — 533 comparisons instead of
   * 36 — but it cannot say "the fifth-driest 9 August", and that sentence is
   * the one a reader can picture. Both are reported: the rank among years for
   * grasp, the percentile for precision. They agree here to within a point and
   * a half, which is itself worth being able to check.
   */
  function sameDateStanding(row) {
    if (!row || row.bf_total === null) return null
    const md = row.date.slice(5)
    const values = moistureRows
      .filter((r) => r.date.slice(5) === md && r.bf_total !== null)
      .map((r) => r.bf_total)
    if (values.length === 0) return null

    const drier = values.filter((v) => v < row.bf_total).length
    const wetter = values.filter((v) => v > row.bf_total).length
    const sorted = [...values].sort((a, b) => a - b)

    return {
      years: values.length,
      drier,
      wetter,
      // Counted from the dry end, ties sharing the better place — the same
      // convention the yearbook uses for its ranks.
      place: drier + 1,
      percentile: percentile(values, row.bf_total),
      median: quantile(sorted, 0.5),
      driest: sorted[0],
      wettest: sorted[sorted.length - 1],
    }
  }

  const today = latest
    ? {
        date: latest.date,
        layers: Object.fromEntries(MOISTURE_LAYERS.map((l) => [l.key, latest[l.key]])),
        total: latest.bf_total,
        percentile:
          latest.bf_total === null
            ? null
            : percentile(totalWindows.get(latest.date.slice(5)), latest.bf_total),
        samples: totalWindows.get(latest.date.slice(5)).length,
        sameDate: sameDateStanding(latest),
      }
    : null

  /* ---------------------------------------------------------------------- */
  /* Temperature                                                            */
  /* ---------------------------------------------------------------------- */

  const temperatureRows = allTemperature.all()
  const temperatureWindow = temperatureRange.last
    ? recentTemperature.all(since(temperatureRange.last, days))
    : []

  const cycles = TEMPERATURE_DEPTHS.map((depth) => {
    const cycle = annualCycle(temperatureRows, depth.key)
    const known = cycle.filter((c) => c.value !== null)
    if (known.length === 0) {
      return { ...depth, amplitude: null, peak: null, trough: null, cycle, samples: 0 }
    }
    const warm = known.reduce((a, b) => (b.value > a.value ? b : a))
    const cold = known.reduce((a, b) => (b.value < a.value ? b : a))
    return {
      ...depth,
      // Damping and delay, the two things depth does to a year.
      amplitude: warm.value - cold.value,
      peak: warm.md,
      trough: cold.md,
      cycle,
      samples: Math.max(...known.map((c) => c.samples)),
    }
  })

  /* ---------------------------------------------------------------------- */
  /* Evaporation                                                            */
  /* ---------------------------------------------------------------------- */

  const byMonth = new Map()
  for (const row of moistureRows) {
    if (row.evap_potential === null || row.evap_real === null) continue
    const month = Number(row.date.slice(5, 7))
    if (!byMonth.has(month)) byMonth.set(month, { potential: [], real: [] })
    byMonth.get(month).potential.push(row.evap_potential)
    byMonth.get(month).real.push(row.evap_real)
  }

  const monthly = [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, v]) => ({
      month,
      // Daily means rather than sums: the years in the archive are complete,
      // but a partial current year would otherwise make December look dry.
      potential: mean(v.potential),
      real: mean(v.real),
      deficit: mean(v.potential) - mean(v.real),
      days: v.potential.length,
    }))

  return {
    station: SOIL_STATION,
    window: days,
    range: { moisture: moistureRange, temperature: temperatureRange },
    method: { calendarWindow: WINDOW },
    moisture: {
      layers: MOISTURE_LAYERS,
      series: moistureWindow.map((r) => ({
        date: r.date,
        ...Object.fromEntries(MOISTURE_LAYERS.map((l) => [l.key, r[l.key]])),
        bf_total: r.bf_total,
      })),
      climatology,
      today,
    },
    temperature: {
      depths: TEMPERATURE_DEPTHS,
      series: temperatureWindow.map((r) => ({
        date: r.date,
        ...Object.fromEntries(TEMPERATURE_DEPTHS.map((d) => [d.key, r[d.key]])),
      })),
      cycles,
    },
    evaporation: {
      series: moistureWindow.map((r) => ({
        date: r.date,
        potential: r.evap_potential,
        real: r.evap_real,
        deficit:
          r.evap_potential === null || r.evap_real === null
            ? null
            : r.evap_potential - r.evap_real,
      })),
      monthly,
    },
  }
}
