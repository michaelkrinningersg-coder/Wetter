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

console.log(`\nDatenbank aufgebaut in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exit(0)
