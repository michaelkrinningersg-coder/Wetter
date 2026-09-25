import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { GERMANY_DATA_DIR } from './germany-csv.js'

/**
 * The all-time baseline: the ten best days per station and record category, as
 * they stood on the day the daily archive begins.
 *
 * Only those ten are kept, never the history that produced them. The
 * historical archives weigh 360 MB; what survives them is some sixty thousand
 * rows, and everything after the cutoff is replayed from the daily archive
 * that is already in the repository. That keeps the expensive download a
 * one-off.
 *
 * It used to keep one row — the extreme itself. That answered "was this a
 * record" and nothing else, and the view can now be switched to "did this make
 * the top ten", which the single best value cannot answer at all. Going deeper
 * meant repeating the download once; it does not have to be repeated again.
 */

export const RECORDS_FILE = 'records-baseline.csv'

const FIELDS = ['station', 'kind', 'rank', 'value', 'date', 'since', 'days']
const HEADER = FIELDS.join(',')

export const recordsPath = (dir = GERMANY_DATA_DIR) => join(dir, RECORDS_FILE)

export function writeBaseline(rows, { cutoff, dir = GERMANY_DATA_DIR } = {}) {
  const file = recordsPath(dir)
  mkdirSync(dirname(file), { recursive: true })

  /*
   * Sorted by station, category and place — as rows, not as text. Sorting the
   * joined lines would put place 10 between 1 and 2, and the file is meant to
   * be readable by whoever opens it.
   */
  const body = rows
    .slice()
    .sort(
      (a, b) =>
        a.station.localeCompare(b.station) ||
        a.kind.localeCompare(b.kind) ||
        a.rank - b.rank,
    )
    .map((r) => FIELDS.map((f) => r[f]).join(','))
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
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/Stichtag\s+(\d{4}-\d{2}-\d{2})/)
      if (match) cutoff = match[1]
      continue
    }
    if (trimmed === HEADER) continue

    const [station, kind, rank, value, date, since, days] = trimmed.split(',')
    const numeric = Number(value)
    const place = Number(rank)
    if (!station || !kind || !Number.isFinite(numeric) || !Number.isFinite(place)) continue
    rows.push({
      station,
      kind,
      rank: place,
      value: numeric,
      date,
      since,
      days: Number(days) || 0,
    })
  }
  return { cutoff, rows }
}
