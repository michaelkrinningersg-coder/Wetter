#!/usr/bin/env node
/**
 * Collect the DWD pollen forecast for the Göttingen region.
 *
 *   node scripts/fetch-pollen.js
 *
 * No backfill exists and none can: the DWD publishes one file, replaces it the
 * next morning, and keeps nothing. Every day this does not run is a gap that
 * stays a gap.
 *
 * The file is written under the DWD's own issue date, so running twice in a day
 * overwrites rather than duplicating, and a run before the day's update simply
 * rewrites yesterday's file with identical content and produces no commit.
 *
 * Depends on nothing outside the Node standard library.
 */

import { HOME_PARTREGION, REGION_NAME, fetchPollen } from '../server/pollen-sources.js'
import { listDays, readDay, writeDay } from '../server/pollen-csv.js'

const started = Date.now()
const { issued, updated, next, parts } = await fetchPollen()

const rows = []
for (const part of parts) {
  for (const row of part.rows) rows.push({ partregion: part.partregion, ...row })
}

if (rows.length === 0) {
  console.error(`Region "${REGION_NAME}" enthielt keine Pollenwerte — nichts geschrieben.`)
  process.exit(1)
}

const before = JSON.stringify(readDay(issued))
writeDay(issued, rows)
const changed = before !== JSON.stringify(readDay(issued))

console.log(`Ausgabe des DWD: ${updated}${next ? ` · nächste: ${next}` : ''}`)
console.log(`Region ${REGION_NAME} mit ${parts.length} Teilregionen:\n`)

for (const part of parts) {
  const mark = part.partregion === HOME_PARTREGION ? '›' : ' '
  console.log(`${mark} ${part.name} (${part.partregion})`)
  for (const row of part.rows) {
    console.log(
      `    ${row.pollen.padEnd(10)} heute ${row.today.padEnd(4)}` +
        ` morgen ${row.tomorrow.padEnd(4)} übermorgen ${row.dayafter}`,
    )
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  `\n${rows.length} Zeilen für ${issued} ${changed ? 'geschrieben' : 'unverändert'} (${secs} s).` +
    ` Archiv umfasst nun ${listDays().length} Ausgaben.`,
)
