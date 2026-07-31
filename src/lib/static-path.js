/**
 * Map an API request to the file that holds its answer.
 *
 * GitHub Pages serves files, not query strings, so a static build has to turn
 * every `/api/x?a=1&b=2` into a path on disk. Both sides of that bargain use
 * this one function: `scripts/prerender.js` to decide where to write, and
 * `lib/api.ts` to decide where to read. Keeping it in a plain `.js` module is
 * what lets a Node script and the bundler share it verbatim — a second
 * implementation would drift, and the failure would be a 404 at runtime rather
 * than a compile error.
 *
 * Parameters are sorted, because callers spell the same request differently:
 * one view asks for `?year=&month=&stationId=`, another for
 * `?stationId=&year=&month=`. Unsorted, those would be two files.
 *
 *   /api/stations                              -> api/stations/index.json
 *   /api/weather/heatmap?stationId=01691       -> api/weather/heatmap/stationId-01691.json
 *   /api/weather/monthly?stationId=01691&year=2026&month=7
 *                                              -> api/weather/monthly/month-7__stationId-01691__year-2026.json
 */

/** Everything outside this set would be ambiguous or illegal in a filename. */
const UNSAFE = /[^A-Za-z0-9._-]/g

const safe = (value) => String(value).replace(UNSAFE, '-')

export function staticPath(path) {
  const [route, query = ''] = String(path).split('?')
  const clean = route.replace(/^\/+/, '').replace(/\/+$/, '')

  const params = [...new URLSearchParams(query).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // Double underscore separates pairs; single underscores occur inside
    // values ("temp_max", "day_in_history") and must not split them.
    .map(([key, value]) => `${safe(key)}-${safe(value)}`)

  return `${clean}/${params.length > 0 ? params.join('__') : 'index'}.json`
}
