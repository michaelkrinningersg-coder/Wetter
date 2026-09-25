/**
 * Build `data/weather.sqlite` from scratch, so the installer can carry it.
 *
 * This is the minute that used to be spent on every user's machine, on every
 * first start: 1.3 million rows out of the CSV archive, 93,000 nationwide
 * days, ten years of hourly air quality, and the rest. Measured at 59.6
 * seconds here, and considerably longer on a laptop.
 *
 * Run once per release, on the build runner. Two things happen:
 *
 *  1. Importing `server/index.js` is enough for everything that comes out of
 *     the repository — every archive module mirrors its CSVs into SQLite at
 *     import time. It does not start a listener; that only happens when the
 *     file is run directly.
 *  2. The three station archives are downloaded, because they are not in the
 *     repository at all — they come from the DWD and are the one part of the
 *     app that would otherwise be empty until the first collector run.
 *
 * Everything here is data the app would fetch by itself anyway. Shipping it
 * only means the program is useful the moment it opens rather than a few
 * minutes later.
 */

// No collectors: this builds from what is already on disk, plus the three
// station downloads below, and nothing else.
process.env.WETTER_NO_SCHEDULE = '1'

const started = Date.now()

await import('../server/index.js')

const { STATIONS } = await import('../server/stations.js')
const { importStation } = await import('../server/dwd.js')

for (const station of STATIONS) {
  try {
    const result = await importStation(station.id)
    console.log(
      `${station.name}: ${result.newRecordsCount.toLocaleString('de-DE')} Messtage bis ${result.newMaxDate}`,
    )
  } catch (error) {
    // A station the DWD did not hand over is a thinner database, not a broken
    // release — the app downloads it on first run like it always did.
    console.warn(`${station.name}: ${error instanceof Error ? error.message : error}`)
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Check the result before it is shipped.
 *
 * The first release built this way went out with a table quietly short of a
 * year and a half: git checks out this repository's CSVs with CRLF endings on
 * Windows, `readStations` kept the carriage return in the last column name, so
 * every station's altitude landed as null — and the nationwide loader, which
 * needs an altitude, dropped all 552 recent days without a word. Every step
 * reported success.
 *
 * Nothing above can be trusted to fail loudly, so the counts are checked here.
 * A release that has lost a table is a worse outcome than a release that did
 * not happen.
 */
const { db } = await import('../server/db.js')

const EXPECTED = [
  ['daily', 150_000, 'Stationsarchive'],
  ['germany_daily', 1_000_000, 'Deutschlandwerte'],
  ['germany_stations', 2_000, 'Stationsregister'],
  ['nationwide_daily', 93_000, 'Deutschlandtage'],
  ['regional_values', 100_000, 'Gebietsmittel'],
  ['record_events', 500, 'Allzeitrekorde'],
  ['air_hourly', 150_000, 'Luftqualität'],
  ['soil_moisture', 12_000, 'Bodenfeuchte'],
  ['soil_temperature', 15_000, 'Bodentemperatur'],
  ['pheno_observations', 30_000, 'Phänologie'],
]

console.log('\nUmfang:')
const missing = []
for (const [table, least, label] of EXPECTED) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  const ok = n >= least
  console.log(
    `  ${ok ? '·' : '!'} ${label.padEnd(18)} ${n.toLocaleString('de-DE').padStart(11)}` +
      (ok ? '' : `  — erwartet mindestens ${least.toLocaleString('de-DE')}`),
  )
  if (!ok) missing.push(label)
}

/*
 * The altitudes are checked separately because their loss is what caused the
 * incident: the row count was right, the column was empty, and the damage
 * appeared two tables away.
 */
const withoutElevation = db
  .prepare('SELECT COUNT(*) AS n FROM germany_stations WHERE elevation IS NULL')
  .get().n
const stations = db.prepare('SELECT COUNT(*) AS n FROM germany_stations').get().n
if (withoutElevation > stations / 2) {
  console.log(`  ! Stationshöhen       ${withoutElevation.toLocaleString('de-DE')} von ${stations} ohne Höhe`)
  missing.push('Stationshöhen')
}

if (missing.length > 0) {
  console.error(`\nAbbruch: ${missing.join(', ')} unvollständig.`)
  process.exit(1)
}

console.log(`\nDatenbank aufgebaut in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exit(0)
