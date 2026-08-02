#!/usr/bin/env node
/**
 * Collect the DWD phenology for the area around Göttingen.
 *
 *   node scripts/fetch-phenology.js
 *   node scripts/fetch-phenology.js wild        # eine Gruppe allein
 *
 * This is a one-time collector, not a daily one. About 4.3 GB is read across
 * 47 files and roughly 87,000 observations survive the filter — the rest
 * belongs to the other 1200 reporters in Germany. Nothing is written to disk
 * whole: each file is streamed and discarded as it goes, so the run needs
 * bandwidth but almost no space.
 *
 * It is not in the daily workflow because there is nothing daily to collect.
 * The reporter network in this area has thinned to a handful of observations a
 * year, and the DWD revises the historical files perhaps once a year. Re-running
 * this after such a revision is the only reason to run it again.
 *
 * Depends on nothing outside the Node standard library.
 */

import {
  GROUPS,
  RADIUS_KM,
  fetchDictionaries,
  fetchStations,
  listFiles,
  readObservations,
} from '../server/pheno-sources.js'
import {
  readObservations as readArchive,
  writeNames,
  writeObservations,
  writeStations,
} from '../server/pheno-csv.js'

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const groups = wanted.length > 0 ? GROUPS.filter((g) => wanted.includes(g.key)) : GROUPS

if (groups.length === 0) {
  console.error(`Unbekannte Gruppe. Verfügbar: ${GROUPS.map((g) => g.key).join(', ')}`)
  process.exit(1)
}

const started = Date.now()

/* -------------------------------------------------------------------------- */
/* Stations and dictionaries                                                  */
/* -------------------------------------------------------------------------- */

const stations = await fetchStations()
if (stations.length === 0) {
  console.error(`Keine Meldestation im ${RADIUS_KM}-km-Umkreis — Abbruch.`)
  process.exit(1)
}

const ids = new Set(stations.map((s) => s.id))
console.log(`${stations.length} Meldestationen im ${RADIUS_KM}-km-Umkreis, die fünf nächsten:`)
for (const station of stations.slice(0, 5)) {
  console.log(
    `  ${String(station.distance).padStart(5)} km  ${station.id}  ${station.name.padEnd(30)}` +
      ` ${String(station.elevation ?? '—').padStart(4)} m`,
  )
}

const { plants, phases } = await fetchDictionaries()
console.log(`\nSchlüssel gelesen: ${plants.size} Pflanzen, ${phases.size} Phasen\n`)

/* -------------------------------------------------------------------------- */
/* Observations                                                               */
/* -------------------------------------------------------------------------- */

const all = []
let readBytes = 0

for (const group of groups) {
  const files = await listFiles(group)
  console.log(`${group.label} — ${files.length} Arten (jeweils nur der jüngste Stand):`)

  let groupRows = 0
  for (const [index, file] of files.entries()) {
    const { rows, bytes } = await readObservations(file.url, ids)
    readBytes += bytes
    groupRows += rows.length
    for (const row of rows) all.push(row)

    const species = file.species.replace(/^PH_Jahresmelder_[^_]+(_[^_]+)*?_/, '')
    process.stdout.write(
      `  [${String(index + 1).padStart(2)}/${files.length}] ${species.slice(0, 38).padEnd(38)}` +
        ` ${(bytes / 1048576).toFixed(0).padStart(4)} MB gelesen →` +
        ` ${String(rows.length).padStart(5)} Beobachtungen\n`,
    )
  }
  console.log(`  ${group.label}: ${groupRows.toLocaleString('de-DE')} Beobachtungen\n`)
}

if (all.length === 0) {
  console.error('Keine Beobachtung im Umkreis gefunden — nichts geschrieben.')
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

const before = readArchive().length

writeStations(stations)
writeNames(plants, phases)
const written = writeObservations(all)

const years = all.map((r) => r.year)
const secs = ((Date.now() - started) / 1000).toFixed(0)

console.log(
  `${written.toLocaleString('de-DE')} Beobachtungen geschrieben` +
    (before > 0 ? ` (vorher ${before.toLocaleString('de-DE')})` : '') +
    `, ${(readBytes / 1073741824).toFixed(1)} GB gelesen, ${secs} s.`,
)
console.log(
  `Zeitraum ${Math.min(...years)}–${Math.max(...years)} ·` +
    ` ${new Set(all.map((r) => r.station)).size} meldende Stationen ·` +
    ` ${new Set(all.map((r) => r.plant)).size} Pflanzenarten`,
)
