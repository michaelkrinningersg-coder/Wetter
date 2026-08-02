import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A database of one's own.
 *
 * `server/db.js` opens `$DATA_DIR/weather.sqlite` the first time it is imported
 * and keeps that handle for the life of the process. Setting the variable and
 * *then* importing therefore hands each test file an empty archive it cannot
 * share with any other — `node --test` runs every file in its own process, so
 * the two never meet.
 *
 * The import has to be dynamic for the same reason: a static one would be
 * hoisted above the assignment and open the real archive instead.
 */
export async function freshArchive() {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wetter-test-'))
  const { db } = await import('../../server/db.js')
  return db
}

const COLUMNS = [
  'temp_mean', 'temp_max', 'temp_min', 'precipitation', 'wind_max', 'wind_mean',
  'pressure', 'sunshine', 'cloud', 'humidity', 'vapour_pressure', 'snow',
  'temp_ground_min',
]

/**
 * Write days into `daily`.
 *
 * Every row is `{ date, ...values }`; anything left out is stored as NULL,
 * which is exactly what the modules under test have to cope with. Year, month
 * and day are derived from the date so a fixture cannot disagree with itself.
 */
export function seed(db, station, rows) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO daily (station_id, date, year, month, day, ${COLUMNS.join(', ')})
    VALUES (@station_id, @date, @year, @month, @day, ${COLUMNS.map((c) => `@${c}`).join(', ')})
  `)
  const write = db.transaction((list) => {
    for (const row of list) {
      const [year, month, day] = row.date.split('-').map(Number)
      const values = { station_id: station, date: row.date, year, month, day }
      for (const column of COLUMNS) values[column] = row[column] ?? null
      insert.run(values)
    }
  })
  write(rows)
}

const DAY = 86_400_000

/** Every date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function days(from, to) {
  const out = []
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY) {
    out.push(new Date(at).toISOString().slice(0, 10))
  }
  return out
}

/** The same calendar day in every year of a range — the axis most rules rank on. */
export function everyYear(from, to, monthDay) {
  const out = []
  for (let year = from; year <= to; year++) out.push(`${year}-${monthDay}`)
  return out
}
