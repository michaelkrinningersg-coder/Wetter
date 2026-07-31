#!/usr/bin/env node
/**
 * Build the all-time record baseline from the DWD historical archives.
 *
 *   node scripts/fetch-records.js
 *
 * This is a one-off. The historical archives of the climate network weigh
 * 360 MB across 1285 files, and everything that survives the pass is one row
 * per station and category — the extreme, its date, and how long that station
 * has measured the parameter at all. Every day after the cutoff is replayed
 * from the daily archive already committed to the repository, so the download
 * never has to be repeated.
 *
 * The cutoff is the first day of the daily archive. The two sources overlap by
 * eleven months rather than abutting, so the union has no gap; taking the
 * archive's own start as the boundary keeps each day counted exactly once.
 *
 * Depends on nothing outside the Node standard library.
 */

import { fetchHistoricalDays, fetchStations, GERMAN_STATES, listHistorical } from '../server/germany-sources.js'
import { listDays } from '../server/germany-csv.js'
import { writeBaseline } from '../server/records-csv.js'
import { beats, RECORD_KINDS } from '../server/records-kinds.js'

const NETWORK = 'kl'
const CONCURRENCY = 12

const days = listDays()
if (days.length === 0) {
  console.error(
    'Kein Tagesarchiv vorhanden. Erst `npm run fetch:germany -- --backfill` ausführen,' +
      ' sonst ist der Stichtag unbestimmt.',
  )
  process.exit(1)
}

const cutoff = days[0]
console.log(`Stichtag: ${cutoff} (erster Tag des Tagesarchivs)`)

const [stations, archives] = await Promise.all([
  fetchStations(NETWORK),
  listHistorical(NETWORK),
])
console.log(`${archives.length} historische Archive, ${stations.size} Stationen im Verzeichnis\n`)

const rows = []
const failed = []
let skipped = 0
let scanned = 0

/** Reduce one station's whole history to its extremes before the cutoff. */
function reduce(id, history) {
  const best = new Map()
  for (const row of history) {
    for (const kind of RECORD_KINDS) {
      const value = row[kind.field]
      if (value === undefined || value === null) continue

      const current = best.get(kind.key)
      if (!current) {
        best.set(kind.key, { value, date: row.date, since: row.date, days: 1 })
        continue
      }
      // `since` and `days` describe the parameter, not the station: a station
      // may have measured temperature since 1881 and wind only since 1990,
      // and a record is only as impressive as its own series is long.
      current.days++
      if (row.date < current.since) current.since = row.date
      if (beats(kind, value, current.value)) {
        current.value = value
        current.date = row.date
      }
    }
  }

  return [...best.entries()].map(([kind, r]) => ({
    station: id,
    kind,
    value: r.value,
    date: r.date,
    since: r.since,
    days: r.days,
  }))
}

const queue = archives.filter((entry) => {
  const station = stations.get(entry.id)
  if (!station || !GERMAN_STATES.has(station.state)) {
    skipped++
    return false
  }
  return true
})

const total = queue.length
const started = Date.now()

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      try {
        const history = await fetchHistoricalDays(NETWORK, entry, { before: cutoff })
        rows.push(...reduce(entry.id, history))
      } catch (error) {
        failed.push({ id: entry.id, error: error instanceof Error ? error.message : String(error) })
      }
      scanned++
      if (scanned % 100 === 0) {
        const secs = (Date.now() - started) / 1000
        process.stdout.write(
          `\r${scanned}/${total} Archive · ${rows.length.toLocaleString('de-DE')} Rekorde · ${secs.toFixed(0)} s`,
        )
      }
    }
  }),
)

const secs = ((Date.now() - started) / 1000).toFixed(0)
process.stdout.write('\r'.padEnd(72) + '\r')

if (rows.length === 0) {
  console.error('Kein einziges Archiv gelesen — nichts geschrieben.')
  process.exit(1)
}

writeBaseline(rows, { cutoff })

const perStation = new Set(rows.map((r) => r.station)).size
const lengths = rows.map((r) => r.days / 365.25).sort((a, b) => a - b)

console.log(
  `${scanned} Archive in ${secs} s · ${rows.length.toLocaleString('de-DE')} Rekorde` +
    ` für ${perStation.toLocaleString('de-DE')} Stationen geschrieben.`,
)
console.log(
  `Reihenlänge je Rekord: Median ${lengths[Math.floor(lengths.length / 2)].toFixed(0)} a,` +
    ` kürzeste ${lengths[0].toFixed(1)} a, längste ${lengths.at(-1).toFixed(0)} a.`,
)
if (skipped > 0) console.log(`${skipped} Archive ohne deutsche Station übergangen.`)
if (failed.length > 0) {
  console.log(`${failed.length} Archive nicht lesbar:`)
  for (const f of failed.slice(0, 5)) console.log(`  ${f.id}: ${f.error}`)
}
