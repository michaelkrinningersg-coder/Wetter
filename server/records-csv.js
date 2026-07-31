import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { GERMANY_DATA_DIR } from './germany-csv.js'

/**
 * The all-time baseline: one row per station and record category, as it stood
 * on the day the daily archive begins.
 *
 * Only the extreme is kept, never the history that produced it. The historical
 * archives weigh 360 MB; what survives them is some ten thousand rows, and
 * everything after the cutoff is replayed from the daily archive that is
 * already in the repository. That keeps the expensive download a one-off.
 */

export const RECORDS_FILE = 'records-baseline.csv'

const FIELDS = ['station', 'kind', 'value', 'date', 'since', 'days']
const HEADER = FIELDS.join(',')

export const recordsPath = (dir = GERMANY_DATA_DIR) => join(dir, RECORDS_FILE)

export function writeBaseline(rows, { cutoff, dir = GERMANY_DATA_DIR } = {}) {
  const file = recordsPath(dir)
  mkdirSync(dirname(file), { recursive: true })

  const body = rows
    .map((r) => FIELDS.map((f) => r[f]).join(','))
    .sort()
    .join('\n')

  // The cutoff belongs in the file: without it a reader cannot tell which days
  // the baseline already accounts for and which still have to be replayed.
  writeFileSync(file, `# Stichtag ${cutoff}\n${HEADER}\n${body}\n`, 'utf8')
  return rows.length
}

export function readBaseline(dir = GERMANY_DATA_DIR) {
  const file = recordsPath(dir)
  if (!existsSync(file)) return { cutoff: null, rows: [] }

  let cutoff = null
  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/Stichtag\s+(\d{4}-\d{2}-\d{2})/)
      if (match) cutoff = match[1]
      continue
    }
    if (trimmed === HEADER) continue

    const [station, kind, value, date, since, days] = trimmed.split(',')
    const numeric = Number(value)
    if (!station || !kind || !Number.isFinite(numeric)) continue
    rows.push({
      station,
      kind,
      value: numeric,
      date,
      since,
      days: Number(days) || 0,
    })
  }
  return { cutoff, rows }
}
