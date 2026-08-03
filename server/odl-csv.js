import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dataDir } from './paths.js'

/**
 * Flat-file archive of the gamma dose rate.
 *
 *   data/odl/probes.csv            the register: id, name, distance, altitude
 *   data/odl/2026/2026-08-01.csv   one file per day, one row per probe-hour
 *
 * Roughly 264 rows a day at eleven probes, about 4 kB. Written once per day and
 * never rewritten afterwards, so git stores each day exactly once.
 *
 * This archive is the only copy that will exist. The BfS keeps seven days;
 * everything older here was kept because the app was open on that day.
 */

export const ODL_DATA_DIR = dataDir('odl', process.env.ODL_DATA_DIR)

export const DAY_HEADER = 'probe,hour,value'

export const dayPath = (date, dir = ODL_DATA_DIR) =>
  join(dir, date.slice(0, 4), `${date}.csv`)

export function writeDay(date, rows, dir = ODL_DATA_DIR) {
  const file = dayPath(date, dir)
  mkdirSync(dirname(file), { recursive: true })

  // Sorted so a re-run over the same day is byte-identical and makes no commit.
  const body = [...rows]
    .sort((a, b) => a.probe.localeCompare(b.probe) || a.hour - b.hour)
    .map((r) => `${r.probe},${r.hour},${r.value}`)
    .join('\n')

  writeFileSync(file, `${DAY_HEADER}\n${body}\n`, 'utf8')
  return rows.length
}

export function readDay(date, dir = ODL_DATA_DIR) {
  const file = dayPath(date, dir)
  if (!existsSync(file)) return []

  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [probe, hour, value] = trimmed.split(',')
    const h = Number(hour)
    const v = Number(value)
    if (!probe || !Number.isFinite(h) || !Number.isFinite(v)) continue
    rows.push({ probe, date, hour: h, value: v })
  }
  return rows
}

/** Every archived date, ascending. */
export function listDays(dir = ODL_DATA_DIR) {
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
/* Probe register                                                             */
/* -------------------------------------------------------------------------- */

const PROBE_FIELDS = [
  'id',
  'code',
  'name',
  'lat',
  'lon',
  'elevation',
  'distance',
  'status',
  'cosmic',
  'terrestrial',
]
const PROBE_HEADER = PROBE_FIELDS.join(',')

export const probesPath = (dir = ODL_DATA_DIR) => join(dir, 'probes.csv')

/** Probe names carry commas ("Reinhardshagen, OT Veckerhagen"), so quote them. */
function quote(value) {
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

export function writeProbes(probes, dir = ODL_DATA_DIR) {
  mkdirSync(dir, { recursive: true })
  const lines = [...probes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => PROBE_FIELDS.map((f) => quote(p[f])).join(','))
  writeFileSync(probesPath(dir), `${PROBE_HEADER}\n${lines.join('\n')}\n`, 'utf8')
  return lines.length
}

export function readProbes(dir = ODL_DATA_DIR) {
  const file = probesPath(dir)
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
      elevation: row.elevation === '' ? null : Number(row.elevation),
      distance: Number(row.distance),
      cosmic: row.cosmic === '' ? null : Number(row.cosmic),
      terrestrial: row.terrestrial === '' ? null : Number(row.terrestrial),
    })
  }
  return out
}
