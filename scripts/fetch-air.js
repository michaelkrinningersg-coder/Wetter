#!/usr/bin/env node
/**
 * Collect hourly air quality for the two Göttingen stations and write it to the
 * CSV archive.
 *
 *   node scripts/fetch-air.js              # the last few days
 *   node scripts/fetch-air.js 2026-07-28   # one specific day
 *   node scripts/fetch-air.js --backfill   # 2016-01-01 to yesterday
 *
 * The default is a short rolling window rather than yesterday alone, because
 * the UBA revises recent hours: a value fetched the morning after is
 * provisional and can still change while the measurement is being checked.
 * Re-reading the last few days each run lets those corrections land. Days whose
 * content has not changed produce a byte-identical file and no commit.
 *
 * `--backfill` is worth running once. Nine series over a decade is roughly
 * 830,000 hourly values and takes well under a minute; afterwards the daily run
 * only ever touches the current window.
 *
 * Depends on nothing outside the Node standard library.
 */

import { ARCHIVE_START, fetchRange, seriesList } from '../server/air-sources.js'
import { listDays, readDay, writeDay } from '../server/air-csv.js'

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2)
const backfill = args.includes('--backfill')
const explicit = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

/** How many days back the routine run re-reads, to pick up revised values. */
const WINDOW_DAYS = 7

function berlinDate(offsetDays = 0) {
  const at = new Date(Date.now() - offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

const to = explicit ?? berlinDate(1)
const from = explicit ?? (backfill ? ARCHIVE_START : berlinDate(WINDOW_DAYS))

console.log(
  backfill
    ? `Rückfüllung: ${from} bis ${to}`
    : explicit
      ? `Zieltag: ${to}`
      : `Zeitraum: ${from} bis ${to} (${WINDOW_DAYS} Tage, wegen nachträglicher Prüfung)`,
)

/* -------------------------------------------------------------------------- */
/* Collect                                                                    */
/* -------------------------------------------------------------------------- */

const started = Date.now()
const total = seriesList().length
let done = 0

const byDate = await fetchRange(from, to, {
  onProgress: ({ station, component, values }) => {
    done++
    console.log(
      `  [${String(done).padStart(2)}/${total}] ${station.id} ${component.short.padEnd(6)}` +
        ` ${values.toLocaleString('de-DE').padStart(7)} Werte`,
    )
  },
})

const dates = Object.keys(byDate).sort()
if (dates.length === 0) {
  console.error(
    `\nKeine Messwerte für ${from}…${to}. Das UBA veröffentlicht die Stunden` +
      ' eines Tages im Lauf des Folgetags.',
  )
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

let written = 0
let values = 0
let changed = 0

for (const date of dates) {
  const rows = byDate[date]

  // Compare against what is already on disk so the summary reports actual
  // changes rather than files touched — during the rolling window most days
  // are re-read unchanged, and a run that says "7 days written" every morning
  // tells the reader nothing.
  const before = JSON.stringify(readDay(date).map((r) => ({ ...r, date: undefined })))
  writeDay(date, rows)
  const after = JSON.stringify(readDay(date).map((r) => ({ ...r, date: undefined })))
  if (before !== after) changed++

  written++
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key !== 'station' && key !== 'hour' && Number.isFinite(value)) values++
    }
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(
  `\n${written} Tag(e) geschrieben, davon ${changed} verändert;` +
    ` ${values.toLocaleString('de-DE')} Messwerte (${secs} s).`,
)
console.log(
  `Zeitraum ${dates[0]} bis ${dates.at(-1)} · Archiv umfasst nun ${listDays().length} Tage.`,
)
