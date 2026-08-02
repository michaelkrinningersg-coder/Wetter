import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Flat-file archive of the pollen forecast.
 *
 *   data/pollen/2026/2026-08-02.csv   one file per issue date
 *
 * Sixteen rows a day — eight kinds in two part-regions — at well under a
 * kilobyte. The file is named after the DWD's own issue date, so a day the
 * collector missed is a missing file rather than a wrong one.
 *
 * The severity is stored as the string the DWD publishes ("1-2"), not as a
 * number. The intermediate steps are categories in their own right, and turning
 * them into 1.5 here would be a claim the source does not make.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const POLLEN_DATA_DIR = process.env.POLLEN_DATA_DIR ?? join(here, '..', 'data', 'pollen')

export const DAY_HEADER = 'partregion,pollen,today,tomorrow,dayafter'

export const dayPath = (date, dir = POLLEN_DATA_DIR) =>
  join(dir, date.slice(0, 4), `${date}.csv`)

export function writeDay(date, rows, dir = POLLEN_DATA_DIR) {
  const file = dayPath(date, dir)
  mkdirSync(dirname(file), { recursive: true })

  const body = [...rows]
    .sort((a, b) => a.partregion - b.partregion || a.pollen.localeCompare(b.pollen))
    .map((r) => `${r.partregion},${r.pollen},${r.today},${r.tomorrow},${r.dayafter}`)
    .join('\n')

  writeFileSync(file, `${DAY_HEADER}\n${body}\n`, 'utf8')
  return rows.length
}

export function readDay(date, dir = POLLEN_DATA_DIR) {
  const file = dayPath(date, dir)
  if (!existsSync(file)) return []

  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [partregion, pollen, today, tomorrow, dayafter] = trimmed.split(',')
    const region = Number(partregion)
    if (!Number.isFinite(region) || !pollen) continue
    rows.push({
      issued: date,
      partregion: region,
      pollen,
      today: today ?? '',
      tomorrow: tomorrow ?? '',
      dayafter: dayafter ?? '',
    })
  }
  return rows
}

/** Every archived issue date, ascending. */
export function listDays(dir = POLLEN_DATA_DIR) {
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
