import { db } from './db.js'
import { GAUGES, findGauge } from './gauge-sources.js'

/**
 * The daily rhythm of a river gauge.
 *
 * A water level is not a constant that noise wobbles around — it drifts for
 * weeks on end. A flood in March and a dry August are the same series, and an
 * average taken by hour of day over both says more about which weeks happened
 * to be measured than about the day. The first job of this module is therefore
 * to remove the drift, and only then to look for the rhythm.
 *
 * It removes it with a 24-hour window: every hourly value is compared against
 * the mean of the day surrounding it. A full day contains every hour of the
 * clock exactly once, so its mean cannot carry a daily cycle — whatever is
 * left after subtracting it is the deviation from that day's level, and
 * nothing else. Two details make that true rather than nearly true:
 *
 *  - the window mean is built from hourly means, not from raw readings, so a
 *    night with four readings does not outweigh a morning with one;
 *  - a window needs at least half the hours of the clock, otherwise its mean
 *    is a morning mean and the "deviation" is the missing hours.
 *
 * That second rule is the whole reason this module can be honest about the two
 * gauges that publish only their current value. Their readings exist because
 * something asked for them, and if the asking has a rhythm — a laptop that is
 * open by day and shut at night — that rhythm would show up as a river's.
 * So every hour reports how many measurements stand behind it, and the view
 * shows that count next to the curve.
 */

/* -------------------------------------------------------------------------- */
/* Method                                                                     */
/* -------------------------------------------------------------------------- */

/** Half-width of the detrending window, in hours. */
const HALF_WINDOW = 12

/** Hours of the clock a window must cover before its mean is used. */
const MIN_HOURS_IN_WINDOW = 12

const readings = db.prepare(`
  SELECT ts, value FROM gauge_readings WHERE gauge_id = ? ORDER BY ts
`)

const MONTH_LABELS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * Collapse the readings into one value per clock hour.
 *
 * The Weser arrives every fifteen minutes, the two state gauges roughly once
 * an hour. Averaging both to the hour first is what makes their profiles
 * comparable at all — otherwise the Weser would contribute four times the
 * weight per hour for no reason other than its source being more generous.
 */
function hourlyBuckets(rows) {
  const byKey = new Map()

  for (const row of rows) {
    // The timestamps carry their offset, so the wall-clock hour is in the
    // string itself. Local time is the right frame here: whatever drives a
    // daily cycle — sunlight over the catchment, a weir on a shift plan —
    // follows the local day, not UTC.
    const key = row.ts.slice(0, 13)
    let bucket = byKey.get(key)
    if (!bucket) {
      const at = new Date(row.ts)
      bucket = {
        date: row.ts.slice(0, 10),
        hour: Number(row.ts.slice(11, 13)),
        // Absolute hour since the epoch: the window arithmetic has to work
        // across midnight, across months, and across the clock change.
        index: Math.floor(at.getTime() / 3_600_000),
        month: Number(row.ts.slice(5, 7)),
        // From the local calendar date, not from the instant: a reading at
        // half past midnight belongs to the day the clock on the wall shows,
        // and that is the day whose Sunday or Monday is being asked about.
        weekday: new Date(`${row.ts.slice(0, 10)}T00:00:00Z`).getUTCDay(),
        values: [],
      }
      byKey.set(key, bucket)
    }
    bucket.values.push(row.value)
  }

  const buckets = [...byKey.values()].sort((a, b) => a.index - b.index)
  for (const bucket of buckets) {
    bucket.count = bucket.values.length
    bucket.mean = mean(bucket.values)
  }
  return buckets
}

/**
 * Subtract the surrounding day from every hour.
 *
 * Returns null for an hour whose window is too thin — that is not a failure to
 * report but the point of the exercise, and the count of dropped hours is
 * carried out to the view.
 */
function detrend(buckets) {
  const out = []
  let lo = 0
  let hi = 0

  for (let i = 0; i < buckets.length; i++) {
    const centre = buckets[i].index
    while (lo < buckets.length && buckets[lo].index < centre - HALF_WINDOW) lo++
    while (hi < buckets.length && buckets[hi].index <= centre + HALF_WINDOW) hi++

    // One mean per hour of the clock, then the mean of those: a window that
    // happens to hold six readings from one hour and one from another must
    // not be pulled towards the busy hour.
    const byHour = new Map()
    for (let j = lo; j < hi; j++) {
      const b = buckets[j]
      if (!byHour.has(b.hour)) byHour.set(b.hour, [])
      byHour.get(b.hour).push(b.mean)
    }

    if (byHour.size < MIN_HOURS_IN_WINDOW) continue

    const baseline = mean([...byHour.values()].map(mean))
    out.push({ ...buckets[i], anomaly: buckets[i].mean - baseline })
  }

  return out
}

/** Average the deviations by hour of the clock. */
function profile(points) {
  const byHour = Array.from({ length: 24 }, () => ({ values: [], days: new Set() }))
  for (const p of points) {
    byHour[p.hour].values.push(p.anomaly)
    byHour[p.hour].days.add(p.date)
  }

  const hours = byHour.map((slot, hour) => ({
    hour,
    mean: slot.values.length > 0 ? mean(slot.values) : null,
    // Both numbers matter and they are not the same: twelve readings from one
    // day say much less than twelve from twelve days.
    readings: slot.values.length,
    days: slot.days.size,
  }))

  const known = hours.filter((h) => h.mean !== null)
  const days = new Set(points.map((p) => p.date))

  if (known.length === 0) {
    return { hours, days: 0, coveredHours: 0, amplitude: null, lowHour: null, highHour: null }
  }

  // A span needs two values. With a single measured hour the difference
  // between the highest and the lowest is zero by construction, and printing
  // that as "amplitude 0.00 cm" would state a measurement where there is only
  // arithmetic. How many hours are missing is said instead.
  if (known.length < 2) {
    return {
      hours,
      days: days.size,
      coveredHours: known.length,
      amplitude: null,
      lowHour: null,
      highHour: null,
    }
  }

  const low = known.reduce((a, b) => (b.mean < a.mean ? b : a))
  const high = known.reduce((a, b) => (b.mean > a.mean ? b : a))

  return {
    hours,
    days: days.size,
    coveredHours: known.length,
    // Still a floor, not a guarantee: an amplitude over four measured hours is
    // the span of those four. The view carries `coveredHours` next to it so
    // the reader can see over how much of the clock it was taken.
    amplitude: high.mean - low.mean,
    lowHour: low.hour,
    highHour: high.hour,
  }
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export function gaugeCycle(gaugeId) {
  const gauge = findGauge(gaugeId)
  if (!gauge) return null

  const rows = readings.all(gauge.id)
  const buckets = hourlyBuckets(rows)
  const points = detrend(buckets)

  const weekday = points.filter((p) => p.weekday >= 1 && p.weekday <= 5)
  const weekend = points.filter((p) => p.weekday === 0 || p.weekday === 6)

  const months = []
  for (let m = 1; m <= 12; m++) {
    const inMonth = points.filter((p) => p.month === m)
    if (inMonth.length === 0) continue
    months.push({ month: m, label: MONTH_LABELS[m - 1], ...profile(inMonth) })
  }

  return {
    gauge: { id: gauge.id, name: gauge.name, water: gauge.water, source: gauge.source },
    range: {
      first: rows.length > 0 ? rows[0].ts : null,
      last: rows.length > 0 ? rows[rows.length - 1].ts : null,
      readings: rows.length,
      hours: buckets.length,
      // The gap between these two is the cost of the window rule, and the
      // honest way to show what was thrown away.
      usableHours: points.length,
    },
    method: { halfWindow: HALF_WINDOW, minHoursInWindow: MIN_HOURS_IN_WINDOW },
    splits: [
      { key: 'all', label: 'Alle Tage', ...profile(points) },
      { key: 'weekday', label: 'Montag bis Freitag', ...profile(weekday) },
      { key: 'weekend', label: 'Samstag und Sonntag', ...profile(weekend) },
    ],
    months,
  }
}

export { GAUGES }
