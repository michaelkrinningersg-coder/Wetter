import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * The nationwide day and the station's standing in it. Two rules matter and
 * neither is visible in the numbers: the podium is kept twice, once over all
 * stations and once below a thousand metres — without that the cold pole of
 * Germany is a mountain top every single day — and the percentile counts ties
 * as half, because the DWD publishes one decimal and a calm day puts a hundred
 * stations on the same figure.
 */

const db = await freshArchive()
const { LOWLAND_LIMIT, superlatives } = await import('../server/germany.js')
const { nationalField } = await import('../server/national.js')

/**
 * A date and station ids the real archive cannot contain.
 *
 * `germany.js` reads the committed day files into the table when it is
 * imported, and that archive starts in January 2025. A fixture dated inside it
 * would be judged against two thousand genuine stations.
 */
const DATE = '2019-06-01'

function seedStations(list) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO germany_stations (id, network, name, state, lat, lon, elevation)
    VALUES (@id, 'kl', @name, @state, @lat, @lon, @elevation)
  `)
  const write = db.transaction((rows) => {
    for (const row of rows) insert.run({ state: 'Testland', lat: 51, lon: 10, ...row })
  })
  write(list)
}

function seedDay(date, values) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO germany_daily
      (date, station_id, temp_mean, temp_max, temp_min, precipitation, wind_max,
       wind_mean, sunshine, cloud, pressure, humidity, snow)
    VALUES (@date, @station_id, @temp_mean, @temp_max, @temp_min, @precipitation,
            @wind_max, null, null, null, null, null, null)
  `)
  const write = db.transaction((rows) => {
    for (const row of rows) {
      insert.run({
        date,
        temp_mean: null,
        temp_max: null,
        temp_min: null,
        precipitation: null,
        wind_max: null,
        ...row,
      })
    }
  })
  write(values)
}

test('the podium is kept twice, and the mountain only wins the unrestricted one', () => {
  seedStations([
    { id: 'ZZPEAK', name: 'Gipfel', elevation: 2960 },
    { id: 'ZZFLAT', name: 'Ebene', elevation: 120 },
    { id: 'ZZHILL', name: 'Hügel', elevation: 400 },
  ])
  seedDay(DATE, [
    { station_id: 'ZZPEAK', temp_min: -8, temp_max: 2, temp_mean: -3 },
    { station_id: 'ZZFLAT', temp_min: 12, temp_max: 26, temp_mean: 19 },
    { station_id: 'ZZHILL', temp_min: 9, temp_max: 22, temp_mean: 15 },
  ])

  const day = superlatives(DATE)
  assert.ok(day, 'kein Tag berechnet')
  assert.equal(day.lowlandLimit, LOWLAND_LIMIT)
  assert.equal(day.stations.total, 3)
  assert.equal(day.stations.lowland, 2)

  const cold = day.categories.find((c) => c.key === 'coldest_min')
  assert.equal(cold.all.top[0].station_id, 'ZZPEAK', 'ohne Höhengrenze gewinnt der Berg')
  assert.equal(cold.lowland.top[0].station_id, 'ZZHILL', 'im Flachland der kälteste Ort darunter')
  assert.equal(cold.lowlandDiffers, true, 'der Unterschied muss gemeldet werden')
})

test('a category where the mountain does not win reports no difference', () => {
  const day = superlatives(DATE)
  const warm = day.categories.find((c) => c.key === 'warmest_max')
  assert.equal(warm.all.top[0].station_id, 'ZZFLAT')
  assert.equal(warm.lowland.top[0].station_id, 'ZZFLAT')
  assert.equal(warm.lowlandDiffers, false)
})

test('a hundred stations sharing one figure put the station in the middle, not at the top', () => {
  // Ninety-nine stations at exactly 20 °C and the home station at the same
  // value. Any ranking that counted ties as "below" would call that the 99th
  // percentile. The station id is the real one because `national.js` asks about
  // exactly that station — the *dates* are what keeps the fixture out of the
  // genuine archive.
  const stations = [{ id: '01691', name: 'Prüfstation', elevation: 150 }]
  for (let i = 0; i < 99; i++) stations.push({ id: `ZZS${i}`, name: `Ort ${i}`, elevation: 150 })
  seedStations(stations)

  const rows = stations.map((s) => ({ station_id: s.id, temp_max: 20, temp_mean: 15, temp_min: 10 }))
  seedDay('2019-07-01', rows)

  const field = nationalField('temp_max')
  const point = field.all.points.find((p) => p.date === '2019-07-01')
  assert.ok(point, 'kein Tag im Bundesvergleich')
  assert.equal(point.total, 100)
  assert.ok(
    Math.abs(point.percentile - 50) < 1,
    `Perzentil ${point.percentile} statt der Mitte bei lauter gleichen Werten`,
  )
})

test('a station that beats every other lands at the top of the scale', () => {
  seedDay('2019-07-02', [
    { station_id: '01691', temp_max: 38, temp_mean: 30, temp_min: 22 },
    { station_id: 'ZZS0', temp_max: 20, temp_mean: 15, temp_min: 10 },
    { station_id: 'ZZS1', temp_max: 21, temp_mean: 16, temp_min: 11 },
  ])

  const point = nationalField('temp_max').all.points.find((p) => p.date === '2019-07-02')
  assert.equal(point.rank, 1)
  assert.equal(point.total, 3)
  // Under midranking even the winner does not reach a hundred: it counts the
  // two stations below it plus half of the one it ties with — itself. With
  // three stations that is 83 %, with two thousand it is 99.98 %.
  assert.ok(Math.abs(point.percentile - (100 * 2.5) / 3) < 1e-9, `Perzentil ${point.percentile}`)
  assert.ok(point.percentile > 80)
})

test('a day nobody measured returns nothing rather than an empty podium', () => {
  assert.equal(superlatives('1899-01-01'), null)
})
