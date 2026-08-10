import { Buffer } from 'node:buffer'
import { gunzipSync } from 'node:zlib'

import { listEntries, readEntry } from './zip.js'

/**
 * What the DWD knows about the ground under Göttingen.
 *
 * Two datasets that answer different questions and are not interchangeable:
 *
 *  - `derived_germany/soil/daily` is **computed**, not measured. The
 *    agrometeorological models AMBAV and AMBETI take temperature, dew point,
 *    wind, precipitation and radiation and simulate what the water in the soil
 *    does with them. That is the only way to get soil moisture at all — the
 *    DWD states plainly that these quantities "werden normalerweise
 *    messtechnisch nicht erfasst". Back to 1991.
 *  - `observations_germany/climate/daily/soil_temperature` is **measured**,
 *    with a thermometer in the ground at 2, 5, 10, 20 and 50 cm. Back to 1981.
 *
 * Both carry the same soil temperature, once modelled and once measured, and
 * the measured one is used — the model is good to about half a degree by the
 * DWD's own estimate, which is excellent for a model and still worse than a
 * thermometer.
 *
 * Only Göttingen. Neither dataset holds the Brocken or the Zugspitze: the
 * derived set covers 494 stations and those two are not among them, and
 * `soil_temperature` has no file for either. A soil view for the other two
 * stations is not something this project chose not to build — the data does
 * not exist.
 *
 * Depends on nothing outside the Node standard library and `zip.js`, so the
 * scheduler can run the collector as its own process.
 */

const CDC = 'https://opendata.dwd.de/climate_environment/CDC'

const DERIVED = `${CDC}/derived_germany/soil/daily`
const MEASURED = `${CDC}/observations_germany/climate/daily/soil_temperature`

/**
 * The one station both datasets hold.
 *
 * The derived filenames carry the id without its leading zero, the archives of
 * the measured series carry it with — the same station, spelled two ways, and
 * a mismatch here is a 404 rather than a wrong number.
 */
export const SOIL_STATION = { id: '01691', derivedId: '1691', name: 'Göttingen' }

/* -------------------------------------------------------------------------- */
/* Columns                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Plant-available water by depth, under grass on loamy silt.
 *
 * The DWD publishes the same quantity for sandy soil, for winter cereals and
 * for maize as well. Grass on loamy silt is the one kept: it is the reference
 * surface the potential evaporation is defined over, so moisture and
 * evaporation in this archive describe one and the same modelled plot rather
 * than two unrelated ones.
 */
export const MOISTURE_LAYERS = [
  { key: 'bf_0_10', column: 'BFGL01_AG', from: 0, to: 10 },
  { key: 'bf_10_20', column: 'BFGL02_AG', from: 10, to: 20 },
  { key: 'bf_20_30', column: 'BFGL03_AG', from: 20, to: 30 },
  { key: 'bf_30_40', column: 'BFGL04_AG', from: 30, to: 40 },
  { key: 'bf_40_50', column: 'BFGL05_AG', from: 40, to: 50 },
  { key: 'bf_50_60', column: 'BFGL06_AG', from: 50, to: 60 },
]

export const DERIVED_FIELDS = [
  ...MOISTURE_LAYERS.map((l) => ({ key: l.key, column: l.column })),
  /** The whole root zone in one number, 0–60 cm. */
  { key: 'bf_total', column: 'BFGL_AG' },
  /** Potential evaporation over grass, FAO — what the air could take. */
  { key: 'evap_potential', column: 'VPGFAO' },
  /** Real evaporation over grass on loamy silt — what the soil let it take. */
  { key: 'evap_real', column: 'VRGL_AG' },
  /** Depth of frost penetration at midday, bare soil, in cm. */
  { key: 'frost_depth', column: 'ZFUMI' },
]

/** Measured soil temperature. 2 cm exists in the header but is rarely staffed. */
export const TEMPERATURE_DEPTHS = [
  { key: 't_2', column: 'V_TE002M', depth: 2 },
  { key: 't_5', column: 'V_TE005M', depth: 5 },
  { key: 't_10', column: 'V_TE010M', depth: 10 },
  { key: 't_20', column: 'V_TE020M', depth: 20 },
  { key: 't_50', column: 'V_TE050M', depth: 50 },
]

/** The DWD marks a missing value with -999 in both datasets. */
const MISSING = -999

function number(raw) {
  if (raw === undefined) return null
  const value = Number(String(raw).trim())
  if (!Number.isFinite(value) || value === MISSING) return null
  return value
}

/** "20260809" -> "2026-08-09" */
const isoDate = (raw) => {
  const s = String(raw).trim()
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

async function fetchBuffer(url, { timeoutMs = 180_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`DWD antwortete mit HTTP ${res.status} für ${url}`)
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse a semicolon table into rows keyed by column name.
 *
 * Both datasets use the same shape — a header line, padded values, a trailing
 * `eor` — so one parser serves both.
 */
function parseTable(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const header = lines[0].split(';').map((h) => h.trim())
  const rows = []
  for (const line of lines.slice(1)) {
    const cells = line.split(';')
    if (cells.length < header.length - 1) continue
    const row = {}
    header.forEach((name, i) => {
      row[name] = cells[i]
    })
    rows.push(row)
  }
  return rows
}

/** The modelled series: moisture, evaporation, frost depth. */
export async function fetchDerived({ historical = false } = {}) {
  const period = historical ? 'historical' : 'recent'
  const file = `derived_germany_soil_daily_${period}_v2_${SOIL_STATION.derivedId}.txt.gz`
  const text = gunzipSync(await fetchBuffer(`${DERIVED}/${period}/${file}`)).toString('latin1')

  return parseTable(text).map((row) => {
    const out = { date: isoDate(row.Datum) }
    for (const field of DERIVED_FIELDS) out[field.key] = number(row[field.column])
    return out
  })
}

/** The measured series: soil temperature by depth. */
export async function fetchMeasured({ historical = false } = {}) {
  const url = historical
    ? await resolveHistoricalUrl()
    : `${MEASURED}/recent/tageswerte_EB_${SOIL_STATION.id}_akt.zip`

  const buf = await fetchBuffer(url)
  const entry = listEntries(buf).find((e) => /produkt_erdbo_tag_.*\.txt$/i.test(e.name))
  if (!entry) throw new Error(`Kein produkt_erdbo_tag in ${url}`)

  return parseTable(readEntry(buf, entry).toString('latin1')).map((row) => {
    const out = { date: isoDate(row.MESS_DATUM) }
    for (const depth of TEMPERATURE_DEPTHS) out[depth.key] = number(row[depth.column])
    return out
  })
}

/**
 * The historical archive's filename carries its own date range, so it changes
 * whenever the DWD extends it and cannot be constructed.
 */
async function resolveHistoricalUrl() {
  const res = await fetch(`${MEASURED}/historical/`)
  if (!res.ok) throw new Error(`DWD-Verzeichnis nicht erreichbar (HTTP ${res.status}).`)
  const html = await res.text()
  const pattern = new RegExp(`tageswerte_EB_${SOIL_STATION.id}_\\d{8}_\\d{8}_hist\\.zip`)
  const found = html.match(pattern)
  if (!found) throw new Error(`Kein historisches Bodenarchiv für ${SOIL_STATION.id} gefunden.`)
  return `${MEASURED}/historical/${found[0]}`
}
