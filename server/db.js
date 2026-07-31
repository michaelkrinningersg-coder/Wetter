import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data')

mkdirSync(dataDir, { recursive: true })

export const db = new Database(join(dataDir, 'weather.sqlite'))

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS daily (
    station_id    TEXT    NOT NULL,
    date          TEXT    NOT NULL,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    day           INTEGER NOT NULL,
    temp_mean     REAL,
    temp_max      REAL,
    temp_min      REAL,
    precipitation REAL,
    wind_max      REAL,
    wind_mean     REAL,
    pressure      REAL,
    PRIMARY KEY (station_id, date)
  );

  -- Every aggregation filters by station and groups by year or year+month.
  CREATE INDEX IF NOT EXISTS idx_daily_station_year
    ON daily (station_id, year);
  CREATE INDEX IF NOT EXISTS idx_daily_station_year_month
    ON daily (station_id, year, month);
  CREATE INDEX IF NOT EXISTS idx_daily_station_month_day
    ON daily (station_id, month, day);
`)

/** Per-station import state, kept in memory (reset on restart, like the original). */
const importState = new Map()

export function getImportState(stationId) {
  return (
    importState.get(stationId) ?? { importInProgress: false, lastError: null }
  )
}

export function setImportState(stationId, patch) {
  importState.set(stationId, { ...getImportState(stationId), ...patch })
}

/** True while any import for this station is running — used to reject overlap. */
export function isImporting(stationId) {
  return getImportState(stationId).importInProgress === true
}
