import { db } from './db.js'

/**
 * How far a table reaches, and nothing else.
 *
 * Two callers need this and both used to get it the expensive way. The system
 * bar asked "is the air quality up to date?" by building the entire air-quality
 * overview — 438 ms of percentiles and daily means — and then reading one date
 * out of it. The same for the German archive: 319 ms of `archiveRange()` for a
 * single `MAX`. Together that was 757 ms every sixty seconds, for two strings.
 *
 * The statements below answer the same question in eleven milliseconds, and
 * the memo keys in the analyses lean on them too: an answer may be reused for
 * exactly as long as the rows behind it have not moved, so the check has to be
 * cheaper than the work it saves, or it saves nothing.
 *
 * The table and column names are interpolated into SQL. They are literals
 * written in this repository — never a request parameter — and must stay that
 * way.
 */
const statements = new Map()

function statement(table, column) {
  const key = `${table}.${column}`
  // Prepared on first use, not at import: `db.prepare` fails on a table that
  // the owning module has not created yet, and the import order between the
  // archives is not fixed.
  if (!statements.has(key)) {
    statements.set(key, db.prepare(`SELECT MAX(${column}) AS last FROM ${table}`))
  }
  return statements.get(key)
}

/** The largest value in a column, or null for an empty table. */
export function lastValue(table, column = 'date') {
  return statement(table, column).get().last ?? null
}

/** The same, cut back to a calendar date — for columns holding a timestamp. */
export function lastDay(table, column = 'date') {
  return lastValue(table, column)?.slice(0, 10) ?? null
}

/**
 * What a whole table currently holds, as one short string.
 *
 * The last date alone is not enough, and a test caught it: an archive can grow
 * without its newest day moving. `fetch-germany.js --backfill` does exactly
 * that — it walks the DWD's rolling window and fills in the days behind the
 * newest one, so a hundred days can arrive under an unchanged `MAX(date)`.
 * Anything remembered against that stamp would stay wrong until tomorrow.
 *
 * The row count closes it. On the largest table in the app, 1.28 million rows,
 * `COUNT(*)` measures 17 ms — against the four and a half seconds it guards.
 */
export function tableStamp(table, column = 'date') {
  return `${lastValue(table, column)}|${countStatement(table).get().rows}`
}

function countStatement(table) {
  const key = `${table}.*`
  if (!statements.has(key)) statements.set(key, db.prepare(`SELECT COUNT(*) AS rows FROM ${table}`))
  return statements.get(key)
}

/**
 * The same for one station's own series.
 *
 * The primary key of `daily` starts with the station, so both halves are an
 * index range and no table scan. A station re-import rewrites its whole
 * history, so this has the backfill problem too.
 */
let stationStmt = null

export function stationStamp(stationId) {
  stationStmt ??= db.prepare(
    'SELECT MAX(date) AS last, COUNT(*) AS rows FROM daily WHERE station_id = ?',
  )
  const row = stationStmt.get(stationId)
  return `${row?.last ?? ''}|${row?.rows ?? 0}`
}
