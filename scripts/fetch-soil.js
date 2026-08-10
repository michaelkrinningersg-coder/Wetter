#!/usr/bin/env node
/**
 * Collect the soil series for Göttingen and write them to the CSV archive.
 *
 *   node scripts/fetch-soil.js              # the current year of both series
 *   node scripts/fetch-soil.js --backfill   # 1991 (moisture) and 1981 (temperature)
 *
 * `--backfill` is worth running once and then never again: it fetches 12,785
 * modelled days and 45 years of measured soil temperature in two requests, and
 * afterwards the daily run only touches the current year.
 *
 * Depends on nothing outside the Node standard library, so the scheduler runs
 * it as its own process, out of reach of the database.
 */

import { fetchDerived, fetchMeasured, SOIL_STATION } from '../server/soil-sources.js'
import { soilRange, writeSoil } from '../server/soil-csv.js'

const historical = process.argv.includes('--backfill')

console.log(
  `${SOIL_STATION.name} (${SOIL_STATION.id}): ` +
    (historical ? 'Vollarchiv' : 'laufendes Jahr'),
)

const started = Date.now()
let failed = 0

/*
 * The two series are fetched independently and one failure does not discard
 * the other: they come from different directories on the DWD server, and a
 * missing soil temperature is no reason to lose the moisture as well.
 */
for (const [kind, fetcher, label] of [
  ['moisture', fetchDerived, 'Bodenfeuchte und Verdunstung (Modell AMBAV)'],
  ['temperature', fetchMeasured, 'Gemessene Bodentemperatur'],
]) {
  try {
    const rows = await fetcher({ historical })
    const result = writeSoil(kind, rows)
    const range = soilRange(kind)
    console.log(
      `  ${label}: ${rows.length.toLocaleString('de-DE')} Tage geholt,` +
        ` ${result.changed.toLocaleString('de-DE')} neu oder geändert` +
        ` · Archiv ${range.first} bis ${range.last} (${range.days.toLocaleString('de-DE')} Tage)`,
    )
  } catch (error) {
    failed++
    console.error(`  ${label}: ${error instanceof Error ? error.message : error}`)
  }
}

console.log(`\nFertig in ${((Date.now() - started) / 1000).toFixed(1)} s.`)

// Only a total failure is a failure: the scheduler must not mark the run red
// because one of two directories was briefly unreachable.
if (failed === 2) process.exit(1)
