/**
 * Known DWD stations.
 *
 * `historicalUrl` is resolved at import time by listing the DWD directory,
 * because the historical archive filename embeds the station's first and last
 * measurement date and therefore changes whenever the DWD publishes a new
 * yearly archive. The original app hard-coded
 * `..._18580101_20251231_hist.zip`, which silently 404s after the next
 * archive rollover.
 */

const BASE =
  'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl'

export const STATIONS = [
  { id: '01691', name: 'Göttingen', altitude: 167 },
  { id: '00722', name: 'Brocken', altitude: 1141 },
  { id: '05792', name: 'Zugspitze', altitude: 2964 },
]

export function findStation(stationId) {
  if (!stationId) return null
  // Accept both "1691" and "01691".
  const padded = String(stationId).padStart(5, '0')
  return STATIONS.find((s) => s.id === padded) ?? null
}

export const recentUrl = (id) => `${BASE}/recent/tageswerte_KL_${id}_akt.zip`
export const historicalIndexUrl = `${BASE}/historical/`
export const historicalDirUrl = (file) => `${BASE}/historical/${file}`
