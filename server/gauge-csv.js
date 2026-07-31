import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Flat-file archive of gauge readings, one CSV per gauge.
 *
 * The sources hand out at most 30 days, so the only way to build real history
 * is to keep every reading. A CSV in the repository does that: durable,
 * diffable, and readable without any tooling.
 *
 * Writes are strictly append-only. Rewriting a sorted file on every run would
 * make git store a fresh blob each time; appending keeps the delta to the few
 * lines that are actually new, which matters when a scheduled job commits
 * around the clock.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const GAUGE_DATA_DIR = process.env.GAUGE_DATA_DIR ?? join(here, '..', 'data', 'gauges')

const HEADER = 'timestamp,value_cm'

export const csvPath = (gaugeId, dir = GAUGE_DATA_DIR) => join(dir, `${gaugeId}.csv`)

export function readReadings(gaugeId, dir = GAUGE_DATA_DIR) {
  const file = csvPath(gaugeId, dir)
  if (!existsSync(file)) return []

  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === HEADER) continue
    const comma = trimmed.indexOf(',')
    if (comma < 0) continue
    const ts = trimmed.slice(0, comma)
    const value = Number(trimmed.slice(comma + 1))
    if (Number.isFinite(value)) rows.push({ ts, value })
  }
  return rows
}

/** Timestamp of the last stored reading, or null for a fresh file. */
export function lastTimestamp(gaugeId, dir = GAUGE_DATA_DIR) {
  const rows = readReadings(gaugeId, dir)
  return rows.length > 0 ? rows[rows.length - 1].ts : null
}

/**
 * Append readings that are newer than what the file already holds.
 *
 * Comparison is on the instant, not the string, because the two sources format
 * their offsets differently and a plain string compare would silently drop
 * readings around a daylight-saving change.
 */
export function appendReadings(gaugeId, readings, dir = GAUGE_DATA_DIR) {
  if (readings.length === 0) return 0

  mkdirSync(dir, { recursive: true })
  const file = csvPath(gaugeId, dir)

  if (!existsSync(file)) writeFileSync(file, `${HEADER}\n`, 'utf8')

  const last = lastTimestamp(gaugeId, dir)
  const cutoff = last ? Date.parse(last) : -Infinity

  const fresh = readings
    .filter((r) => Number.isFinite(Date.parse(r.ts)) && Date.parse(r.ts) > cutoff)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))

  if (fresh.length === 0) return 0

  appendFileSync(file, fresh.map((r) => `${r.ts},${r.value}`).join('\n') + '\n', 'utf8')
  return fresh.length
}
