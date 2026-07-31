import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIELDS } from './germany-sources.js'

/**
 * Flat-file archive of nationwide daily readings.
 *
 * Layout:
 *
 *   data/germany/stations.csv     the register: id, network, name, state, …
 *   data/germany/2026/2026-07-30.csv   one file per day, one row per station
 *
 * One file per day rather than one per month or one big table, for the same
 * reason the gauge archive appends instead of rewriting: the daily job adds
 * exactly one new object and never touches an existing one. A month file would
 * be rewritten thirty times, and git would store thirty full copies of it.
 *
 * The register is the exception — it is rewritten, but only when a station is
 * actually added or its details change, which is a few times a year.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const GERMANY_DATA_DIR =
  process.env.GERMANY_DATA_DIR ?? join(here, '..', 'data', 'germany')

/* -------------------------------------------------------------------------- */
/* Daily files                                                                */
/* -------------------------------------------------------------------------- */

export const DAY_HEADER = ['station', ...FIELDS].join(',')

export const dayPath = (date, dir = GERMANY_DATA_DIR) =>
  join(dir, date.slice(0, 4), `${date}.csv`)

/** Format one reading as a CSV line; absent parameters stay empty. */
export function formatRow(stationId, row) {
  const cells = FIELDS.map((f) => (row[f] === undefined || row[f] === null ? '' : row[f]))
  return `${stationId},${cells.join(',')}`
}

export function writeDay(date, lines, dir = GERMANY_DATA_DIR) {
  const file = dayPath(date, dir)
  mkdirSync(dirname(file), { recursive: true })
  // Sorted by station id so the file is stable: a re-run that fetches the same
  // day in a different order produces a byte-identical file and no commit.
  const body = [...lines].sort().join('\n')
  writeFileSync(file, `${DAY_HEADER}\n${body}\n`, 'utf8')
  return lines.length
}

export function readDay(date, dir = GERMANY_DATA_DIR) {
  const file = dayPath(date, dir)
  if (!existsSync(file)) return []

  const rows = []
  const lines = readFileSync(file, 'utf8').split('\n')
  const header = lines[0]?.trim().split(',') ?? []
  const fieldAt = FIELDS.map((f) => header.indexOf(f))

  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cells = trimmed.split(',')
    const row = { station_id: cells[0], date }
    for (const [i, field] of FIELDS.entries()) {
      const at = fieldAt[i]
      if (at < 0) continue
      const raw = cells[at]
      if (raw === undefined || raw === '') continue
      const value = Number(raw)
      if (Number.isFinite(value)) row[field] = value
    }
    rows.push(row)
  }
  return rows
}

/** Every archived date, ascending. */
export function listDays(dir = GERMANY_DATA_DIR) {
  if (!existsSync(dir)) return []
  const days = []
  for (const year of readdirSync(dir)) {
    if (!/^\d{4}$/.test(year)) continue
    for (const file of readdirSync(join(dir, year))) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.csv$/)
      if (match) days.push(match[1])
    }
  }
  return days.sort()
}

/* -------------------------------------------------------------------------- */
/* Station register                                                           */
/* -------------------------------------------------------------------------- */

const STATION_FIELDS = ['id', 'network', 'name', 'state', 'lat', 'lon', 'elevation']
const STATION_HEADER = STATION_FIELDS.join(',')

export const stationsPath = (dir = GERMANY_DATA_DIR) => join(dir, 'stations.csv')

/** Commas appear in station names ("Kubschütz, Kr. Bautzen"), so quote them. */
function quote(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function splitCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cell); cell = '' }
    else cell += c
  }
  cells.push(cell)
  return cells
}

export function writeStations(stations, dir = GERMANY_DATA_DIR) {
  mkdirSync(dir, { recursive: true })
  const lines = [...stations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => STATION_FIELDS.map((f) => quote(s[f])).join(','))
  writeFileSync(stationsPath(dir), `${STATION_HEADER}\n${lines.join('\n')}\n`, 'utf8')
  return lines.length
}

export function readStations(dir = GERMANY_DATA_DIR) {
  const file = stationsPath(dir)
  if (!existsSync(file)) return new Map()

  const lines = readFileSync(file, 'utf8').split('\n')
  const header = splitCsvLine(lines[0] ?? '')
  const out = new Map()

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = splitCsvLine(line)
    const row = {}
    for (const [i, key] of header.entries()) row[key] = cells[i]
    if (!row.id) continue
    out.set(row.id, {
      ...row,
      lat: Number(row.lat),
      lon: Number(row.lon),
      elevation: Number(row.elevation),
    })
  }
  return out
}
