/**
 * Air quality for Göttingen, from the Umweltbundesamt.
 *
 * Two stations stand in the city and they are the point of the whole thing:
 * DENI042 sits in the urban background, DENI068 directly at a road. The same
 * pollutant measured 2.7 km apart under different exposure is what makes the
 * numbers readable — a single station would only ever say "this is the air",
 * with nothing to hold it against.
 *
 * Two facts about the source that shape everything below:
 *
 *   1. The API serves measurements from 2016-01-01 onwards and nothing before,
 *      no matter what the station metadata claims about when it was built. That
 *      is why this project archives what it fetches: if the window ever rolls
 *      forward, the committed CSV keeps the years the API has dropped.
 *
 *   2. For ozone and nitrogen dioxide the API offers no daily mean at all —
 *      only hourly values and daily maxima. Any daily figure for those two has
 *      to be computed from the hourly series, which is the other reason the
 *      archive stores hours rather than days.
 *
 * Times are stored exactly as the UBA publishes them, hour by hour, and not
 * converted. The service documents its timestamps as MEZ year-round; the
 * diurnal shape of ozone and NO₂ is consistent with that but does not prove it,
 * so shifting the hours here would be inventing a precision this module does
 * not have.
 *
 * Like the other collectors, this module imports no database — the scheduled
 * workflow runs it on a bare Node install.
 */

const BASE = 'https://luftdaten.umweltbundesamt.de/api/air-data/v3'

/** The first day the API answers for. Earlier dates return an empty set. */
export const ARCHIVE_START = '2016-01-01'

/**
 * The measured quantities.
 *
 * `scope` is the UBA's averaging period, and it is not the same for all of
 * them: everything is a one-hour mean except carbon monoxide, which the service
 * publishes only as an eight-hour mean. The column is named accordingly so a
 * reader never takes it for an hourly figure.
 *
 * `limits` carries the thresholds of the 39. BImSchV. Each one names the
 * statistic it applies to, because the same pollutant is bounded in several
 * ways at once and a bare number would be unreadable: PM₁₀ has both a daily
 * limit that may be exceeded 35 times a year and an annual limit that may not
 * be exceeded at all.
 */
export const COMPONENTS = [
  {
    key: 'pm10',
    component: 1,
    scope: 2,
    label: 'Feinstaub PM₁₀',
    short: 'PM₁₀',
    unit: 'µg/m³',
    decimals: 0,
    limits: [
      { stat: 'day_mean', value: 50, allowance: 35, label: 'Tagesmittel' },
      { stat: 'year_mean', value: 40, allowance: 0, label: 'Jahresmittel' },
    ],
  },
  {
    key: 'pm25',
    component: 9,
    scope: 2,
    label: 'Feinstaub PM₂٫₅',
    short: 'PM₂٫₅',
    unit: 'µg/m³',
    decimals: 0,
    limits: [{ stat: 'year_mean', value: 25, allowance: 0, label: 'Jahresmittel' }],
  },
  {
    key: 'o3',
    component: 3,
    scope: 2,
    label: 'Ozon',
    short: 'O₃',
    unit: 'µg/m³',
    decimals: 0,
    limits: [
      { stat: 'hour', value: 180, allowance: 0, label: 'Informationsschwelle, 1 h' },
      { stat: 'hour', value: 240, allowance: 0, label: 'Alarmschwelle, 1 h' },
      { stat: 'day_max8h', value: 120, allowance: 25, label: 'Zielwert, höchstes 8-h-Mittel' },
    ],
  },
  {
    key: 'no2',
    component: 5,
    scope: 2,
    label: 'Stickstoffdioxid',
    short: 'NO₂',
    unit: 'µg/m³',
    decimals: 0,
    limits: [
      { stat: 'hour', value: 200, allowance: 18, label: 'Stundenmittel' },
      { stat: 'year_mean', value: 40, allowance: 0, label: 'Jahresmittel' },
    ],
  },
  {
    key: 'so2',
    component: 4,
    scope: 2,
    label: 'Schwefeldioxid',
    short: 'SO₂',
    unit: 'µg/m³',
    decimals: 0,
    limits: [
      { stat: 'hour', value: 350, allowance: 24, label: 'Stundenmittel' },
      { stat: 'day_mean', value: 125, allowance: 3, label: 'Tagesmittel' },
    ],
  },
  {
    key: 'co_8h',
    component: 2,
    scope: 4,
    label: 'Kohlenmonoxid (8-h-Mittel)',
    short: 'CO',
    unit: 'mg/m³',
    // Values sit around 0.3 mg/m³ — a single decimal would quantise the whole
    // series into three or four distinct numbers.
    decimals: 2,
    limits: [{ stat: 'day_max', value: 10, allowance: 0, label: 'höchstes 8-h-Mittel' }],
  },
]

export const COMPONENT_BY_KEY = new Map(COMPONENTS.map((c) => [c.key, c]))

/** The column order of a day file. */
export const FIELDS = COMPONENTS.map((c) => c.key)

/**
 * The two stations, with the components each one actually reports.
 *
 * The lists are not guesses: every pair below returned data when probed, and
 * every pair left out returned none. The traffic station measures no ozone —
 * which is itself the reason ozone comparisons only ever cite the background
 * station.
 */
export const AIR_STATIONS = [
  {
    id: 'DENI042',
    uba: '930',
    name: 'Göttingen',
    kind: 'background',
    kindLabel: 'Hintergrund, vorstädtisch',
    address: 'Nohlstraße, 37075',
    lat: 51.5511,
    lon: 9.9498,
    components: ['pm10', 'pm25', 'o3', 'no2', 'so2'],
  },
  {
    id: 'DENI068',
    uba: '950',
    name: 'Göttingen-Verkehr',
    kind: 'traffic',
    kindLabel: 'Verkehr, städtisch',
    address: 'Bürgerstraße 20, 37073',
    lat: 51.5302,
    lon: 9.9283,
    components: ['pm10', 'pm25', 'no2', 'co_8h'],
  },
]

export const STATION_BY_ID = new Map(AIR_STATIONS.map((s) => [s.id, s]))

/** Every (station, component) pair that carries data. */
export function seriesList() {
  const out = []
  for (const station of AIR_STATIONS) {
    for (const key of station.components) {
      const component = COMPONENT_BY_KEY.get(key)
      if (component) out.push({ station, component })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Fetch                                                                      */
/* -------------------------------------------------------------------------- */

async function fetchJson(url, { attempts = 4 } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : last}`)
}

/**
 * One station and one component over a date range.
 *
 * Returns `{ '2026-07-30': { 0: 82, 1: 80, … } }` — date to hour to value, with
 * gaps simply absent. The API marks a missing hour with a null value rather
 * than omitting the row, and those are dropped here: an hour the instrument did
 * not measure and an hour it measured as zero must not end up looking alike.
 */
export async function fetchSeries(station, component, from, to) {
  const url =
    `${BASE}/measures/json?date_from=${from}&time_from=1&date_to=${to}&time_to=24` +
    `&station=${station.id}&component=${component.component}&scope=${component.scope}`

  const body = await fetchJson(url)
  const data = body?.data
  if (!data || typeof data !== 'object') return {}

  // Keyed by the UBA's numeric station id, which we do not want to depend on
  // staying stable — there is only ever one entry per request.
  const readings = Object.values(data)[0]
  if (!readings || typeof readings !== 'object') return {}

  const byDate = {}
  for (const [start, entry] of Object.entries(readings)) {
    // `start` is the beginning of the averaging interval: "2026-07-30 14:00:00".
    const value = Array.isArray(entry) ? entry[2] : null
    if (value === null || value === undefined) continue

    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue

    const date = start.slice(0, 10)
    const hour = Number(start.slice(11, 13))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour)) continue

    byDate[date] ??= {}
    byDate[date][hour] = numeric
  }
  return byDate
}

/**
 * Every series over a date range, merged into one row per station and hour.
 *
 * Returns `{ '2026-07-30': [{ station, hour, pm10, … }, …] }`. Requests run one
 * after another rather than in parallel: nine of them cover a decade in about
 * forty seconds, and a public API owed nothing is not worth hammering.
 */
export async function fetchRange(from, to, { onProgress } = {}) {
  const merged = new Map()

  for (const { station, component } of seriesList()) {
    const byDate = await fetchSeries(station, component, from, to)
    let values = 0

    for (const [date, hours] of Object.entries(byDate)) {
      if (!merged.has(date)) merged.set(date, new Map())
      const day = merged.get(date)
      for (const [hour, value] of Object.entries(hours)) {
        const rowKey = `${station.id}|${hour}`
        if (!day.has(rowKey)) day.set(rowKey, { station: station.id, hour: Number(hour) })
        day.get(rowKey)[component.key] = value
        values++
      }
    }
    onProgress?.({ station, component, values })
  }

  const out = {}
  for (const [date, day] of merged) {
    out[date] = [...day.values()].sort(
      (a, b) => a.station.localeCompare(b.station) || a.hour - b.hour,
    )
  }
  return out
}
