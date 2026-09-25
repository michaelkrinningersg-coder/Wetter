import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { listDays, readDay, readStations } from '../server/germany-csv.js'
import { readSoil, writeSoil } from '../server/soil-csv.js'

/**
 * The archives must read the same on a machine that uses CRLF.
 *
 * This is written down because it cost a release. Git checks this repository
 * out with CRLF line endings on Windows, which is where the installer is
 * built. `readStations` split the last column of `stations.csv` without
 * stripping the carriage return, so the header's last name came out as
 * "elevation\r" and every lookup of `elevation` found nothing. The altitudes
 * were all null.
 *
 * Nothing said so. The station count was right, the day count was right, and
 * the damage surfaced two tables away: the nationwide loader only accepts
 * stations whose altitude is known, so it dropped all 552 recent days and
 * reported "92.924 Tage (0 aus dem Tagesarchiv)" — a line that looks like an
 * ordinary number unless you know the other one.
 *
 * `.gitattributes` now keeps git's hands off `data/`, and the readers split on
 * /\r?\n/ so they no longer depend on that. This file tests the second half:
 * hand the readers CRLF on purpose and see that nothing is lost.
 */

/** Write `text` with every newline turned into a carriage return plus newline. */
function writeCrlf(path, text) {
  writeFileSync(path, text.replaceAll('\n', '\r\n'), 'utf8')
}

test('a station register with CRLF keeps its last column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wetter-crlf-'))
  writeCrlf(
    join(dir, 'stations.csv'),
    'id,network,name,state,lat,lon,elevation\n' +
      '01691,kl,Göttingen,Niedersachsen,51.5001,9.9506,167\n' +
      '00722,kl,Brocken,Sachsen-Anhalt,51.7986,10.6183,1141\n',
  )

  const stations = readStations(dir)
  assert.equal(stations.size, 2)

  // The altitude is the last column, and therefore the one a carriage return
  // eats. Every one of these three has to be a usable number.
  const göttingen = stations.get('01691')
  assert.equal(göttingen.elevation, 167)
  assert.equal(göttingen.lat, 51.5001)
  assert.equal(stations.get('00722').elevation, 1141)

  // And the text columns must not carry an invisible passenger: a name ending
  // in \r sorts and compares differently from the same name without one.
  assert.equal(göttingen.name, 'Göttingen')
  assert.equal(göttingen.state, 'Niedersachsen')
  assert.equal(göttingen.network, 'kl')
})

test('a day file with CRLF keeps its last column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wetter-crlf-day-'))
  mkdirSync(join(dir, '2026'), { recursive: true })
  writeCrlf(
    join(dir, '2026', '2026-08-01.csv'),
    'station_id,temp_mean,temp_max,temp_min,precipitation,wind_max,wind_mean,' +
      'sunshine,cloud,pressure,humidity,snow\n' +
      '01691,21.4,28.1,14.9,0.0,8.2,3.1,11.5,2.1,1013.2,64.0,0\n',
  )

  assert.deepEqual(listDays(dir), ['2026-08-01'])

  const rows = readDay('2026-08-01', dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].station_id, '01691')
  assert.equal(rows[0].temp_mean, 21.4)
  // `snow` is last. Zero and null mean different things here — no snow, versus
  // nobody looked — so it has to survive as the number it is.
  assert.equal(rows[0].snow, 0)
})

test('the soil archive reads back what a CRLF writer left', () => {
  /*
   * The directory is passed, not set through the environment.
   *
   * `soil-csv.js` resolves `SOIL_DATA_DIR` once, at import — so setting the
   * variable inside a test is too late, and the first version of this test
   * wrote its fixture straight into the committed archive and overwrote a real
   * measured day with invented numbers. Every one of these readers takes the
   * directory as an argument; using it cannot miss.
   */
  const dir = mkdtempSync(join(tmpdir(), 'wetter-crlf-soil-'))

  writeSoil('moisture', [
    { date: '2026-08-01', bf_total: 43.1, evap_potential: 3.2, evap_real: 1.1, frost_depth: 0 },
  ], dir)

  // Rewrite the file the way a Windows checkout would hand it over.
  const path = join(dir, 'moisture.csv')
  writeCrlf(path, readFileSync(path, 'utf8'))

  const rows = readSoil('moisture', dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].date, '2026-08-01')
  assert.equal(rows[0].bf_total, 43.1)
  assert.equal(rows[0].frost_depth, 0)
})
