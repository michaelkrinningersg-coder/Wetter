/**
 * The record categories, shared by the collector and the server.
 *
 * Kept in its own module so `scripts/fetch-records.js` can import it without
 * pulling in the database, which is what lets that collector run as its own
 * process.
 */
export const RECORD_KINDS = [
  {
    key: 'temp_max',
    field: 'temp_max',
    direction: 'max',
    label: 'Höchsttemperatur',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_min',
    field: 'temp_min',
    direction: 'min',
    label: 'Tiefsttemperatur',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_mean_high',
    field: 'temp_mean',
    direction: 'max',
    label: 'Wärmstes Tagesmittel',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_mean_low',
    field: 'temp_mean',
    direction: 'min',
    label: 'Kältestes Tagesmittel',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'precipitation',
    field: 'precipitation',
    direction: 'max',
    label: 'Tagesniederschlag',
    unit: 'mm',
    decimals: 1,
  },
  {
    key: 'wind_max',
    field: 'wind_max',
    direction: 'max',
    label: 'Windböe',
    unit: 'm/s',
    decimals: 1,
  },
]

export const KIND_BY_KEY = new Map(RECORD_KINDS.map((k) => [k.key, k]))

/* -------------------------------------------------------------------------- */
/* Near misses                                                                */
/* -------------------------------------------------------------------------- */

/** How deep the baseline reaches, and the widest view the app offers. */
export const DEEPEST = 10

/** The levels the view can be switched to, in the order it shows them. */
export const LEVELS = [1, 3, 5, 10]

/**
 * How deep a series may be read, by how long it has measured.
 *
 * A place in the top ten is not one thing. A station that has measured for two
 * years has 730 days, so its top ten is the warmest 1.4 % of everything it has
 * ever seen — an ordinary summer week clears it. A station with 120 years has
 * 44,000 days, and its top ten is the warmest 0.02 %: a list that takes a
 * lifetime to get onto.
 *
 * Putting both in one column headed "Top 10" would invite a comparison that
 * the numbers do not support. So each series is only read as deep as its own
 * length justifies, and a short one simply does not appear at the deeper
 * levels rather than appearing there cheaply.
 */
export function deepestFor(years) {
  if (!Number.isFinite(years)) return 1
  if (years >= 50) return 10
  if (years >= 20) return 5
  if (years >= 10) return 3
  return 1
}

/** A year, in days. Series lengths are counted in measured days. */
export const DAYS_PER_YEAR = 365.25

/**
 * The rank a value takes among `sorted`, counting from the best.
 *
 * Ties share the better place: four days at 21.4 °C are all third if two days
 * were warmer, and none of them is fourth. A day that reaches third place
 * reached third place, whoever else did — the alternative is to let the
 * calendar decide which of two identical measurements counts, which is not a
 * property of the weather.
 *
 * `sorted` is the running top list as `insertTop` keeps it: entries with a
 * `value`, best first. A value that does not reach the list at all comes back
 * as `sorted.length + 1`, which the caller compares against its own limit.
 */
export function rankAmong(kind, value, sorted) {
  let better = 0
  for (const held of sorted) {
    if (beats(kind, held.value, value)) better++
    else break
  }
  return better + 1
}

/** True when `value` beats `record` in the kind's direction. */
export function beats(kind, value, record) {
  return kind.direction === 'max' ? value > record : value < record
}

/**
 * Put `entry` into a running top list, keeping it best-first and at most
 * `DEEPEST` long.
 *
 * Shared by the collector and the replay on purpose. The collector reduces a
 * century of history to ten values and the replay carries those ten forward
 * day by day; if the two disagreed about what "tenth best" means, the boundary
 * between them — the day the daily archive begins — would be a seam in the
 * data that nothing else in the app could explain.
 */
export function insertTop(kind, sorted, entry) {
  let at = 0
  while (at < sorted.length && !beats(kind, entry.value, sorted[at].value)) at++
  sorted.splice(at, 0, entry)
  if (sorted.length > DEEPEST) sorted.length = DEEPEST
  return sorted
}
