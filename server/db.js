import { join } from 'node:path'
import Database from 'better-sqlite3'

import { dataDir } from './paths.js'

export const db = new Database(join(dataDir(null, process.env.DATA_DIR), 'weather.sqlite'))

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

/**
 * Columns added after the table already existed.
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so each is attempted and a
 * "duplicate column" error is the expected outcome on every run but the first.
 * Any other failure is real and must not be swallowed.
 */
for (const column of [
  'sunshine REAL',
  'cloud REAL',
  'humidity REAL',
  'vapour_pressure REAL',
  'snow REAL',
  'temp_ground_min REAL',
]) {
  try {
    db.exec(`ALTER TABLE daily ADD COLUMN ${column}`)
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message))) throw error
  }
}
