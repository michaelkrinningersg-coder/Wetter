#!/usr/bin/env node
/**
 * Import every configured station from the DWD.
 *
 * The static build needs a populated database, and a fresh clone has none —
 * `data/weather.sqlite` is deliberately not in the repository. This is what the
 * Pages workflow runs before prerendering.
 *
 *   node scripts/import-stations.js            # historisches Archiv nur bei leerer Tabelle
 *   node scripts/import-stations.js --force    # immer, für Schemaänderungen
 */

import { importStation } from '../server/dwd.js'
import { STATIONS } from '../server/stations.js'

// After a column is added the existing rows carry nothing for it; only the
// historical archive can fill them, and that is skipped unless forced.
const force = process.argv.includes('--force')
if (force) console.log('Vollimport erzwungen (historische Archive werden neu gelesen).\n')

let failed = 0
for (const station of STATIONS) {
  const started = Date.now()
  try {
    const result = await importStation(station.id, { force })
    console.log(
      `${station.name} (${station.id}): ${result.newRecordsCount.toLocaleString('de-DE')} neu,` +
        ` bis ${result.newMaxDate} · ${((Date.now() - started) / 1000).toFixed(0)} s`,
    )
  } catch (error) {
    failed++
    console.error(`${station.name} (${station.id}): ${error instanceof Error ? error.message : error}`)
  }
}

if (failed === STATIONS.length) {
  console.error('Keine einzige Station importiert.')
  process.exit(1)
}
