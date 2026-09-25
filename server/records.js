import { db } from './db.js'
// Imported for its side effect: `germany.js` creates `germany_daily`, and the
// statements below are prepared against it the moment this module loads. Left
// implicit, that worked only because the server happened to import the other
// module first, and the module alone threw.
import './germany.js'
import { listDays } from './germany-csv.js'
import { readBaseline } from './records-csv.js'
import {
  DAYS_PER_YEAR,
  DEEPEST,
  deepestFor,
  insertTop,
  KIND_BY_KEY,
  LEVELS,
  rankAmong,
  RECORD_KINDS,
} from './records-kinds.js'

/**
 * All-time station records and the days they fell.
 *
 * The baseline in `data/germany/records-baseline.csv` holds each station's
 * extreme as it stood at the archive's first day. Everything after that is
 * replayed here from `germany_daily`, in date order, so a value only counts as
 * a record if it beat what stood *before* it. The replay is what makes the
 * page useful on day one: it produces the record events for the whole archived
 * period rather than only for days observed from now on.
 *
 * A record is only ever compared against the same station's own history. A
 * station that has measured for nineteen years breaks its record far more
 * easily than one measuring since 1881, so every event carries the length of
 * the series it belongs to and the date of the record it displaced — without
 * those two numbers the reader cannot tell a footnote from an event.
 *
 * Since the baseline goes ten deep, the same replay also answers the smaller
 * question: not "did this beat everything" but "did this make the top ten".
 * Those are far more common than records and say something a record cannot —
 * a summer that produces four fourth-places at one station is a different
 * statement from one that produces none, and neither shows up in a list of
 * broken records.
 *
 * How deep a station may be read is decided by `deepestFor`, because a top ten
 * of 730 days and a top ten of 44,000 are not the same achievement.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS record_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

/*
 * The table gained `rank`, `best` and `best_date` when the view learned to ask
 * for near misses. Everything in it is derived from the baseline and the daily
 * archive, so an old copy is thrown away rather than migrated — the rebuild
 * costs seconds and a migration that invented a rank for rows written before
 * ranks existed would be worse than no rows at all.
 *
 * The signature goes with it. Left behind, it would tell the replay the empty
 * table is current.
 */
const EVENT_COLUMNS = [
  'date', 'station_id', 'kind', 'rank', 'value',
  'previous', 'previous_date', 'best', 'best_date', 'since', 'days',
]

const existing = db.prepare('PRAGMA table_info(record_events)').all().map((c) => c.name)
if (existing.length > 0 && !EVENT_COLUMNS.every((c) => existing.includes(c))) {
  db.exec('DROP TABLE record_events')
  db.prepare("DELETE FROM record_state WHERE key = 'signature'").run()
}

db.exec(`
  CREATE TABLE IF NOT EXISTS record_events (
    date          TEXT NOT NULL,
    station_id    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    -- The place the value took that day: 1 is a record, 4 is a fourth place.
    rank          INTEGER NOT NULL,
    value         REAL NOT NULL,
    -- What stood at that place before, and the station's own best at the time.
    -- For a record the two coincide, which is what makes the old view read
    -- exactly as it did.
    previous      REAL NOT NULL,
    previous_date TEXT NOT NULL,
    best          REAL NOT NULL,
    best_date     TEXT NOT NULL,
    since         TEXT NOT NULL,
    days          INTEGER NOT NULL,
    PRIMARY KEY (date, station_id, kind)
  );
  -- Every read filters by place and then orders by date, so the index carries
  -- both: without the rank in it, asking for records means scanning the near
  -- misses as well, and those are the bulk of the table.
  CREATE INDEX IF NOT EXISTS idx_record_events_rank ON record_events (rank, date DESC);
`)

const readState = db.prepare('SELECT value FROM record_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO record_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

const insertEvent = db.prepare(`
  INSERT INTO record_events (${EVENT_COLUMNS.join(', ')})
  VALUES (${EVENT_COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT (date, station_id, kind) DO NOTHING
`)
const insertEvents = db.transaction((rows) => {
  for (const row of rows) insertEvent.run(row)
})

/* -------------------------------------------------------------------------- */
/* Replay                                                                     */
/* -------------------------------------------------------------------------- */

const dailyStmt = db.prepare(`
  SELECT date, station_id, ${[...new Set(RECORD_KINDS.map((k) => k.field))].join(', ')}
  FROM germany_daily
  WHERE date >= ?
  ORDER BY date
`)

/**
 * Rebuild the event table from the baseline plus the daily archive.
 *
 * Guarded by a signature so a restart that changed nothing costs one query
 * instead of a million-row scan.
 */
export function buildEvents({ force = false } = {}) {
  const { cutoff, rows } = readBaseline()
  if (!cutoff || rows.length === 0) return { events: 0, stations: 0, skipped: 'keine Basislinie' }

  const days = listDays()
  const signature = [cutoff, rows.length, days.length, days.at(-1) ?? ''].join('|')
  if (!force && readState.get('signature')?.value === signature) {
    return { events: count(), cached: true }
  }

  /*
   * `current` carries the running top list per station and kind; it starts at
   * the baseline and moves forward as the replay walks the archive.
   *
   * The baseline arrives as one row per place, so the lists are assembled by
   * place. They come out of the file in that order, but the sort here does not
   * trust that — a file edited by hand should produce the same answer as one
   * written by the collector.
   */
  const current = new Map()
  for (const r of rows) {
    const key = `${r.station}\0${r.kind}`
    let held = current.get(key)
    if (!held) {
      held = { list: [], since: r.since, days: r.days }
      current.set(key, held)
    }
    held.list.push({ value: r.value, date: r.date, rank: r.rank })
  }
  for (const held of current.values()) {
    held.list.sort((a, b) => a.rank - b.rank)
    for (const entry of held.list) delete entry.rank
  }

  const events = []
  for (const row of dailyStmt.all(cutoff)) {
    for (const kind of RECORD_KINDS) {
      const value = row[kind.field]
      if (value === null || value === undefined) continue

      const key = `${row.station_id}\0${kind.key}`
      const held = current.get(key)
      // No baseline means no history to reach into — a station that started
      // measuring after the cutoff sets no all-time record, it starts a series.
      if (!held) continue

      held.days++

      /*
       * Two limits, and the tighter one wins. `DEEPEST` is how far the
       * baseline reaches at all; `deepestFor` is how far this station's own
       * series may honestly be read. A twelve-year series stops at third
       * place — its fourth place exists, but calling it one would put it
       * beside the fourth place of a station measuring since 1881.
       */
      const allowed = Math.min(DEEPEST, deepestFor(held.days / DAYS_PER_YEAR))
      const rank = rankAmong(kind, value, held.list)

      if (rank <= allowed) {
        // What stood at this place before, and what stands at the top. For a
        // record the two are the same row, which is why the existing view
        // reads exactly as it did.
        const displaced = held.list[rank - 1] ?? held.list.at(-1)
        const best = held.list[0]
        events.push({
          date: row.date,
          station_id: row.station_id,
          kind: kind.key,
          rank,
          value,
          previous: displaced?.value ?? value,
          previous_date: displaced?.date ?? row.date,
          best: rank === 1 ? value : (best?.value ?? value),
          best_date: rank === 1 ? row.date : (best?.date ?? row.date),
          since: held.since,
          days: held.days,
        })
      }

      // Inserted whether or not it was worth an event: a value that missed the
      // list changes nothing, and one that made it has to be there for the
      // next day to be ranked against.
      insertTop(kind, held.list, { value, date: row.date })
    }
  }

  db.exec('DELETE FROM record_events')
  insertEvents(events)
  writeState.run('signature', signature)
  writeState.run('cutoff', cutoff)

  return {
    events: events.length,
    records: events.filter((e) => e.rank === 1).length,
    stations: new Set(events.map((e) => e.station_id)).size,
  }
}

const countStmt = db.prepare('SELECT COUNT(*) AS n FROM record_events')
const count = () => countStmt.get()?.n ?? 0

const built = buildEvents()
if (built.events > 0 && !built.cached) {
  console.log(
    `Allzeitrekorde: ${built.records.toLocaleString('de-DE')} Rekorde,` +
      ` ${built.events.toLocaleString('de-DE')} Platzierungen bis Platz ${DEEPEST}` +
      ` an ${built.stations.toLocaleString('de-DE')} Stationen`,
  )
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Every read below takes a place and keeps everything at or above it: asking
 * for the top five means places one to five, not place five alone. One is what
 * the page has always shown, and stays the default everywhere, so nothing that
 * asks without a place notices that the table grew.
 */
export { LEVELS }

/** Clamp a requested place to one of the offered levels. */
export function level(value) {
  const asked = Number(value)
  return LEVELS.includes(asked) ? asked : 1
}

/**
 * Two orders, because the list answers two questions.
 *
 * By place: what happened first, records above near misses. That is what the
 * heading promises and the order the page opens in.
 *
 * By series: what weighs most, longest history first whatever place it took —
 * a third place in Hohenpeißenberg's 240 years is a larger thing than a first
 * at a station that opened in 2004. On a busy day the difference is real: 27
 * June 2026 holds 886 placements, 405 of them records, so ordering by place
 * puts four hundred rows ahead of every near miss.
 *
 * The other key is always the tiebreak, so neither order throws away what the
 * other one sorts by, and the station id closes it so the same day always
 * comes back in the same sequence.
 */
const ORDERS = {
  platz: 'e.rank, e.days DESC, e.station_id',
  reihe: 'e.days DESC, e.rank, e.station_id',
}

export const SORTS = Object.keys(ORDERS)

/** Clamp a requested order to one that exists. */
export function sortOrder(value) {
  const asked = String(value ?? '')
  return Object.hasOwn(ORDERS, asked) ? asked : 'platz'
}

// One statement per order rather than one with a `CASE`: the order is a
// literal from the table above, never a request parameter, and SQLite plans a
// fixed ORDER BY better than a computed one.
const eventsForDateStmt = Object.fromEntries(
  Object.entries(ORDERS).map(([key, order]) => [
    key,
    db.prepare(`
      SELECT e.*, s.name, s.state, s.elevation, s.lat, s.lon
      FROM record_events e
      JOIN germany_stations s ON s.id = e.station_id
      WHERE e.date = ? AND e.rank <= ?
      ORDER BY ${order}
    `),
  ]),
)

const daysWithEventsStmt = db.prepare(`
  SELECT date, COUNT(*) AS n, MIN(rank) AS best FROM record_events
  WHERE rank <= ?
  GROUP BY date ORDER BY date DESC LIMIT ?
`)

const countForDateStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM record_events WHERE date = ? AND rank <= ?',
)

const rangeStmt = db.prepare(`
  SELECT COUNT(*) AS events, COUNT(DISTINCT station_id) AS stations,
         MIN(date) AS first, MAX(date) AS last
  FROM record_events
  WHERE rank <= ?
`)

/** How many records fell on a day — used for the hint on the Germany page. */
export function recordCount(date, top = 1) {
  return countForDateStmt.get(date, top)?.n ?? 0
}

export function recordRange(top = 1) {
  const r = rangeStmt.get(top)
  const cutoff = readState.get('cutoff')?.value ?? null
  return {
    events: r?.events ?? 0,
    stations: r?.stations ?? 0,
    first: r?.first ?? null,
    last: r?.last ?? null,
    cutoff,
    top,
    deepest: DEEPEST,
  }
}

/**
 * Days that saw at least one entry at or above `top`, newest first.
 *
 * `best` is the highest place reached that day, so the picker can mark the
 * days that hold an actual record among the ones that only hold near misses.
 */
export function recordDays(limit = 400, top = 1) {
  return daysWithEventsStmt.all(top, limit).map((r) => ({
    date: r.date,
    count: r.n,
    best: r.best,
  }))
}

export function recordsForDate(date, top = 1, sort = 'platz') {
  return eventsForDateStmt[sortOrder(sort)].all(date, top).map((e) => {
    const kind = KIND_BY_KEY.get(e.kind)
    return {
      station_id: e.station_id,
      name: e.name,
      state: e.state,
      elevation: e.elevation,
      lat: e.lat,
      lon: e.lon,
      kind: e.kind,
      label: kind?.label ?? e.kind,
      unit: kind?.unit ?? '',
      decimals: kind?.decimals ?? 1,
      direction: kind?.direction ?? 'max',
      rank: e.rank,
      value: e.value,
      previous: e.previous,
      previousDate: e.previous_date,
      /*
       * Whether the place was taken or shared.
       *
       * The DWD publishes one decimal, so a day equalling a record is not
       * rare, and under the tie rule it has reached that place — but it has
       * not displaced anything. "Rekord eingestellt" and "Rekord gebrochen"
       * are different sentences, and a view that prints the second for both
       * overstates 79 of its 974 first places.
       */
      shared: Math.abs(e.value - e.previous) < 1e-9,
      best: e.best,
      bestDate: e.best_date,
      since: e.since,
      days: e.days,
      years: e.days / DAYS_PER_YEAR,
      /** How deep this series may honestly be read — see `deepestFor`. */
      deepest: deepestFor(e.days / DAYS_PER_YEAR),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* How far a record day reached                                               */
/* -------------------------------------------------------------------------- */

/**
 * A degree of latitude, in kilometres.
 *
 * Equirectangular, with the longitude axis shrunk by cos(latitude) — the same
 * approximation the map uses. Over 800 km of Germany it is off by well under a
 * percent, and the numbers here are read as "a few hundred kilometres", not to
 * the kilometre.
 */
const KM_PER_DEGREE = 111.2

/**
 * Whether a record day was one thunderstorm or a front across half the country.
 *
 * The list alone cannot say: 526 records could be one afternoon over Bavaria or
 * a heatwave from Flensburg to Passau, and both read the same in a column of
 * station names. Extent and the number of federal states answer it in two
 * numbers, and the widest pair of stations names the day's reach.
 */
export function recordSpread(events) {
  const located = events.filter((e) => e.lat !== null && e.lon !== null)
  if (located.length === 0) return null

  const lats = located.map((e) => e.lat)
  const lons = located.map((e) => e.lon)
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180)
  const stretch = Math.cos(midLat)

  const northSouth = (Math.max(...lats) - Math.min(...lats)) * KM_PER_DEGREE
  const westEast = (Math.max(...lons) - Math.min(...lons)) * KM_PER_DEGREE * stretch

  // The widest pair, brute force. At most a few hundred stations carry records
  // on one day, so this is tens of thousands of comparisons — cheaper than any
  // structure that would avoid them.
  let widest = null
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i]
      const b = located[j]
      const dx = (a.lon - b.lon) * KM_PER_DEGREE * stretch
      const dy = (a.lat - b.lat) * KM_PER_DEGREE
      const km = Math.sqrt(dx * dx + dy * dy)
      if (!widest || km > widest.km) widest = { km, from: a.name, to: b.name }
    }
  }

  return {
    located: located.length,
    states: new Set(located.map((e) => e.state)).size,
    stations: new Set(located.map((e) => e.station_id)).size,
    northSouth,
    westEast,
    widest,
  }
}

export { RECORD_KINDS }
