#!/usr/bin/env node
/**
 * Fetch the current water level of every configured gauge and append it to the
 * CSV archive.
 *
 * Written for a scheduled GitHub Action, so it deliberately depends on nothing
 * beyond the Node standard library — no `npm ci`, no native build of
 * better-sqlite3, no install step at all. That keeps a run at a few seconds and
 * removes the most common reason for a nightly job to start failing.
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
