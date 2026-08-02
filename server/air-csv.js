import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIELDS } from './air-sources.js'

/**
 * Flat-file archive of hourly air quality.
 *
 *   data/air/2026/2026-07-30.csv    one file per day, one row per station-hour
 *
 * One file per day, for the same reason the nationwide archive uses them: the
 * daily job adds one object and never rewrites an existing one. A month file
 * would be rewritten thirty times over and git would keep thirty full copies;
 * at roughly 2 kB a day that difference is the whole storage budget.
 *
 * Forty-eight rows per file — two stations, twenty-four hours — with the
 * components as columns. A station that does not measure a component leaves
 * that cell empty, which is not the same as a zero and must not be filled in.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const AIR_DATA_DIR = process.env.AIR_DATA_DIR ?? join(here, '..', 'data', 'air')

export const DAY_HEADER = ['station', 'hour', ...FIELDS].join(',')

export const dayPath = (date, dir = AIR_DATA_DIR) =>
  join(dir, date.slice(0, 4), `${date}.csv`)

/** Format one station-hour as a CSV line; unmeasured components stay empty. */
export function formatRow(row) {
  const cells = FIELDS.map((f) => (row[f] === undefined || row[f] === null ? '' : row[f]))
  return `${row.station},${row.hour},${cells.join(',')}`
}

export function writeDay(date, rows, dir = AIR_DATA_DIR) {
  const file = dayPath(date, dir)
  mkdirSync(dirname(file), { recursive: true })

  // Sorted by station and hour so a re-run of the same day produces a
  // byte-identical file and therefore no commit.
  const body = [...rows]
    .sort((a, b) => a.station.localeCompare(b.station) || a.hour - b.hour)
    .map(formatRow)
    .join('\n')

  writeFileSync(file, `${DAY_HEADER}\n${body}\n`, 'utf8')
  return rows.length
}

export function readDay(date, dir = AIR_DATA_DIR) {
  const file = dayPath(date, dir)
  if (!existsSync(file)) return []

  const lines = readFileSync(file, 'utf8').split('\n')
  const header = lines[0]?.trim().split(',') ?? []
  const fieldAt = FIELDS.map((f) => header.indexOf(f))
  const rows = []

  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cells = trimmed.split(',')

    const hour = Number(cells[1])
    if (!cells[0] || !Number.isFinite(hour)) continue

    const row = { station: cells[0], date, hour }
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
export function listDays(dir = AIR_DATA_DIR) {
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
