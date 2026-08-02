import { db } from './db.js'
import {
  HOME_PARTREGION,
  HORIZONS,
  KIND_BY_KEY,
  LEVEL_BY_VALUE,
  POLLEN_KINDS,
  POLLEN_LEVELS,
  REGION_NAME,
} from './pollen-sources.js'
import { listDays, readDay } from './pollen-csv.js'

/**
 * The pollen forecast, as a queryable archive.
 *
 * Two things this can say that the DWD's own file cannot, both of which need
 * time to accumulate. The first is a season: when hazel starts, when grasses
 * peak, when mugwort takes over — a calendar built from what was actually
 * forecast, day after day. The second is the forecast's own record: every issue
 * carries today and the next two days, so once enough issues overlap, what was
 * said two days ahead can be held against what was said on the day.
 *
 * Severities are ranks, not measurements. "1-2" sits between "1" and "2" as a
 * category of its own, and nothing here averages them — the archive counts days
 * per level instead.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS pollen_forecast (
    issued     TEXT    NOT NULL,   -- the DWD's own publication date
    partregion INTEGER NOT NULL,
    pollen     TEXT    NOT NULL,
    today      TEXT    NOT NULL,
    tomorrow   TEXT    NOT NULL,
    dayafter   TEXT    NOT NULL,
    PRIMARY KEY (issued, partregion, pollen)
  );

  CREATE TABLE IF NOT EXISTS pollen_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const readState = db.prepare('SELECT value FROM pollen_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO pollen_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

const insert = db.prepare(`
  INSERT INTO pollen_forecast (issued, partregion, pollen, today, tomorrow, dayafter)
  VALUES (@issued, @partregion, @pollen, @today, @tomorrow, @dayafter)
  ON CONFLICT (issued, partregion, pollen) DO UPDATE SET
    today = excluded.today, tomorrow = excluded.tomorrow, dayafter = excluded.dayafter
`)
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row)
})

export function importPollen({ force = false } = {}) {
  const days = listDays()
  if (days.length === 0) return { rows: 0 }

  const signature = `${days.length}|${days[0]}|${days.at(-1)}`
  if (!force && readState.get('signature')?.value === signature) {
    return { rows: 0, cached: true }
  }

  const batch = []
  for (const date of days) batch.push(...readDay(date))
  if (batch.length > 0) insertMany(batch)

  writeState.run('signature', signature)
  return { rows: batch.length, days: days.length }
}

const loaded = importPollen()
if (loaded.rows > 0) {
  console.log(`Pollenflug geladen: ${loaded.rows} Zeilen aus ${loaded.days} Ausgaben`)
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const levelOf = (value) => LEVEL_BY_VALUE.get(value)?.level ?? null

/** Shift an ISO date by whole days, without touching local time zones. */
function addDays(date, days) {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Latest issue                                                               */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(
  'SELECT MIN(issued) AS first, MAX(issued) AS last, COUNT(DISTINCT issued) AS issues FROM pollen_forecast',
)

export function pollenRange() {
  const row = rangeStmt.get()
  return { first: row?.first ?? null, last: row?.last ?? null, issues: row?.issues ?? 0 }
}

const partregionsStmt = db.prepare(
  'SELECT DISTINCT partregion FROM pollen_forecast ORDER BY partregion',
)

/**
 * The newest issue, laid out as region → kind → the three horizons.
 *
 * The horizon dates are computed from the issue date rather than taken from the
 * source, which names them only "today", "tomorrow" and "dayafter_to".
 */
export function pollenLatest() {
  const { last } = pollenRange()
  if (!last) return null

  const rows = db
    .prepare('SELECT * FROM pollen_forecast WHERE issued = ? ORDER BY partregion, pollen')
    .all(last)

  const byRegion = new Map()
  for (const row of rows) {
    if (!byRegion.has(row.partregion)) byRegion.set(row.partregion, [])
    byRegion.get(row.partregion).push({
      pollen: row.pollen,
      label: KIND_BY_KEY.get(row.pollen)?.label ?? row.pollen,
      order: KIND_BY_KEY.get(row.pollen)?.order ?? 99,
      horizons: HORIZONS.map((h) => ({
        key: h.key,
        label: h.label,
        date: addDays(last, h.offset),
        value: row[h.key],
        level: levelOf(row[h.key]),
      })),
    })
  }

  return {
    issued: last,
    regions: [...byRegion.entries()]
      .map(([partregion, kinds]) => ({
        partregion,
        home: partregion === HOME_PARTREGION,
        kinds: kinds.sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.partregion - b.partregion),
  }
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What was forecast for each day, per kind — the season as it accumulates.
 *
 * Uses the `today` column only: that is the statement made about a day on the
 * day itself, which is the closest the archive gets to an observation.
 */
export function pollenCalendar(partregion = HOME_PARTREGION) {
  const rows = db
    .prepare(
      'SELECT issued, pollen, today FROM pollen_forecast WHERE partregion = ? ORDER BY issued',
    )
    .all(partregion)

  const byKind = new Map()
  for (const row of rows) {
    if (!byKind.has(row.pollen)) byKind.set(row.pollen, [])
    byKind.get(row.pollen).push({
      date: row.issued,
      value: row.today,
      level: levelOf(row.today),
    })
  }

  return POLLEN_KINDS.filter((kind) => byKind.has(kind.key)).map((kind) => {
    const points = byKind.get(kind.key)
    const active = points.filter((p) => (p.level ?? 0) > 0)
    return {
      pollen: kind.key,
      label: kind.label,
      points,
      /** Days with any burden at all — the season's footprint so far. */
      activeDays: active.length,
      peak: points.reduce(
        (best, p) => ((p.level ?? -1) > (best?.level ?? -1) ? p : best),
        null,
      ),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* How well the forecast held                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What was said two days ahead against what was said on the day.
 *
 * Not computed until the archive holds ten issues. Below that every pairing is
 * a coincidence and a percentage would be theatre — the view says how many are
 * still missing instead.
 */
const MIN_ISSUES_FOR_ACCURACY = 10

export function pollenAccuracy(partregion = HOME_PARTREGION) {
  const { issues } = pollenRange()
  if (issues < MIN_ISSUES_FOR_ACCURACY) {
    return { ready: false, issues, needed: MIN_ISSUES_FOR_ACCURACY, horizons: [] }
  }

  const rows = db
    .prepare('SELECT issued, pollen, today, tomorrow, dayafter FROM pollen_forecast WHERE partregion = ?')
    .all(partregion)

  // Keyed by the day a statement is *about*, so a forecast can be looked up
  // next to the eventual same-day statement for that date.
  const actual = new Map()
  for (const row of rows) actual.set(`${row.issued}|${row.pollen}`, row.today)

  const out = []
  for (const [offset, column] of [
    [1, 'tomorrow'],
    [2, 'dayafter'],
  ]) {
    let hits = 0
    let close = 0
    let total = 0

    for (const row of rows) {
      const target = addDays(row.issued, offset)
      const observed = actual.get(`${target}|${row.pollen}`)
      if (observed === undefined) continue

      const predicted = row[column]
      const a = levelOf(predicted)
      const b = levelOf(observed)
      if (a === null || b === null) continue

      total++
      if (a === b) hits++
      if (Math.abs(a - b) <= 1) close++
    }

    out.push({
      offset,
      label: offset === 1 ? 'einen Tag im Voraus' : 'zwei Tage im Voraus',
      compared: total,
      exact: total > 0 ? hits / total : null,
      within: total > 0 ? close / total : null,
    })
  }

  return { ready: true, issues, needed: MIN_ISSUES_FOR_ACCURACY, horizons: out }
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function pollenOverview() {
  const range = pollenRange()
  const regions = partregionsStmt.all().map((r) => r.partregion)

  return {
    region: REGION_NAME,
    homePartregion: HOME_PARTREGION,
    partregions: regions,
    kinds: POLLEN_KINDS,
    levels: POLLEN_LEVELS,
    range,
    latest: pollenLatest(),
    calendar: pollenCalendar(),
    accuracy: pollenAccuracy(),
    /**
     * Said once in the payload rather than repeated under every chart: this
     * archive begins where the collector began.
     */
    windowNote:
      'Der DWD hält nur die aktuelle Ausgabe vor — sie wird jeden Vormittag' +
      ' ersetzt. Alles Ältere steht hier, weil es täglich mitgeschrieben wurde.',
    regionNote:
      'Der DWD teilt Niedersachsen in einen westlichen und einen östlichen Teil,' +
      ' ohne die Grenze in den Daten zu benennen. Göttingen liegt im Südosten,' +
      ' also im östlichen Teil; mitgeschrieben werden beide, damit die Zuordnung' +
      ' umkehrbar bleibt.',
  }
}
