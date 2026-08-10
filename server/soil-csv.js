import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dataDir } from './paths.js'
import { DERIVED_FIELDS, TEMPERATURE_DEPTHS } from './soil-sources.js'

/**
 * Flat-file archive of the soil series.
 *
 *   data/soil/moisture.csv      one row per day, modelled moisture and evaporation
 *   data/soil/temperature.csv   one row per day, measured soil temperature
 *
 * Two files rather than one, because the two series start eleven years apart
 * and a single table would carry a decade of half-empty rows.
 *
 * Rewritten whole on each collection rather than appended to, which is the
 * opposite of what the gauges do — and for the opposite reason. A gauge reading
 * exists only because something asked for it, so losing it loses it forever.
 * These files are downloadable from the DWD in full at any time, and the
 * service revises past days as its models improve; the archive is therefore a
 * cache of something durable, not the only copy of something fleeting.
 */

export const SOIL_DATA_DIR = dataDir('soil', process.env.SOIL_DATA_DIR)

const MOISTURE_COLUMNS = DERIVED_FIELDS.map((f) => f.key)
const TEMPERATURE_COLUMNS = TEMPERATURE_DEPTHS.map((d) => d.key)

const FILES = {
  moisture: { name: 'moisture.csv', columns: MOISTURE_COLUMNS },
  temperature: { name: 'temperature.csv', columns: TEMPERATURE_COLUMNS },
}

export const soilPath = (kind, dir = SOIL_DATA_DIR) => join(dir, FILES[kind].name)

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export function readSoil(kind, dir = SOIL_DATA_DIR) {
  const file = soilPath(kind, dir)
  if (!existsSync(file)) return []

  const lines = readFileSync(file, 'utf8').trim().split('\n')
  if (lines.length < 2) return []

  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    header.forEach((name, i) => {
      if (name === 'date') {
        row.date = cells[i]
        return
      }
      // An empty cell is a missing measurement, and null is what the database
      // and every analysis downstream expect for that — not zero.
      row[name] = cells[i] === '' || cells[i] === undefined ? null : Number(cells[i])
    })
    return row
  })
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Merge new rows over the existing archive and write it back, sorted by date.
 *
 * A revised day replaces its predecessor rather than appearing twice — the DWD
 * does correct the past, and two rows for one day would be an error the reader
 * of the file could not resolve.
 */
export function writeSoil(kind, rows, dir = SOIL_DATA_DIR) {
  const { columns } = FILES[kind]
  const byDate = new Map(readSoil(kind, dir).map((row) => [row.date, row]))
  let changed = 0

  for (const row of rows) {
    const before = byDate.get(row.date)
    const merged = { date: row.date }
    for (const column of columns) merged[column] = row[column] ?? null
    if (!before || columns.some((c) => before[c] !== merged[c])) changed++
    byDate.set(row.date, merged)
  }

  const dates = [...byDate.keys()].sort()
  const body = dates.map((date) => {
    const row = byDate.get(date)
    return [date, ...columns.map((c) => (row[c] === null ? '' : row[c]))].join(',')
  })

  mkdirSync(dir, { recursive: true })
  writeFileSync(soilPath(kind, dir), [['date', ...columns].join(','), ...body].join('\n') + '\n')

  return { rows: dates.length, changed }
}

/** The days the archive holds, for the catch-up decision. */
export function soilRange(kind, dir = SOIL_DATA_DIR) {
  const rows = readSoil(kind, dir)
  if (rows.length === 0) return { first: null, last: null, days: 0 }
  return { first: rows[0].date, last: rows[rows.length - 1].date, days: rows.length }
}
