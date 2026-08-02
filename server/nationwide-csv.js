import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Flat-file archive of the daily nationwide shape.
 *
 *   data/nationwide/1936.csv     one file per year, one row per day
 *
 * This archive is written **once**. Everything in it predates the first day of
 * the daily station archive, and the days after that are recomputed from the
 * archive the repository already carries — so the historical download happens
 * on one afternoon in 2026 and never again.
 *
 * One file per year rather than per day, which is the opposite of every other
 * archive here, and for the opposite reason: those grow by one day at a time and
 * a rewritten month file would cost thirty copies in git. This one never grows.
 * 146 files of 365 lines are easier to read and to diff than 53,000 files of one.
 *
 * Every value is rounded on the way in. The shape of a day is not known to eight
 * decimals, and unrounded floats would make the archive twice its size for
 * digits that are noise.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const NATIONWIDE_DATA_DIR =
  process.env.NATIONWIDE_DATA_DIR ?? join(here, '..', 'data', 'nationwide')

/** Column, and how many decimals it survives with. Order defines the file. */
export const COLUMNS = [
  { key: 'date', digits: null },
  { key: 'stations', digits: 0 },
  { key: 'meanHiStation', digits: null },
  { key: 'meanHi', digits: 1 },
  { key: 'meanLoStation', digits: null },
  { key: 'meanLo', digits: 1 },
  { key: 'absHiStation', digits: null },
  { key: 'absHi', digits: 1 },
  { key: 'absLoStation', digits: null },
  { key: 'absLo', digits: 1 },
  { key: 'lowHiStation', digits: null },
  { key: 'lowHi', digits: 1 },
  { key: 'lowLoStation', digits: null },
  { key: 'lowLo', digits: 1 },
  { key: 'lowAbsHiStation', digits: null },
  { key: 'lowAbsHi', digits: 1 },
  { key: 'lowAbsLoStation', digits: null },
  { key: 'lowAbsLo', digits: 1 },
  { key: 'wetStation', digits: null },
  { key: 'wet', digits: 1 },
  { key: 'gustStation', digits: null },
  { key: 'gust', digits: 1 },
  { key: 'lapse', digits: 3 },
  { key: 'lapseR2', digits: 3 },
  { key: 'gradN', digits: 3 },
  { key: 'gradE', digits: 3 },
  { key: 'gradH', digits: 3 },
  { key: 'gradR2', digits: 3 },
]

export const HEADER = COLUMNS.map((c) => c.key).join(',')

const NUMERIC = new Set(COLUMNS.filter((c) => c.digits !== null).map((c) => c.key))

export const yearPath = (year, dir = NATIONWIDE_DATA_DIR) => join(dir, `${year}.csv`)

export function formatRow(row) {
  return COLUMNS.map(({ key, digits }) => {
    const value = row[key]
    if (value === undefined || value === null) return ''
    if (digits === null) return value
    return Number(value.toFixed(digits))
  }).join(',')
}

export function writeYear(year, rows, dir = NATIONWIDE_DATA_DIR) {
  mkdirSync(dir, { recursive: true })
  const body = [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(formatRow).join('\n')
  writeFileSync(yearPath(year, dir), `${HEADER}\n${body}\n`, 'utf8')
  return rows.length
}

/** Split a flat list of days into year files and write them all. */
export function writeAll(rows, dir = NATIONWIDE_DATA_DIR) {
  const byYear = new Map()
  for (const row of rows) {
    const year = row.date.slice(0, 4)
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year).push(row)
  }
  for (const [year, list] of byYear) writeYear(year, list, dir)
  return { years: byYear.size, days: rows.length }
}

function parseLine(header, line) {
  const cells = line.split(',')
  const row = {}
  for (let i = 0; i < header.length; i++) {
    const key = header[i]
    const cell = cells[i]?.trim() ?? ''
    if (cell === '') {
      row[key] = null
      continue
    }
    row[key] = NUMERIC.has(key) ? Number(cell) : cell
  }
  return row.date ? row : null
}

export function readYear(year, dir = NATIONWIDE_DATA_DIR) {
  const file = yearPath(year, dir)
  if (!existsSync(file)) return []

  const lines = readFileSync(file, 'utf8').split('\n')
  const header = lines[0]?.trim().split(',') ?? []
  const rows = []
  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = parseLine(header, trimmed)
    if (row) rows.push(row)
  }
  return rows
}

export function listYears(dir = NATIONWIDE_DATA_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d{4}\.csv$/.test(f))
    .map((f) => f.slice(0, 4))
    .sort()
}

export function readAll(dir = NATIONWIDE_DATA_DIR) {
  return listYears(dir).flatMap((year) => readYear(year, dir))
}

/* -------------------------------------------------------------------------- */
/* The stations the archive refers to                                         */
/* -------------------------------------------------------------------------- */

/**
 * The register travels with the archive.
 *
 * A day in 1930 names the station that was Germany's coldest place, and half
 * those stations closed decades ago — they are in the historical archives and
 * not in the register of stations reporting today. Without their names the
 * whole point of the extremes would be lost, so the collector writes the
 * stations it used alongside the days it derived from them.
 */
export const STATION_HEADER = 'id,name,state,lat,lon,elevation,from,until'

export const stationPath = (dir = NATIONWIDE_DATA_DIR) => join(dir, 'stations.csv')

/** Names contain no commas in the DWD register, but a stray one would shift every column. */
const clean = (text) => String(text ?? '').replaceAll(',', ' ')

export function writeStations(stations, dir = NATIONWIDE_DATA_DIR) {
  mkdirSync(dir, { recursive: true })
  const body = [...stations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) =>
      [
        s.id,
        clean(s.name),
        clean(s.state),
        s.lat,
        s.lon,
        s.elevation,
        s.from ?? '',
        s.until ?? '',
      ].join(','),
    )
    .join('\n')

  writeFileSync(stationPath(dir), `${STATION_HEADER}\n${body}\n`, 'utf8')
  return stations.length
}

export function readStations(dir = NATIONWIDE_DATA_DIR) {
  const file = stationPath(dir)
  if (!existsSync(file)) return []

  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [id, name, state, lat, lon, elevation, from, until] = trimmed.split(',')
    if (!id) continue
    rows.push({
      id,
      name,
      state,
      lat: Number(lat),
      lon: Number(lon),
      elevation: Number(elevation),
      from: from || null,
      until: until || null,
    })
  }
  return rows
}
