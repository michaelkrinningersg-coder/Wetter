#!/usr/bin/env node
/**
 * Fetch the current water level of every configured gauge and append it to the
 * CSV archive.
 *
 * Depends on nothing beyond the Node standard library, like every collector
 * here. The running app does not use this script — `server/jobs.js` refreshes
 * the gauges in-process, because that path writes to the database as well —
 * but it stays as the way to collect a reading without starting the app.
 *
 *   node scripts/fetch-gauges.js
 *
 * Exit code 0 also when a single gauge fails: one unreachable portal should not
 * discard the readings of the other two. A run only fails if every gauge fails.
 */

import { GAUGES, fetchNlwkn, fetchPegelonlineSeries } from '../server/gauge-sources.js'
import { appendReadings, readReadings } from '../server/gauge-csv.js'

const results = []

for (const gauge of GAUGES) {
  const label = `${gauge.water} bei ${gauge.name}`
  try {
    // The NLWKN page is the only place the current value and the thresholds
    // are published, so it is read for every gauge.
    const meta = await fetchNlwkn(gauge)

    let readings = []
    if (gauge.source === 'pegelonline') {
      readings = await fetchPegelonlineSeries(gauge)
    } else if (meta.current?.measuredAt) {
      readings = [{ ts: meta.current.measuredAt, value: meta.current.cm }]
    }

    const appended = appendReadings(gauge.id, readings)
    const total = readReadings(gauge.id).length

    console.log(
      `${label}: ${meta.current?.cm ?? '—'} cm` +
        ` · ${appended} neu · ${total} im Archiv`,
    )
    results.push({ gauge: gauge.id, ok: true, appended, total })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${label}: FEHLER — ${message}`)
    results.push({ gauge: gauge.id, ok: false, error: message })
  }
}

const failed = results.filter((r) => !r.ok)
const appended = results.reduce((sum, r) => sum + (r.appended ?? 0), 0)

console.log(
  `\n${results.length - failed.length}/${results.length} Pegel abgerufen, ` +
    `${appended} neue Messwerte.`,
)

if (failed.length === results.length) {
  console.error('Kein einziger Pegel erreichbar — Lauf wird als fehlgeschlagen gewertet.')
  process.exit(1)
}
