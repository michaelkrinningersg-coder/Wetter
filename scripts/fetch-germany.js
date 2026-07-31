#!/usr/bin/env node
/**
 * Collect one day (or the whole rolling window) of nationwide DWD readings and
 * write them to the CSV archive.
 *
 * Like `fetch-gauges.js`, this depends on nothing outside the Node standard
 * library, so the scheduled workflow needs no install step at all — the ZIP
 * archives are unpacked by `server/zip.js` on top of `node:zlib`.
 *
 *   node scripts/fetch-germany.js              # yesterday
 *   node scripts/fetch-germany.js 2026-07-28   # one specific day
 *   node scripts/fetch-germany.js --backfill   # every day the archives hold
 *
 * `--backfill` is worth running once: each station archive carries about 500
 * days, so a single pass fills roughly eighteen months of history and the
 * yearly rankings work immediately instead of a year from now.
 */

import { fetchNetwork, GERMAN_STATES } from '../server/germany-sources.js'
import { formatRow, listDays, readStations, writeDay, writeStations } from '../server/germany-csv.js'

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2)
const backfill = args.includes('--backfill')
const explicit = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

/** Yesterday in Berlin — the DWD labels its climatological day in local time. */
function yesterdayInBerlin() {
  const now = new Date(Date.now() - 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Days below this many stations are not archived.
 *
 * Most station archives start in January 2025, but a handful reach back to
 * 2023 — which produces days carrying a single station. A national ranking
 * drawn from one station is not a weak ranking, it is a wrong one. The floor
 * sits far below the usual ~2300 so that a genuinely poor DWD day is still
 * kept and visible rather than quietly dropped.
 */
const MIN_STATIONS = 100

const target = explicit ?? yesterdayInBerlin()
// `since` bounds what the parser keeps; for a single day we also drop anything
// after it, because the archives run right up to the present.
const since = backfill ? null : target

console.log(
  backfill
    ? 'Rückfüllung: alle Tage aus den recent-Archiven'
    : `Zieltag: ${target}`,
)

/* -------------------------------------------------------------------------- */
/* Collect                                                                    */
/* -------------------------------------------------------------------------- */

/** date -> station id -> CSV line. The inner map is what makes kl win over rr. */
const byDate = new Map()
const seenStations = new Map()
let skippedForeign = 0

function collect(network) {
  return (id, station, days) => {
    if (!station) return
    if (!GERMAN_STATES.has(station.state)) {
      skippedForeign++
      return
    }

    let kept = 0
    for (const row of days) {
      if (!backfill && row.date !== target) continue

      let dayRows = byDate.get(row.date)
      if (!dayRows) byDate.set(row.date, (dayRows = new Map()))
      // The two networks overlap in 483 stations. The climate record carries
      // every parameter, so it must not be overwritten by the rain-only one.
      if (network === 'rr' && dayRows.has(id)) continue

      dayRows.set(id, formatRow(id, row))
      kept++
    }

    if (kept > 0) {
      seenStations.set(id, {
        id,
        network: seenStations.get(id)?.network ?? network,
        name: station.name,
        state: station.state,
        lat: station.lat,
        lon: station.lon,
        elevation: station.elevation,
      })
    }
  }
}

const started = Date.now()

for (const network of ['kl', 'rr']) {
  const label = network === 'kl' ? 'Klimastationen' : 'Niederschlagsstationen'
  process.stdout.write(`${label} … `)
  const { ids, failed } = await fetchNetwork(network, {
    since,
    onRows: collect(network),
  })
  const note = failed.length > 0 ? `, ${failed.length} nicht erreichbar` : ''
  console.log(`${ids.length} Archive${note}`)
  if (failed.length > 0 && failed.length <= 5) {
    for (const f of failed) console.log(`    ${f.id}: ${f.error}`)
  }
}

if (byDate.size === 0) {
  console.error(
    `\nKeine Messwerte für ${target}. Der DWD aktualisiert die Tagesarchive` +
      ' am Vormittag — vor etwa 09:00 UTC ist der Vortag noch nicht enthalten.',
  )
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

const known = readStations()
for (const [id, station] of seenStations) known.set(id, station)
writeStations([...known.values()])

const dates = [...byDate.keys()].sort()
const usable = dates.filter((d) => byDate.get(d).size >= MIN_STATIONS)
const sparse = dates.length - usable.length

let written = 0
for (const date of usable) written += writeDay(date, [...byDate.get(date).values()])

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(
  `\n${usable.length} Tag(e) geschrieben, ${written.toLocaleString('de-DE')} Messwerte,` +
    ` ${known.size.toLocaleString('de-DE')} Stationen im Register (${secs} s).`,
)
if (skippedForeign > 0) {
  console.log(`${skippedForeign} Stationen außerhalb Deutschlands übergangen.`)
}
if (sparse > 0) {
  console.log(`${sparse} Tag(e) mit weniger als ${MIN_STATIONS} Stationen ausgelassen.`)
}
if (usable.length > 1) {
  console.log(
    `Zeitraum: ${usable[0]} bis ${usable.at(-1)} · Archiv umfasst nun ${listDays().length} Tage.`,
  )
}
if (usable.length === 0) {
  console.error(`Kein Tag erreichte ${MIN_STATIONS} Stationen — nichts geschrieben.`)
  process.exit(1)
}
