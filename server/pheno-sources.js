import { Buffer } from 'node:buffer'

/**
 * DWD phenology for the area around Göttingen.
 *
 * Phenology is the one DWD product that measures the weather's effect rather
 * than the weather: volunteers record the day a hazel first flowers, an apple
 * blossoms, an oak drops its leaves. Those dates move with the climate, and
 * unlike a temperature series they are what the climate actually did to
 * something alive.
 *
 * Three practical facts shape this module.
 *
 *   1. The files are enormous and almost entirely empty. Every line is padded
 *      with spaces to a fixed width, so 4.3 GB of downloads carry maybe 400 MB
 *      of characters. They are therefore streamed and filtered line by line —
 *      nothing is ever written to disk whole.
 *
 *   2. Every species is published in three snapshots (…_2018_hist,
 *      …_2019_hist, …_2024_hist) holding the same series at different states of
 *      revision. Only the newest is read; taking all three would triple the
 *      download to re-read the same observations.
 *
 *   3. The `recent` files are, for this area, all but empty — hazel returns
 *      four observations from two stations across 2024 and 2025. The reporter
 *      network has thinned to the point where the regional series effectively
 *      ends with `historical`. That is a property of the source, not of this
 *      code, and the views say so rather than drawing an axis to the present.
 *
 * Depends on nothing outside the Node standard library.
 */

const BASE =
  'https://opendata.dwd.de/climate_environment/CDC/observations_germany/phenology/annual_reporters'
const HELP = 'https://opendata.dwd.de/climate_environment/CDC/help'

/** Distances are measured from DWD station 01691, as everywhere in this project. */
export const ORIGIN = { lat: 51.5002, lon: 9.9507, station: '01691' }

/** How far out a reporter still counts as "the region" — the same 25 km as the probes. */
export const RADIUS_KM = 25

/**
 * The groups collected.
 *
 * Vine and grassland are left out: the Göttingen area has next to no
 * viticulture reporters, and grassland yields mowing dates that follow farm
 * decisions more than the season.
 */
export const GROUPS = [
  { key: 'wild', dir: 'wild', label: 'Wildwachsende Pflanzen' },
  { key: 'fruit', dir: 'fruit', label: 'Obst' },
  { key: 'crops', dir: 'crops', label: 'Kulturpflanzen' },
]

export function distanceKm(lat, lon, from = ORIGIN) {
  const dLat = (lat - from.lat) * 111.2
  const dLon = (lon - from.lon) * Math.cos((from.lat * Math.PI) / 180) * 111.2
  return Math.hypot(dLat, dLon)
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                              */
/* -------------------------------------------------------------------------- */

async function fetchLatin1(url, { attempts = 3 } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // The DWD serves ISO-8859-1 throughout; plant names carry umlauts.
      return Buffer.from(await res.arrayBuffer()).toString('latin1')
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : last}`)
}

/**
 * Parse one of the DWD's `;eor;`-terminated dictionary files.
 *
 * Records are terminated by `;eor;` and may run across several lines — the
 * plant file wraps mid-record, so splitting on newlines loses entries.
 */
function parseDictionary(text) {
  const body = text.replace(/\r/g, '').split('\n').slice(1).join('\n')
  const out = new Map()
  for (const chunk of body.split(';eor;')) {
    const cells = chunk
      .replace(/\n/g, '')
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c !== '')
    if (cells.length >= 2 && /^\d+$/.test(cells[0])) out.set(cells[0], cells[1])
  }
  return out
}

/** The plant and phase dictionaries, fetched once. */
export async function fetchDictionaries() {
  const [plants, phases] = await Promise.all([
    fetchLatin1(`${HELP}/PH_Beschreibung_Pflanze.txt`),
    fetchLatin1(`${HELP}/PH_Beschreibung_Phase.txt`),
  ])
  return { plants: parseDictionary(plants), phases: parseDictionary(phases) }
}

/**
 * The reporter stations inside the radius.
 *
 * The description file is fixed-width-ish but semicolon-separated: id, name,
 * latitude, longitude, elevation, then the natural-region classification.
 */
export async function fetchStations() {
  const text = await fetchLatin1(`${HELP}/PH_Beschreibung_Phaenologie_Stationen_Jahresmelder.txt`)

  const stations = []
  for (const line of text.replace(/\r/g, '').split('\n').slice(1)) {
    const cells = line.split(';').map((c) => c.trim())
    if (cells.length < 6) continue

    const id = cells[0]
    const lat = Number(cells[2])
    const lon = Number(cells[3])
    if (!/^\d+$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue

    const km = distanceKm(lat, lon)
    if (km > RADIUS_KM) continue

    stations.push({
      id,
      name: cells[1],
      lat,
      lon,
      elevation: Number(cells[4]) || null,
      landscape: cells[6] ?? '',
      distance: Math.round(km * 10) / 10,
    })
  }
  return stations.sort((a, b) => a.distance - b.distance)
}

/* -------------------------------------------------------------------------- */
/* File discovery                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The newest snapshot per species in a group's `historical` directory.
 *
 * Filenames end `…_<from>_<to>_hist.txt`; where the same species appears with
 * several end years, only the highest is kept.
 */
export async function listFiles(group) {
  const dir = `${BASE}/${group.dir}/historical/`
  const html = await fetchLatin1(dir)

  const newest = new Map()
  for (const match of html.matchAll(/<a href="(PH_Jahresmelder[^"]+\.txt)"/g)) {
    const file = match[1]
    const parts = file.match(/^(.+?)_(\d{4})_(\d{4})_hist\.txt$/)
    if (!parts) continue

    const [, species, , to] = parts
    const year = Number(to)
    const previous = newest.get(species)
    if (!previous || year > previous.year) {
      newest.set(species, { species, year, file, url: dir + file })
    }
  }
  return [...newest.values()].sort((a, b) => a.file.localeCompare(b.file))
}

/* -------------------------------------------------------------------------- */
/* Streaming read                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read one observation file, keeping only the rows from wanted stations.
 *
 * Streamed in chunks rather than buffered: the largest single file is 134 MB of
 * which about a third of one percent is relevant, and holding it in memory to
 * throw away 99.6 % of it would be pointless. `onProgress` reports bytes so a
 * long run shows movement.
 *
 * Columns: `Stations_id; Referenzjahr; Qualitaetsniveau; Objekt_id; Phase_id;
 * Eintrittsdatum; Eintrittsdatum_QB; Jultag; eor`.
 */
export async function readObservations(url, wanted, { onProgress } = {}) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)

  const rows = []
  let rest = ''
  let bytes = 0

  const decoder = new TextDecoder('latin1')
  for await (const chunk of res.body) {
    bytes += chunk.length
    onProgress?.(chunk.length)

    rest += decoder.decode(chunk, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''

    for (const line of lines) {
      const row = parseObservation(line, wanted)
      if (row) rows.push(row)
    }
  }
  const row = parseObservation(rest, wanted)
  if (row) rows.push(row)

  return { rows, bytes }
}

function parseObservation(line, wanted) {
  if (!line || line.length < 20) return null

  const cells = line.split(';')
  if (cells.length < 8) return null

  const station = cells[0].trim()
  if (!wanted.has(station)) return null

  const year = Number(cells[1])
  const quality = Number(cells[2])
  const plant = Number(cells[3])
  const phase = Number(cells[4])
  const date = cells[5].trim()
  const julian = Number(cells[7])

  if (!Number.isFinite(year) || !Number.isFinite(plant) || !Number.isFinite(phase)) return null
  if (!Number.isFinite(julian) || julian < 1 || julian > 366) return null
  if (!/^\d{8}$/.test(date)) return null

  return { station, year, quality, plant, phase, date, julian }
}
