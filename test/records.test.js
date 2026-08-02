import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { freshArchive } from './helpers/fixture.js'

/**
 * All-time records across Germany, and the reach of one day's worth of them.
 * The spread is plain geometry and the place where a forgotten cosine turns
 * seven hundred kilometres into eleven hundred.
 */

await freshArchive()
const { recordSpread } = await import('../server/records.js')
const csv = await import('../server/germany-csv.js')

const event = (name, lat, lon, state = 'Testland', id = name) => ({
  station_id: id,
  name,
  state,
  lat,
  lon,
})

test('the spread measures north-south and west-east in kilometres', () => {
  // One degree of latitude is 111 km; one of longitude at 51° is about 70.
  const spread = recordSpread([
    event('Süd', 50, 10),
    event('Nord', 51, 10),
    event('Ost', 50.5, 11),
  ])

  assert.equal(spread.located, 3)
  assert.equal(spread.stations, 3)
  assert.ok(Math.abs(spread.northSouth - 111) < 2, `Nord-Süd ${spread.northSouth}`)
  assert.ok(
    Math.abs(spread.westEast - 111 * Math.cos((50.5 * Math.PI) / 180)) < 2,
    `West-Ost ${spread.westEast} — der Cosinus fehlt`,
  )
  assert.ok(spread.westEast < spread.northSouth, 'ein Längengrad ist bei uns kürzer')
})

test('the widest pair is the pair, not the bounding box', () => {
  const spread = recordSpread([
    event('Flensburg', 54.8, 9.4),
    event('Garmisch', 47.5, 11.1),
    event('Mitte', 51, 10),
  ])
  assert.ok(spread.widest, 'kein weitester Abstand')
  const pair = [spread.widest.from, spread.widest.to].sort()
  assert.deepEqual(pair, ['Flensburg', 'Garmisch'])
  assert.ok(spread.widest.km > 800, `nur ${spread.widest.km} km zwischen den beiden`)
})

test('states are counted once each, however many records they hold', () => {
  const spread = recordSpread([
    event('A', 50, 10, 'Bayern', 'A'),
    event('B', 50.1, 10.1, 'Bayern', 'B'),
    event('C', 52, 9, 'Niedersachsen', 'C'),
  ])
  assert.equal(spread.states, 2)
  assert.equal(spread.stations, 3)
})

test('events without coordinates are excluded rather than placed at nought', () => {
  const spread = recordSpread([
    event('Bekannt', 51, 10),
    { station_id: 'X', name: 'Ohne Ort', state: 'Testland', lat: null, lon: null },
  ])
  assert.equal(spread.located, 1, 'eine Station ohne Koordinaten darf nicht mitgemessen werden')
  assert.equal(spread.northSouth, 0)
  assert.equal(spread.widest, null, 'ein einzelner Punkt hat kein Paar')
})

test('a day without located events has no spread at all', () => {
  assert.equal(recordSpread([]), null)
})

/* -------------------------------------------------------------------------- */
/* The day archive the record replay reads                                    */
/* -------------------------------------------------------------------------- */

test('a day file survives the round trip, and an empty field stays empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wetter-germany-'))
  const lines = [
    csv.formatRow('01691', { temp_mean: 12.34, temp_max: 18.9, temp_min: 5.5, precipitation: 0 }),
    csv.formatRow('05792', { temp_mean: -3.2, temp_max: null, temp_min: -8.1 }),
  ]
  csv.writeDay('2025-05-05', lines, dir)

  const back = csv.readDay('2025-05-05', dir)
  assert.equal(back.length, 2)

  const first = back.find((r) => r.station_id === '01691')
  assert.equal(first.temp_max, 18.9)
  assert.equal(first.precipitation, 0, 'null Millimeter sind eine Messung, kein fehlender Wert')

  const second = back.find((r) => r.station_id === '05792')
  // An absent parameter is left off the row entirely rather than set to null:
  // the caller distinguishes "not reported" from "reported as nought" by the
  // presence of the key.
  assert.equal('temp_max' in second, false, 'ein fehlender Wert darf nicht auftauchen')
  assert.equal(second.temp_min, -8.1)

  assert.deepEqual(csv.listDays(dir), ['2025-05-05'])
  assert.deepEqual(csv.readDay('1999-01-01', dir), [])
})
