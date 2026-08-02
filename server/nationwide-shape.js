/**
 * What one day looked like across the whole country, reduced to twenty numbers.
 *
 * Four questions share one pass over the data, because they share the same
 * expensive part — reading every station's value for every day:
 *
 *  - how far apart the warmest and the coldest place were,
 *  - how temperature fell with altitude, and whether it fell at all,
 *  - how it fell from south to north and from west to east,
 *  - which station held each of the day's extremes.
 *
 * The archive keeps only these results, never the readings they came from.
 * Storing 1,285 stations × 145 years of daily values would be a gigabyte of
 * CSV in a repository; storing the shape of each day is one line.
 *
 * Pure arithmetic on purpose: no database, no filesystem. The one-off historical
 * pass imports it while streaming downloads, and the server imports it to extend
 * the series with the days the daily archive already holds. Both must produce
 * the same numbers or the series has a seam at the cutoff.
 */

/** A degree of latitude in kilometres, as everywhere else in this project. */
const KM_PER_DEGREE = 111.2

/**
 * Where the mountains start, for the purpose of a second set of extremes.
 *
 * The Zugspitze at 2,962 m is Germany's coldest place on almost every day of
 * the year, and the Wendelstein and the Brocken take most of the rest. A span
 * that always ends on the same summit measures altitude, not weather — it is
 * still worth having, but it cannot be the only one.
 *
 * So every extreme is kept twice: once over all stations, once over everything
 * below a thousand metres, which is where all but a handful of people live.
 * The same limit the nationwide superlatives and the percentile ranking already
 * use, so the three pages mean the same thing by "lowland".
 */
export const LOWLAND_LIMIT = 1000

/**
 * The origin the geographic coordinates are measured from.
 *
 * Roughly the middle of Germany. Only the intercept depends on it — the
 * gradients do not — but centring keeps the normal equations well conditioned.
 */
const LAT0 = 51
const LON0 = 10

/** Kilometres north of the origin. */
export function northKm(lat) {
  return (lat - LAT0) * KM_PER_DEGREE
}

/**
 * Kilometres east of the origin.
 *
 * Scaled by the cosine of each station's own latitude rather than one mean
 * value: over eight degrees of latitude the factor runs from 0.64 to 0.57, and
 * using the station's own is free.
 */
export function eastKm(lat, lon) {
  return (lon - LON0) * KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180)
}

/* -------------------------------------------------------------------------- */
/* Accumulator                                                                */
/* -------------------------------------------------------------------------- */

function emptyDay() {
  return {
    n: 0,
    hi: null,
    lo: null,
    absHi: null,
    absLo: null,
    lowHi: null,
    lowLo: null,
    lowAbsHi: null,
    lowAbsLo: null,
    wet: null,
    gust: null,
    // Sums for the regression of temp_mean on north, east and elevation.
    // Named rather than indexed: a typo in `sxy` is a wrong slope, and a typo
    // in `s[7]` is a wrong slope nobody finds.
    sn: 0,
    se: 0,
    sh: 0,
    sy: 0,
    snn: 0,
    sne: 0,
    snh: 0,
    sny: 0,
    see: 0,
    seh: 0,
    sey: 0,
    shh: 0,
    shy: 0,
    syy: 0,
  }
}

const better = (current, value, station, wantHigher) =>
  current === null || (wantHigher ? value > current.value : value < current.value)
    ? { value, station }
    : current

/**
 * Fold one station's reading for one day into the day's accumulator.
 *
 * `station` carries lat, lon and elevation from the current station register.
 * Those are the coordinates the station has today, not necessarily the ones it
 * had in 1902 — the register does not record moves, and a gradient over 700 km
 * does not turn on a station shifting three kilometres down the valley.
 */
export function addReading(days, date, station, row) {
  let day = days.get(date)
  if (!day) {
    day = emptyDay()
    days.set(date, day)
  }

  if (row.precipitation !== undefined && row.precipitation !== null) {
    day.wet = better(day.wet, row.precipitation, station.id, true)
  }
  if (row.wind_max !== undefined && row.wind_max !== null) {
    day.gust = better(day.gust, row.wind_max, station.id, true)
  }
  const lowland = station.elevation < LOWLAND_LIMIT

  if (row.temp_max !== undefined && row.temp_max !== null) {
    day.absHi = better(day.absHi, row.temp_max, station.id, true)
    if (lowland) day.lowAbsHi = better(day.lowAbsHi, row.temp_max, station.id, true)
  }
  if (row.temp_min !== undefined && row.temp_min !== null) {
    day.absLo = better(day.absLo, row.temp_min, station.id, false)
    if (lowland) day.lowAbsLo = better(day.lowAbsLo, row.temp_min, station.id, false)
  }

  const y = row.temp_mean
  if (y === undefined || y === null) return
  if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return
  if (!Number.isFinite(station.elevation)) return

  day.hi = better(day.hi, y, station.id, true)
  day.lo = better(day.lo, y, station.id, false)
  if (lowland) {
    day.lowHi = better(day.lowHi, y, station.id, true)
    day.lowLo = better(day.lowLo, y, station.id, false)
  }

  const n = northKm(station.lat)
  const e = eastKm(station.lat, station.lon)
  const h = station.elevation

  day.n++
  day.sn += n
  day.se += e
  day.sh += h
  day.sy += y
  day.snn += n * n
  day.sne += n * e
  day.snh += n * h
  day.sny += n * y
  day.see += e * e
  day.seh += e * h
  day.sey += e * y
  day.shh += h * h
  day.shy += h * y
  day.syy += y * y
}

/* -------------------------------------------------------------------------- */
/* Fits                                                                       */
/* -------------------------------------------------------------------------- */

/** Gauss-Jordan with partial pivoting, for the 4×4 normal equations. */
export function solve(matrix, rhs) {
  const size = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < size; col++) {
    let pivot = col
    for (let r = col + 1; r < size; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    const lead = a[col][col]
    for (let c = col; c <= size; c++) a[col][c] /= lead

    for (let r = 0; r < size; r++) {
      if (r === col) continue
      const factor = a[r][col]
      if (factor === 0) continue
      for (let c = col; c <= size; c++) a[r][c] -= factor * a[col][c]
    }
  }

  return a.map((row) => row[size])
}

/**
 * Below this a fit is not reported.
 *
 * A four-parameter surface through twenty stations would produce a coefficient
 * for every day of the 1880s and mean nothing. Thirty is still thin, and the
 * station count travels with every value so a view can be stricter.
 */
export const MIN_FOR_FIT = 30
const MIN_FOR_LAPSE = 20

/** Simple regression of temperature on altitude, in K per 100 m. */
function lapseOf(day) {
  if (day.n < MIN_FOR_LAPSE) return { lapse: null, lapseR2: null }

  const n = day.n
  const varH = day.shh - (day.sh * day.sh) / n
  const varY = day.syy - (day.sy * day.sy) / n
  const cov = day.shy - (day.sh * day.sy) / n
  if (varH <= 0 || varY <= 0) return { lapse: null, lapseR2: null }

  const slope = cov / varH
  return { lapse: slope * 100, lapseR2: (cov * cov) / (varH * varY) }
}

/**
 * Temperature against north, east and altitude at once.
 *
 * The three cannot be asked separately: Germany's high ground is in the south,
 * so a plain south-to-north regression reports the Alps as a latitude effect.
 * Fitting all three together gives the gradient that remains after the other
 * two are held constant, which is what "how much colder is the north" means.
 */
function gradientOf(day) {
  if (day.n < MIN_FOR_FIT) return { gradN: null, gradE: null, gradH: null, gradR2: null }

  const n = day.n
  const matrix = [
    [n, day.sn, day.se, day.sh],
    [day.sn, day.snn, day.sne, day.snh],
    [day.se, day.sne, day.see, day.seh],
    [day.sh, day.snh, day.seh, day.shh],
  ]
  const rhs = [day.sy, day.sny, day.sey, day.shy]
  const beta = solve(matrix, rhs)
  if (!beta) return { gradN: null, gradE: null, gradH: null, gradR2: null }

  const [b0, bn, be, bh] = beta
  // Residual sum of squares from the sums alone: SSE = Σy² − βᵀ Xᵀy.
  const sse = day.syy - (b0 * day.sy + bn * day.sny + be * day.sey + bh * day.shy)
  const sst = day.syy - (day.sy * day.sy) / n
  const r2 = sst > 0 ? Math.max(0, Math.min(1, 1 - sse / sst)) : null

  return {
    /** K per 100 km northward — negative means the north is colder. */
    gradN: bn * 100,
    /** K per 100 km eastward. */
    gradE: be * 100,
    /** K per 100 m of altitude, holding position constant. */
    gradH: bh * 100,
    gradR2: r2,
  }
}

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

/** One row per date, sorted, ready for the archive or the database. */
export function finishShape(days) {
  const out = []
  for (const [date, day] of days) {
    if (day.n === 0 && !day.wet && !day.gust) continue
    out.push({
      date,
      stations: day.n,
      meanHiStation: day.hi?.station ?? null,
      meanHi: day.hi?.value ?? null,
      meanLoStation: day.lo?.station ?? null,
      meanLo: day.lo?.value ?? null,
      absHiStation: day.absHi?.station ?? null,
      absHi: day.absHi?.value ?? null,
      absLoStation: day.absLo?.station ?? null,
      absLo: day.absLo?.value ?? null,
      lowHiStation: day.lowHi?.station ?? null,
      lowHi: day.lowHi?.value ?? null,
      lowLoStation: day.lowLo?.station ?? null,
      lowLo: day.lowLo?.value ?? null,
      lowAbsHiStation: day.lowAbsHi?.station ?? null,
      lowAbsHi: day.lowAbsHi?.value ?? null,
      lowAbsLoStation: day.lowAbsLo?.station ?? null,
      lowAbsLo: day.lowAbsLo?.value ?? null,
      wetStation: day.wet?.station ?? null,
      wet: day.wet?.value ?? null,
      gustStation: day.gust?.station ?? null,
      gust: day.gust?.value ?? null,
      ...lapseOf(day),
      ...gradientOf(day),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
