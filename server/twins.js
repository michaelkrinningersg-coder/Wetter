import { db } from './db.js'

/**
 * The day in the archive that most resembles a given one.
 *
 * Every other analysis here reduces the record to one quantity at a time. This
 * one asks the opposite question: taking a whole day as it was — how warm, how
 * wet, how much cloud, what the barometer said — has anything like it happened
 * before?
 *
 * The comparison is in standard deviations, not in the quantities' own units,
 * because 5 mm of rain and 5 °C of temperature are not comparable amounts. Each
 * quantity is standardised over the whole record, and the distance between two
 * days is the root mean square of their standardised differences. A distance of
 * one means the two days differ, on average, by as much as any two days picked
 * at random.
 *
 * Nothing about the season is imposed. It emerges: a January day is three
 * standard deviations from a July day in temperature alone, so the nearest
 * neighbour of a January day is always another winter day. That the method does
 * not need to be told this is a small check that it is doing something real.
 */

/**
 * Two sets, because the interesting quantities and the long series disagree.
 *
 * Seven quantities are available from 1885 and cover 48,336 days. Adding wind
 * and sunshine makes the portrait of a day fuller and cuts the archive to
 * 20,758 days from 1969 — a third of the record for two more dimensions. Both
 * are defensible, so both ship and the reader picks.
 */
export const TWIN_SETS = [
  {
    key: 'kern',
    label: 'Sieben Größen',
    note: 'Temperatur, Niederschlag, Druck, Feuchte und Bewölkung — verfügbar ab 1885.',
    fields: [
      { key: 'temp_mean', label: 'Tagesmittel', unit: '°C', decimals: 1 },
      { key: 'temp_max', label: 'Höchstwert', unit: '°C', decimals: 1 },
      { key: 'temp_min', label: 'Tiefstwert', unit: '°C', decimals: 1 },
      { key: 'precipitation', label: 'Niederschlag', unit: 'mm', decimals: 1 },
      { key: 'pressure', label: 'Luftdruck', unit: 'hPa', decimals: 1 },
      { key: 'humidity', label: 'Luftfeuchte', unit: '%', decimals: 0 },
      { key: 'cloud', label: 'Bewölkung', unit: '/8', decimals: 1 },
    ],
  },
  {
    key: 'voll',
    label: 'Neun Größen',
    note: 'Zusätzlich Windböe und Sonnenschein — dafür erst ab 1969.',
    fields: [
      { key: 'temp_mean', label: 'Tagesmittel', unit: '°C', decimals: 1 },
      { key: 'temp_max', label: 'Höchstwert', unit: '°C', decimals: 1 },
      { key: 'temp_min', label: 'Tiefstwert', unit: '°C', decimals: 1 },
      { key: 'precipitation', label: 'Niederschlag', unit: 'mm', decimals: 1 },
      { key: 'pressure', label: 'Luftdruck', unit: 'hPa', decimals: 1 },
      { key: 'humidity', label: 'Luftfeuchte', unit: '%', decimals: 0 },
      { key: 'cloud', label: 'Bewölkung', unit: '/8', decimals: 1 },
      { key: 'wind_max', label: 'Windböe', unit: 'm/s', decimals: 1 },
      { key: 'sunshine', label: 'Sonnenschein', unit: 'h', decimals: 1 },
    ],
  },
]

export const TWIN_SET_BY_KEY = new Map(TWIN_SETS.map((s) => [s.key, s]))

/**
 * How far apart two days must be to count as different weather.
 *
 * Yesterday's nearest neighbour is the day before yesterday, and saying so
 * would be true and useless: they belong to the same weather system. A week
 * either side is dropped.
 */
const MIN_GAP_DAYS = 7

const DAY = 86_400_000

/* -------------------------------------------------------------------------- */
/* The matrix                                                                 */
/* -------------------------------------------------------------------------- */

const matrixCache = new Map()

function buildMatrix(stationId, set) {
  const columns = set.fields.map((f) => f.key)
  const rows = db
    .prepare(
      `SELECT date, ${columns.join(', ')} FROM daily
       WHERE station_id = ? AND ${columns.map((c) => `${c} IS NOT NULL`).join(' AND ')}
       ORDER BY date`,
    )
    .all(stationId)

  if (rows.length === 0) return null

  const n = rows.length
  const dates = new Array(n)
  const stamps = new Float64Array(n)
  const raw = columns.map(() => new Float64Array(n))

  for (let i = 0; i < n; i++) {
    dates[i] = rows[i].date
    stamps[i] = Date.parse(`${rows[i].date}T00:00:00Z`)
    for (let c = 0; c < columns.length; c++) raw[c][i] = rows[i][columns[c]]
  }

  // Standardise each quantity over the whole record, so a distance is in units
  // of that quantity's own variability rather than of degrees or millimetres.
  const mean = []
  const sd = []
  const z = columns.map(() => new Float64Array(n))
  for (let c = 0; c < columns.length; c++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += raw[c][i]
    const m = sum / n
    let variance = 0
    for (let i = 0; i < n; i++) variance += (raw[c][i] - m) ** 2
    const s = Math.sqrt(variance / n) || 1
    mean.push(m)
    sd.push(s)
    for (let i = 0; i < n; i++) z[c][i] = (raw[c][i] - m) / s
  }

  return {
    set,
    columns,
    dates,
    stamps,
    raw,
    z,
    mean,
    sd,
    n,
    index: new Map(dates.map((d, i) => [d, i])),
  }
}

function matrixFor(stationId, setKey) {
  const set = TWIN_SET_BY_KEY.get(setKey)
  if (!set) return null

  const last = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?').get(stationId)
  const key = `${stationId}|${setKey}|${last?.last ?? ''}`
  if (!matrixCache.has(key)) matrixCache.set(key, buildMatrix(stationId, set))
  return matrixCache.get(key)
}

/** Root mean square of the standardised differences between two days. */
function distance(matrix, a, b) {
  let sum = 0
  for (let c = 0; c < matrix.columns.length; c++) {
    const d = matrix.z[c][a] - matrix.z[c][b]
    sum += d * d
  }
  return Math.sqrt(sum / matrix.columns.length)
}

/* -------------------------------------------------------------------------- */
/* How unusual a best match is                                                */
/* -------------------------------------------------------------------------- */

/**
 * The distribution of best-match distances across the archive.
 *
 * "The closest day was 0.31 apart" means nothing on its own. Sampling three
 * hundred days evenly through the record and finding each one's own nearest
 * neighbour gives the scale: most days have a twin at around 0.2, so 0.31 is
 * ordinary and 0.8 would mean the day stands alone.
 */
const SAMPLE = 300
const baselineCache = new Map()

function baselineFor(matrix, cacheKey) {
  if (baselineCache.has(cacheKey)) return baselineCache.get(cacheKey)

  const step = Math.max(1, Math.floor(matrix.n / SAMPLE))
  const best = []
  for (let i = 0; i < matrix.n; i += step) {
    best.push(nearest(matrix, i, 1)[0]?.distance ?? null)
  }

  const sorted = best.filter((v) => v !== null).sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null

  const result = {
    days: sorted.length,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    sorted,
  }
  baselineCache.set(cacheKey, result)
  return result
}

/** Share of sampled days whose own best match is closer than this one. */
function percentileOf(baseline, value) {
  if (!baseline || baseline.sorted.length === 0 || value === null) return null
  let below = 0
  for (const v of baseline.sorted) if (v < value) below++
  return below / baseline.sorted.length
}

/* -------------------------------------------------------------------------- */
/* Nearest neighbours                                                         */
/* -------------------------------------------------------------------------- */

function nearest(matrix, at, count) {
  const limit = MIN_GAP_DAYS * DAY
  const stamp = matrix.stamps[at]
  const best = []

  for (let i = 0; i < matrix.n; i++) {
    if (i === at) continue
    if (Math.abs(matrix.stamps[i] - stamp) <= limit) continue

    const d = distance(matrix, at, i)
    if (best.length < count) {
      best.push({ index: i, distance: d })
      best.sort((a, b) => a.distance - b.distance)
      continue
    }
    if (d < best[best.length - 1].distance) {
      best[best.length - 1] = { index: i, distance: d }
      best.sort((a, b) => a.distance - b.distance)
    }
  }
  return best
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

const TWIN_COUNT = 8

const dayOf = (matrix, i) => ({
  date: matrix.dates[i],
  values: Object.fromEntries(matrix.columns.map((c, k) => [c, matrix.raw[k][i]])),
})

/** Calendar distance in days, ignoring the year — 31 December and 1 January are one apart. */
function calendarGap(a, b) {
  const doy = (iso) => {
    const at = Date.parse(`${iso}T00:00:00Z`)
    const start = Date.parse(`${iso.slice(0, 4)}-01-01T00:00:00Z`)
    return Math.round((at - start) / DAY)
  }
  const gap = Math.abs(doy(a) - doy(b))
  return Math.min(gap, 365 - gap)
}

export function weatherTwins(stationId, date = null, setKey = 'kern') {
  const matrix = matrixFor(stationId, setKey)
  if (!matrix) return null

  const target = date ?? matrix.dates[matrix.n - 1]
  const at = matrix.index.get(target)
  if (at === undefined) {
    return {
      station: stationId,
      set: matrix.set.key,
      sets: TWIN_SETS.map((s) => ({ key: s.key, label: s.label, note: s.note })),
      requested: target,
      available: { first: matrix.dates[0], last: matrix.dates[matrix.n - 1], days: matrix.n },
      hint:
        `Für den ${target} liegen nicht alle ${matrix.columns.length} Größen vor.` +
        ' Ein Tag kann nur verglichen werden, wenn er vollständig gemessen wurde.',
      reference: null,
      twins: [],
    }
  }

  const baseline = baselineFor(matrix, `${stationId}|${setKey}|${matrix.n}`)
  const neighbours = nearest(matrix, at, TWIN_COUNT)

  const reference = dayOf(matrix, at)
  const twins = neighbours.map((n) => {
    const day = dayOf(matrix, n.index)
    return {
      ...day,
      distance: n.distance,
      calendarGap: calendarGap(target, day.date),
      yearsApart: Math.abs(Number(day.date.slice(0, 4)) - Number(target.slice(0, 4))),
      /** Where the two days differ, in the quantities' own units and in sigma. */
      differences: matrix.columns.map((c, k) => ({
        key: c,
        difference: day.values[c] - reference.values[c],
        sigma: (day.values[c] - reference.values[c]) / matrix.sd[k],
      })),
    }
  })

  const closest = twins[0]?.distance ?? null

  return {
    station: stationId,
    set: matrix.set.key,
    sets: TWIN_SETS.map((s) => ({ key: s.key, label: s.label, note: s.note })),
    fields: matrix.set.fields.map((f, k) => ({
      ...f,
      mean: matrix.mean[k],
      sd: matrix.sd[k],
    })),
    minGapDays: MIN_GAP_DAYS,
    available: { first: matrix.dates[0], last: matrix.dates[matrix.n - 1], days: matrix.n },
    baseline: {
      sampled: baseline.days,
      median: baseline.median,
      p10: baseline.p10,
      p90: baseline.p90,
    },
    reference,
    twins,
    /**
     * How ordinary this day's best match is. Near 1 means almost every other day
     * has a closer twin than this one — the day stands more alone than most.
     */
    percentile: percentileOf(baseline, closest),
  }
}

/** The one sentence the dashboard shows. */
export function twinHeadline(stationId) {
  const result = weatherTwins(stationId)
  if (!result?.twins?.length) return null

  const best = result.twins[0]
  return {
    date: result.reference.date,
    twin: best.date,
    distance: best.distance,
    yearsApart: best.yearsApart,
    calendarGap: best.calendarGap,
    percentile: result.percentile,
    median: result.baseline.median,
    fields: result.fields.length,
  }
}
