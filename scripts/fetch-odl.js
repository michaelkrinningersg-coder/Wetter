#!/usr/bin/env node
/**
 * Collect the gamma dose rate for the probes around Göttingen.
 *
 *   node scripts/fetch-odl.js
 *
 * There is no backfill option and there cannot be one: the BfS publishes a
 * seven-day window and nothing behind it. Whatever this archive holds beyond
 * those seven days exists because the workflow ran that day. The upside of the
 * window is that a single missed run costs nothing — the next run still sees
 * the day and fills it in.
 *
 * The most recent day is deliberately kept even though it is incomplete; it is
 * rewritten in full on each subsequent run until it stops changing.
 *
 * Depends on nothing outside the Node standard library.
 */

import { RADIUS_KM, fetchProbes, fetchWindow } from '../server/odl-sources.js'
import { listDays, readDay, readProbes, writeDay, writeProbes } from '../server/odl-csv.js'

const started = Date.now()

/* -------------------------------------------------------------------------- */
/* Register                                                                   */
/* -------------------------------------------------------------------------- */

const probes = await fetchProbes()
if (probes.length === 0) {
  console.error(`Keine Sonde im ${RADIUS_KM}-km-Umkreis gefunden — Abbruch.`)
  process.exit(1)
}

console.log(`${probes.length} Sonden im ${RADIUS_KM}-km-Umkreis:`)
for (const probe of probes) {
  console.log(
    `  ${String(probe.distance).padStart(5)} km  ${probe.id}  ${probe.name.padEnd(32)}` +
      ` ${String(probe.elevation ?? '—').padStart(4)} m  ${probe.status}`,
  )
}

// The register is merged rather than replaced: a probe the BfS switches off
// stops appearing in the current answer, but its archived hours stay readable
// and still need a name to be shown under.
const known = readProbes()
for (const probe of probes) known.set(probe.id, probe)
writeProbes([...known.values()])

/* -------------------------------------------------------------------------- */
/* Window                                                                     */
/* -------------------------------------------------------------------------- */

const window = await fetchWindow(probes.map((p) => p.id))
const dates = Object.keys(window).sort()

if (dates.length === 0) {
  console.error('\nDer BfS-Dienst lieferte keine Stundenwerte.')
  process.exit(1)
}

let values = 0
let changed = 0

for (const date of dates) {
  const rows = []
  for (const [probe, hours] of Object.entries(window[date])) {
    for (const [hour, value] of Object.entries(hours)) {
      rows.push({ probe, hour: Number(hour), value })
      values++
    }
  }

  const before = JSON.stringify(readDay(date))
  writeDay(date, rows)
  if (before !== JSON.stringify(readDay(date))) changed++
}

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(
  `\n${dates.length} Tag(e) im Fenster, davon ${changed} verändert;` +
    ` ${values.toLocaleString('de-DE')} Stundenwerte (${secs} s).`,
)
console.log(
  `Fenster ${dates[0]} bis ${dates.at(-1)} (UTC) ·` +
    ` Archiv umfasst nun ${listDays().length} Tage.`,
)
