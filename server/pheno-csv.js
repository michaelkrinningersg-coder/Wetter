import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dataDir } from './paths.js'

/**
 * Flat-file archive of the phenological observations.
 *
 *   data/pheno/stations.csv       the reporters inside the radius
 *   data/pheno/plants.csv         plant and phase names, as the DWD defines them
 *   data/pheno/observations.csv   one row per observation
 *
 * One file for all observations rather than one per year, because this archive
 * does not grow: the reporter network has thinned to nothing in this area and
 * the series ends with the historical files. Splitting a static 3 MB table
 * across a hundred files would buy nothing and cost a hundred reads.
 */

export const PHENO_DATA_DIR = dataDir('pheno', process.env.PHENO_DATA_DIR)

const quote = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
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

function writeTable(file, header, rows) {
  mkdirSync(PHENO_DATA_DIR, { recursive: true })
  writeFileSync(join(PHENO_DATA_DIR, file), `${header}\n${rows.join('\n')}\n`, 'utf8')
  return rows.length
}

function readTable(file) {
  const path = join(PHENO_DATA_DIR, file)
  if (!existsSync(path)) return []

  const lines = readFileSync(path, 'utf8').split('\n')
  const header = splitCsvLine(lines[0] ?? '')
  const out = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = splitCsvLine(line)
    const row = {}
    for (const [i, key] of header.entries()) row[key] = cells[i] ?? ''
    out.push(row)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Observations                                                               */
/* -------------------------------------------------------------------------- */

const OBS_FIELDS = ['station', 'year', 'plant', 'phase', 'date', 'julian', 'quality']

export function writeObservations(rows) {
  // Sorted so a re-run produces a byte-identical file and no commit.
  const lines = rows
    .map((r) => OBS_FIELDS.map((f) => quote(r[f])).join(','))
    .sort()
  return writeTable('observations.csv', OBS_FIELDS.join(','), lines)
}

export function readObservations() {
  return readTable('observations.csv')
    .map((r) => ({
      station: r.station,
      year: Number(r.year),
      plant: Number(r.plant),
      phase: Number(r.phase),
      date: r.date,
      julian: Number(r.julian),
      quality: Number(r.quality),
    }))
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.julian))
}

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

const STATION_FIELDS = ['id', 'name', 'lat', 'lon', 'elevation', 'distance', 'landscape']

export function writeStations(stations) {
  const lines = [...stations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => STATION_FIELDS.map((f) => quote(s[f])).join(','))
  return writeTable('stations.csv', STATION_FIELDS.join(','), lines)
}

export function readStations() {
  const out = new Map()
  for (const row of readTable('stations.csv')) {
    if (!row.id) continue
    out.set(row.id, {
      ...row,
      lat: Number(row.lat),
      lon: Number(row.lon),
      elevation: row.elevation === '' ? null : Number(row.elevation),
      distance: Number(row.distance),
    })
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

const NAME_FIELDS = ['kind', 'id', 'name']

/** Plant and phase names in one table, distinguished by `kind`. */
export function writeNames(plants, phases) {
  const lines = []
  for (const [id, name] of plants) lines.push(['plant', id, name].map(quote).join(','))
  for (const [id, name] of phases) lines.push(['phase', id, name].map(quote).join(','))
  return writeTable('plants.csv', NAME_FIELDS.join(','), lines.sort())
}

export function readNames() {
  const plants = new Map()
  const phases = new Map()
  for (const row of readTable('plants.csv')) {
    const target = row.kind === 'phase' ? phases : plants
    target.set(Number(row.id), row.name)
  }
  return { plants, phases }
}

export const hasArchive = () => existsSync(join(PHENO_DATA_DIR, 'observations.csv'))
