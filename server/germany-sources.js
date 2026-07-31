import { Buffer } from 'node:buffer'

import { readMatchingText } from './zip.js'

/**
 * Nationwide daily readings from the DWD open data server.
 *
 * There is no bulk file. The DWD publishes one ZIP per station and nothing
 * else — `timeseries_overview` is a catalogue of series lengths, not values,
 * and the derived products under `weather_reports` are radiation only. So the
 * whole country means fetching a few thousand small archives, which at 16
 * parallel connections takes well under two minutes.
 *
 * Two networks are read:
 *
 *   kl           576 climate stations with the full parameter set
 *   more_precip  2319 stations that measure precipitation and snow only
 *
 * The second exists because heavy rain is a small-scale affair: with the 481
 * climate stations that report rain on a given day, the actual national daily
 * maximum is missed more often than not. Every other category uses `kl` alone,
 * so the station set stays comparable across them.
 *
 * Like `gauge-sources.js`, this module deliberately imports no database — the
 * scheduled workflow runs it with nothing installed.
 */

const CDC = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily'

/** DWD marks missing values with -999. */
const MISSING = -999

export const NETWORKS = {
  kl: {
    id: 'kl',
    label: 'Klimastationen',
    dir: `${CDC}/kl/recent/`,
    historicalDir: `${CDC}/kl/historical/`,
    historicalPattern: /tageswerte_KL_(\d+)_(\d{8})_(\d{8})_hist\.zip/g,
    metaFile: 'KL_Tageswerte_Beschreibung_Stationen.txt',
    filePattern: /tageswerte_KL_(\d+)_akt\.zip/g,
    fileName: (id) => `tageswerte_KL_${id}_akt.zip`,
    // Not `produkt_klima_tag_`: the Zugspitze platform station ships its
    // readings as `produkt_klima_zug_tag_`, with an identical column set. Each
    // archive holds exactly one product file, so matching the prefix is both
    // simpler and more durable than enumerating the variants.
    product: /(^|\/)produkt_.*\.txt$/i,
    columns: {
      temp_mean: 'TMK',
      temp_max: 'TXK',
      temp_min: 'TNK',
      precipitation: 'RSK',
      wind_max: 'FX',
      wind_mean: 'FM',
      sunshine: 'SDK',
      cloud: 'NM',
      pressure: 'PM',
      humidity: 'UPM',
      snow: 'SHK_TAG',
    },
  },
  rr: {
    id: 'rr',
    label: 'Niederschlagsstationen',
    dir: `${CDC}/more_precip/recent/`,
    metaFile: 'RR_Tageswerte_Beschreibung_Stationen.txt',
    filePattern: /tageswerte_RR_(\d+)_akt\.zip/g,
    historicalDir: `${CDC}/more_precip/historical/`,
    historicalPattern: /tageswerte_RR_(\d+)_(\d{8})_(\d{8})_hist\.zip/g,
    fileName: (id) => `tageswerte_RR_${id}_akt.zip`,
    product: /(^|\/)produkt_.*\.txt$/i,
    columns: {
      precipitation: 'RS',
      snow: 'SH_TAG',
    },
  },
}

/** Every field the archive can carry, in a stable order. */
export const FIELDS = [
  'temp_mean',
  'temp_max',
  'temp_min',
  'precipitation',
  'wind_max',
  'wind_mean',
  'sunshine',
  'cloud',
  'pressure',
  'humidity',
  'snow',
]

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

async function fetchBuffer(url, { attempts = 3, timeoutMs = 60_000 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) {
      lastError = error
      // A few thousand requests in a row will hit the occasional reset; a
      // short backoff costs less than losing a station for the day.
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : lastError}`)
}

async function fetchText(url) {
  // DWD serves ISO-8859-1 throughout; decoding as UTF-8 mangles every umlaut
  // in the station names.
  return (await fetchBuffer(url)).toString('latin1')
}

/* -------------------------------------------------------------------------- */
/* Station master data                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The sixteen federal states.
 *
 * The precipitation network reaches across the border: four stations in Tirol
 * are published in the same file. They are legitimate DWD data but they are
 * not in Germany, and a headline that says "wettest station in Germany" has to
 * mean it.
 */
export const GERMAN_STATES = new Set([
  'Baden-Württemberg',
  'Bayern',
  'Berlin',
  'Brandenburg',
  'Bremen',
  'Hamburg',
  'Hessen',
  'Mecklenburg-Vorpommern',
  'Niedersachsen',
  'Nordrhein-Westfalen',
  'Rheinland-Pfalz',
  'Saarland',
  'Sachsen',
  'Sachsen-Anhalt',
  'Schleswig-Holstein',
  'Thüringen',
])

/** Width of the station-name column, per the header rule of both files. */
const NAME_WIDTH = 41

/**
 * Parse `*_Beschreibung_Stationen.txt`.
 *
 * The file looks fixed-width but the two networks pad their numeric columns
 * differently, so column offsets taken from one file are wrong for the other.
 * The leading fields are read as whitespace-separated tokens instead, and the
 * trailing text is split on runs of two or more spaces — neither a station
 * name nor a federal state ever contains those, while the padding always does.
 */
export function parseStations(text, network) {
  const stations = []
  for (const raw of text.split('\n').slice(2)) {
    // The files are CRLF, and a trailing \r defeats `$` because JavaScript's
    // `.` treats carriage return as a line terminator and refuses to match it.
    const line = raw.trimEnd()
    const match = line.match(/^(\d{4,5})\s+(\d{8})\s+(\d{8})\s+(-?\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(.+)$/)
    if (!match) continue

    const [, id, from, until, elevation, lat, lon, rest] = match
    const parts = rest.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
    // The last part is the Abgabe column ("Frei"), which is not wanted.
    if (parts.length > 1 && parts.at(-1) === 'Frei') parts.pop()

    let [name = '', state = ''] = parts
    if (!state && name.length > NAME_WIDTH) {
      // One station's name is long enough to leave a single space before the
      // federal state, which the two-space split cannot see. Fall back to the
      // documented column width.
      state = name.slice(NAME_WIDTH).trim()
      name = name.slice(0, NAME_WIDTH).trim()
    }

    stations.push({
      id: id.padStart(5, '0'),
      network,
      from,
      until,
      elevation: Number(elevation),
      lat: Number(lat),
      lon: Number(lon),
      name,
      state,
      german: GERMAN_STATES.has(state),
    })
  }
  return stations
}

/** Station master data for one network, keyed by five-digit id. */
export async function fetchStations(network) {
  const net = NETWORKS[network]
  const text = await fetchText(net.dir + net.metaFile)
  return new Map(parseStations(text, network).map((s) => [s.id, s]))
}

/** The station ids that actually have a `recent` archive. */
export async function listStationIds(network) {
  const net = NETWORKS[network]
  const html = await fetchText(net.dir)
  const ids = new Set()
  for (const m of html.matchAll(net.filePattern)) ids.add(m[1].padStart(5, '0'))
  return [...ids].sort()
}

/* -------------------------------------------------------------------------- */
/* Daily values                                                               */
/* -------------------------------------------------------------------------- */

function parseProduct(text, network) {
  const net = NETWORKS[network]
  const lines = text.trim().split('\n')
  const header = lines[0].split(';').map((s) => s.trim())

  const index = {}
  for (const [field, column] of Object.entries(net.columns)) {
    const at = header.indexOf(column)
    if (at >= 0) index[field] = at
  }
  const dateAt = header.indexOf('MESS_DATUM')
  if (dateAt < 0) throw new Error('Spalte MESS_DATUM fehlt')

  const rows = []
  for (const line of lines.slice(1)) {
    const cells = line.split(';')
    const raw = cells[dateAt]?.trim()
    if (!/^\d{8}$/.test(raw)) continue

    const row = { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` }
    let any = false
    for (const [field, at] of Object.entries(index)) {
      const value = Number(cells[at]?.trim())
      if (Number.isFinite(value) && value !== MISSING) {
        row[field] = value
        any = true
      }
    }
    // A row where every parameter is missing carries no information and would
    // only inflate the archive.
    if (any) rows.push(row)
  }
  return rows
}

/**
 * Download one station's `recent` archive and return its daily rows.
 *
 * `since` drops older days before they are ever materialised — the archives
 * hold about 500 days each and a daily run only wants the last one.
 */
export async function fetchStationDays(network, id, { since = null } = {}) {
  const net = NETWORKS[network]
  const buffer = await fetchBuffer(net.dir + net.fileName(id))
  const text = readMatchingText(buffer, net.product)
  if (text === null) throw new Error(`Produktdatei fehlt in ${net.fileName(id)}`)

  const rows = parseProduct(text, network)
  return since ? rows.filter((r) => r.date >= since) : rows
}

/* -------------------------------------------------------------------------- */
/* Historical archives                                                        */
/* -------------------------------------------------------------------------- */

/**
 * List the historical archives of a network.
 *
 * These hold the full record of each station, which the rolling `recent`
 * archives do not — those reach back about 500 days. The two overlap rather
 * than abut: for the climate network 561 archives run to 31 December 2025
 * while `recent` starts in January 2025, so the union has no gap.
 *
 * The directory listing names every archive twice, once in the href and once
 * as the link text; without deduplication every station is counted double.
 */
export async function listHistorical(network) {
  const net = NETWORKS[network]
  const html = await fetchText(net.historicalDir)
  const found = new Map()
  for (const m of html.matchAll(net.historicalPattern)) {
    const id = m[1].padStart(5, '0')
    // A station can have several archives; the one ending latest wins.
    const entry = { id, file: m[0], from: m[2], to: m[3] }
    const prev = found.get(id)
    if (!prev || entry.to > prev.to) found.set(id, entry)
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Download and parse one historical archive. */
export async function fetchHistoricalDays(network, entry, { before = null } = {}) {
  const net = NETWORKS[network]
  const buffer = await fetchBuffer(net.historicalDir + entry.file)
  const text = readMatchingText(buffer, net.product)
  if (text === null) throw new Error(`Produktdatei fehlt in ${entry.file}`)

  const rows = parseProduct(text, network)
  return before ? rows.filter((r) => r.date < before) : rows
}

/**
 * Fetch a whole network.
 *
 * Failures are collected rather than thrown: one unreachable archive out of
 * three thousand must not cost the whole day.
 *
 * Pass `onRows` to consume each station as it arrives — a full backfill spans
 * roughly 500 days across 2400 stations, and holding a million row objects in
 * memory to hand them back in one array is the difference between a modest
 * process and a heap that needs tuning. Without the callback the rows are
 * accumulated and returned, which is what the one-day case wants.
 */
export async function fetchNetwork(
  network,
  { since = null, concurrency = 16, onProgress = null, onRows = null } = {},
) {
  const [stations, ids] = await Promise.all([
    fetchStations(network),
    listStationIds(network),
  ])

  const rows = []
  const failed = []
  const queue = [...ids]
  let done = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const station = stations.get(id) ?? null
          const days = await fetchStationDays(network, id, { since })
          if (onRows) onRows(id, station, days)
          else for (const row of days) rows.push({ ...row, station_id: id, network })
        } catch (error) {
          failed.push({ id, error: error instanceof Error ? error.message : String(error) })
        }
        done++
        if (onProgress && done % 250 === 0) onProgress(done, ids.length)
      }
    }),
  )

  return { rows, stations, ids, failed }
}
