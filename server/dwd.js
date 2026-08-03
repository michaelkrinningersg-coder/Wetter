import { Buffer } from 'node:buffer'

import { db, setImportState } from './db.js'
import { listEntries, readEntry } from './zip.js'
import { historicalDirUrl, historicalIndexUrl, recentUrl } from './stations.js'

/** DWD marks missing values with -999. */
const MISSING = -999

/**
 * Column names in `produkt_klima_tag_*.txt`:
 *   MESS_DATUM  measurement date, YYYYMMDD
 *   FX / FM     daily max gust / mean wind speed, m/s
 *   RSK         daily precipitation total, mm
 *   PM          daily mean air pressure, hPa
 *   TMK/TXK/TNK daily mean / max / min air temperature, °C
 *   SDK         sunshine duration, h
 *   NM          mean cloud cover, eighths
 *   UPM         mean relative humidity, %
 *   VPM         mean vapour pressure, hPa
 *   SHK_TAG     snow depth, cm
 *   TGK         minimum temperature 5 cm above ground, °C
 *
 * The last six were read past for a long time. For Göttingen they are not a
 * footnote: cloud cover starts in 1860, humidity, vapour pressure and snow
 * depth in 1858 — a century and a half of measurements that the archive was
 * already downloading and throwing away.
 */
const COLUMNS = {
  date: 'MESS_DATUM',
  wind_max: 'FX',
  wind_mean: 'FM',
  precipitation: 'RSK',
  pressure: 'PM',
  temp_mean: 'TMK',
  temp_max: 'TXK',
  temp_min: 'TNK',
  sunshine: 'SDK',
  cloud: 'NM',
  humidity: 'UPM',
  vapour_pressure: 'VPM',
  snow: 'SHK_TAG',
  temp_ground_min: 'TGK',
}

function parseValue(raw) {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-999') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value === MISSING) return null
  return value
}

/** Parse one `produkt_klima_tag` text file into row objects. */
export function parseProductFile(text, stationId) {
  const lines = text.split('\n')
  const headerLine = lines.shift()
  if (!headerLine) return []

  const header = headerLine.split(';').map((h) => h.trim())
  const indexOf = {}
  for (const [field, column] of Object.entries(COLUMNS)) {
    indexOf[field] = header.indexOf(column)
  }
  if (indexOf.date < 0) {
    throw new Error('Unerwartetes DWD-Dateiformat: Spalte MESS_DATUM fehlt.')
  }

  const rows = []
  for (const line of lines) {
    if (!line.trim()) continue
    const cells = line.split(';')

    const rawDate = cells[indexOf.date]?.trim()
    if (!rawDate || rawDate.length !== 8) continue

    const year = Number(rawDate.slice(0, 4))
    const month = Number(rawDate.slice(4, 6))
    const day = Number(rawDate.slice(6, 8))
    if (!year || !month || !day) continue

    rows.push({
      station_id: stationId,
      date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
      year,
      month,
      day,
      temp_mean: parseValue(cells[indexOf.temp_mean]),
      temp_max: parseValue(cells[indexOf.temp_max]),
      temp_min: parseValue(cells[indexOf.temp_min]),
      precipitation: parseValue(cells[indexOf.precipitation]),
      wind_max: parseValue(cells[indexOf.wind_max]),
      wind_mean: parseValue(cells[indexOf.wind_mean]),
      pressure: parseValue(cells[indexOf.pressure]),
      sunshine: parseValue(cells[indexOf.sunshine]),
      cloud: parseValue(cells[indexOf.cloud]),
      humidity: parseValue(cells[indexOf.humidity]),
      vapour_pressure: parseValue(cells[indexOf.vapour_pressure]),
      snow: parseValue(cells[indexOf.snow]),
      temp_ground_min: parseValue(cells[indexOf.temp_ground_min]),
    })
  }
  return rows
}

async function fetchBuffer(url, { timeoutMs = 120_000 } = {}) {
  // The original had no timeout at all, so a hanging DWD connection left
  // `importInProgress` stuck at true until the process restarted — and the
  // UI polled /api/status every 3 s forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`DWD-Server antwortete mit HTTP ${res.status} für ${url}`)
    }
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Extract every `produkt_klima_tag_*.txt` entry from a DWD zip archive.
 *
 * Read by our own `zip.js` rather than by `unzipper`. The collectors were
 * already written that way so their workflow needed no install step; with the
 * app packaged as a program, the argument is a different one — every
 * dependency is a file that has to be shipped, signed and kept current, and
 * this one did nothing that forty lines on top of `node:zlib` do not.
 */
function extractProductFiles(buffer) {
  return listEntries(buffer)
    .filter((entry) => /produkt_klima_tag_.*\.txt$/i.test(entry.name))
    // DWD publishes these as ISO-8859-1; the header contains no umlauts we
    // depend on, but decoding as latin1 avoids replacement characters.
    .map((entry) => readEntry(buffer, entry).toString('latin1'))
}

/** Resolve the current historical archive filename from the DWD directory listing. */
async function resolveHistoricalUrl(stationId) {
  const res = await fetch(historicalIndexUrl)
  if (!res.ok) {
    throw new Error(`DWD-Verzeichnis nicht erreichbar (HTTP ${res.status}).`)
  }
  const html = await res.text()
  const pattern = new RegExp(
    `tageswerte_KL_${stationId}_\\d{8}_\\d{8}_hist\\.zip`,
    'g',
  )
  const matches = html.match(pattern)
  if (!matches || matches.length === 0) return null
  // Newest archive last when sorted lexicographically (dates are zero-padded).
  return historicalDirUrl(matches.sort().at(-1))
}

const upsert = db.prepare(`
  INSERT INTO daily (
    station_id, date, year, month, day,
    temp_mean, temp_max, temp_min, precipitation, wind_max, wind_mean, pressure,
    sunshine, cloud, humidity, vapour_pressure, snow, temp_ground_min
  ) VALUES (
    @station_id, @date, @year, @month, @day,
    @temp_mean, @temp_max, @temp_min, @precipitation, @wind_max, @wind_mean, @pressure,
    @sunshine, @cloud, @humidity, @vapour_pressure, @snow, @temp_ground_min
  )
  ON CONFLICT (station_id, date) DO UPDATE SET
    temp_mean       = excluded.temp_mean,
    temp_max        = excluded.temp_max,
    temp_min        = excluded.temp_min,
    precipitation   = excluded.precipitation,
    wind_max        = excluded.wind_max,
    wind_mean       = excluded.wind_mean,
    pressure        = excluded.pressure,
    sunshine        = excluded.sunshine,
    cloud           = excluded.cloud,
    humidity        = excluded.humidity,
    vapour_pressure = excluded.vapour_pressure,
    snow            = excluded.snow,
    temp_ground_min = excluded.temp_ground_min
`)

const insertMany = db.transaction((rows) => {
  for (const row of rows) upsert.run(row)
})

const countStmt = db.prepare(
  'SELECT COUNT(*) AS c, MAX(date) AS maxDate FROM daily WHERE station_id = ?',
)

/**
 * Download the historical archive (only when the station has no rows yet) plus
 * the rolling "recent" archive, and upsert everything.
 */
export async function importStation(stationId, { force = false } = {}) {
  setImportState(stationId, { importInProgress: true, lastError: null })

  try {
    const before = countStmt.get(stationId)
    const previousMaxDate = before.maxDate ?? null

    const urls = []
    // `force` exists for schema changes: when a new column is added, the rows
    // already in the table carry nothing for it, and only the historical
    // archive can fill them.
    if (before.c === 0 || force) {
      const historical = await resolveHistoricalUrl(stationId)
      if (historical) urls.push(historical)
    }
    urls.push(recentUrl(stationId))

    let imported = 0
    for (const url of urls) {
      const buffer = await fetchBuffer(url)
      for (const text of await extractProductFiles(buffer)) {
        const rows = parseProductFile(text, stationId)
        insertMany(rows)
        imported += rows.length
      }
    }

    const after = countStmt.get(stationId)
    setImportState(stationId, { importInProgress: false, lastError: null })

    return {
      success: true,
      // Rows actually added, not rows seen — re-importing "recent" overwrites
      // ~500 existing days every time.
      newRecordsCount: Math.max(0, after.c - before.c),
      processedRecordsCount: imported,
      newMaxDate: after.maxDate ?? null,
      previousMaxDate,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setImportState(stationId, { importInProgress: false, lastError: message })
    throw error
  }
}
