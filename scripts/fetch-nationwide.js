#!/usr/bin/env node
/**
 * Build the nationwide daily shape from the DWD historical archives.
 *
 *   node scripts/fetch-nationwide.js
 *
 * A one-off, like `fetch-records.js`, and for the same reason: the historical
 * archives of the climate network are 360 MB across 1,285 files, and what
 * survives the pass is one line per day. Every day from the cutoff onwards is
 * recomputed at startup from the daily archive the repository already carries,
 * so this download never has to be repeated.
 *
 * The cutoff is the first day of the daily archive, so each day is counted
 * exactly once and the two halves of the series meet without a seam. The same
 * arithmetic produces both halves — `server/nationwide-shape.js` — which is the
 * only way the seam can be invisible.
 *
 * Only the climate network. The precipitation network has four times as many
 * stations but no temperature, and every question this archive answers is a
 * temperature question. Mixing the two would make the station count jump at the
 * point where one network's history begins.
 *
 * Depends on nothing outside the Node standard library.
 */

import {
  fetchHistoricalDays,
  fetchStations,
  GERMAN_STATES,
  listHistorical,
} from '../server/germany-sources.js'
import { listDays } from '../server/germany-csv.js'
import { writeAll, writeStations } from '../server/nationwide-csv.js'
import { addReading, finishShape } from '../server/nationwide-shape.js'

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

const [stations, archives] = await Promise.all([fetchStations(NETWORK), listHistorical(NETWORK)])
console.log(`${archives.length} historische Archive, ${stations.size} Stationen im Verzeichnis\n`)

const queue = []
let skipped = 0
for (const entry of archives) {
  const station = stations.get(entry.id)
  // Coordinates are not optional here: without them a station cannot enter a
  // gradient, and a station that only moves the extremes would bias them.
  if (
    !station ||
    !GERMAN_STATES.has(station.state) ||
    !Number.isFinite(station.lat) ||
    !Number.isFinite(station.lon) ||
    !Number.isFinite(station.elevation)
  ) {
    skipped++
    continue
  }
  queue.push({ entry, station })
}

// Half of these stations closed before the daily archive began; without their
// names a day in 1930 could not say which place was the coldest.
writeStations(queue.map((job) => job.station))
console.log(`${queue.length} Stationen im Archivregister\n`)

const shape = new Map()
const failed = []
let scanned = 0
let readings = 0

const total = queue.length
const started = Date.now()

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      try {
        const history = await fetchHistoricalDays(NETWORK, job.entry, { before: cutoff })
        for (const row of history) addReading(shape, row.date, job.station, row)
        readings += history.length
      } catch (error) {
        failed.push({
          id: job.entry.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      scanned++
      if (scanned % 50 === 0) {
        const secs = (Date.now() - started) / 1000
        process.stdout.write(
          `\r${scanned}/${total} Archive · ${shape.size.toLocaleString('de-DE')} Tage · ` +
            `${(readings / 1e6).toFixed(1)} Mio. Messungen · ${secs.toFixed(0)} s`,
        )
      }
    }
  }),
)

process.stdout.write('\r'.padEnd(80) + '\r')
const secs = ((Date.now() - started) / 1000).toFixed(0)

const rows = finishShape(shape)
const written = writeAll(rows)

console.log(
  `${scanned} Archive gelesen in ${secs} s · ${readings.toLocaleString('de-DE')} Messungen · ` +
    `${skipped} übersprungen`,
)
console.log(
  `${written.days.toLocaleString('de-DE')} Tage in ${written.years} Jahresdateien geschrieben` +
    (rows.length > 0 ? ` (${rows[0].date} bis ${rows.at(-1).date})` : ''),
)

if (failed.length > 0) {
  console.log(`\n${failed.length} Archive fehlgeschlagen:`)
  for (const f of failed.slice(0, 10)) console.log(`  ${f.id}: ${f.error}`)
  if (failed.length > 10) console.log(`  … und ${failed.length - 10} weitere`)
}
