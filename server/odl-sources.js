/**
 * Ambient gamma dose rate around Göttingen, from the Bundesamt für
 * Strahlenschutz.
 *
 * The BfS runs roughly 1700 probes across Germany and publishes them as open
 * GeoJSON. This module takes the eleven within 25 km of the DWD weather station
 * this project is built around — including one sited at the weather station
 * itself, 100 m away, and one 1.8 km off in the city.
 *
 * The reason to collect it daily is not that it changes quickly. It is that the
 * BfS keeps **only seven days**: the hourly series rolls forward and what falls
 * off the back is gone from the interface. Every day this does not run is a day
 * that cannot be recovered later, which is the opposite of the DWD archives,
 * where a missed run costs nothing.
 *
 * Timestamps are UTC — the service marks them so explicitly — and are stored
 * unconverted. Day boundaries in this archive are therefore UTC days, not
 * Berlin ones. The quantity has no pronounced daily cycle to misalign; it
 * responds to rainfall washing radon daughters out of the air, which is a
 * weather event rather than a time of day.
 *
 * Like the other collectors, this module imports no database.
 */

const WFS = 'https://www.imis.bfs.de/ogc/opendata/ows'

/**
 * The point distances are measured from: DWD station 01691.
 *
 * Taken from `data/germany/stations.csv`, not from a map — the whole project
 * hangs off this station and the radius should be centred on it rather than on
 * a nearby approximation.
 */
export const ORIGIN = { lat: 51.5002, lon: 9.9507, station: '01691' }

/** How far out a probe still counts as "the region". */
export const RADIUS_KM = 25

/** The measured quantity, for labelling. */
export const QUANTITY = {
  key: 'odl',
  label: 'Ortsdosisleistung',
  short: 'ODL',
  unit: 'µSv/h',
  decimals: 3,
  note: 'Gamma-Ortsdosisleistung, Brutto — kosmischer und terrestrischer Anteil zusammen.',
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Distance in kilometres on an equirectangular approximation.
 *
 * Good to a few metres over 25 km at this latitude, which is far finer than the
 * two decimal places the BfS publishes its coordinates to.
 */
export function distanceKm(lat, lon, from = ORIGIN) {
  const dLat = (lat - from.lat) * 111.2
  const dLon = (lon - from.lon) * Math.cos((from.lat * Math.PI) / 180) * 111.2
  return Math.hypot(dLat, dLon)
}

/* -------------------------------------------------------------------------- */
/* Fetch                                                                      */
/* -------------------------------------------------------------------------- */

async function wfs(params, { attempts = 4 } = {}) {
  const url = new URL(WFS)
  url.searchParams.set('service', 'WFS')
  url.searchParams.set('version', '2.0.0')
  url.searchParams.set('request', 'GetFeature')
  url.searchParams.set('outputFormat', 'application/json')
  url.searchParams.set('srsName', 'EPSG:4326')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (!body || !Array.isArray(body.features)) throw new Error('keine FeatureCollection')
      return body.features
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  throw new Error(`BfS-WFS: ${last instanceof Error ? last.message : last}`)
}

/**
 * The probes inside the radius, with their current split into cosmic and
 * terrestrial share.
 *
 * The set is derived from the source every run rather than hard-coded, so a
 * probe the BfS adds nearby joins the archive by itself. The split is a
 * property of the site — cosmic radiation rises with altitude, terrestrial
 * depends on what the ground is made of — and is carried in the register
 * rather than repeated for every hour.
 */
export async function fetchProbes() {
  const features = await wfs({ typeNames: 'opendata:odlinfo_odl_1h_latest' })

  const probes = []
  for (const feature of features) {
    const p = feature.properties ?? {}
    const coords = feature.geometry?.coordinates
    if (!p.kenn || !Array.isArray(coords)) continue

    const [lon, lat] = coords.map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    const km = distanceKm(lat, lon)
    if (km > RADIUS_KM) continue

    probes.push({
      id: String(p.kenn),
      code: p.id ?? '',
      name: String(p.name ?? '').replace(/\s+/g, ' ').trim(),
      lat,
      lon,
      elevation: Number(p.height_above_sea) || null,
      status: String(p.site_status_text ?? ''),
      distance: Math.round(km * 10) / 10,
      cosmic: p.value_cosmic ?? null,
      terrestrial: p.value_terrestrial ?? null,
    })
  }
  return probes.sort((a, b) => a.distance - b.distance)
}

/**
 * The rolling window of hourly values for the given probes.
 *
 * Returns `{ '2026-08-01': { '031520121': { 14: 0.117, … } } }` — date, probe,
 * hour. One request covers all eleven; the service answers with the full seven
 * days it holds, which is what makes a missed run recoverable the next day.
 */
export async function fetchWindow(probeIds) {
  if (probeIds.length === 0) return {}

  const list = probeIds.map((id) => `'${id}'`).join(',')
  const features = await wfs({
    typeNames: 'opendata:odlinfo_timeseries_odl_1h',
    CQL_FILTER: `kenn IN (${list})`,
  })

  const byDate = {}
  for (const feature of features) {
    const p = feature.properties ?? {}
    const start = String(p.start_measure ?? '')
    const value = p.value

    if (value === null || value === undefined) continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue

    // "2026-08-01T18:00:00Z" — the trailing Z is the service's own marker that
    // this is UTC, and it is stored that way.
    const match = start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/)
    if (!match) continue

    const [, date, hour] = match
    byDate[date] ??= {}
    byDate[date][p.kenn] ??= {}
    byDate[date][p.kenn][Number(hour)] = numeric
  }
  return byDate
}
