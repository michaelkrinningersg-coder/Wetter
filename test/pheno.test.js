import assert from 'node:assert/strict'
import test from 'node:test'

import { freshArchive } from './helpers/fixture.js'

/**
 * Phenology: the day of the year on which a plant reached a stage, averaged
 * over the stations that reported it. Two rules keep the series honest — a
 * combination needs twenty years before it is offered at all, and one station
 * reporting twice must not count twice.
 */

const db = await freshArchive()
const { PHENO_SEASONS, phenoCalendar, phenoSeasons, comboSeries } = await import(
  '../server/pheno.js'
)

/** Observations of one plant and phase, one per station and year. */
function seedObservations(entries) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO pheno_observations (station, year, plant, phase, date, julian, quality)
    VALUES (@station, @year, @plant, @phase, @date, @julian, 1)
  `)
  const write = db.transaction((rows) => {
    for (const row of rows) {
      const at = new Date(Date.UTC(row.year, 0, row.julian))
      insert.run({ ...row, date: at.toISOString().slice(0, 10) })
    }
  })
  write(entries)
}

/**
 * Invented plant numbers.
 *
 * `pheno.js` reads the committed observation files into the table when it is
 * imported, so the real seasons already carry a century of reports. A plant
 * that does not exist keeps the arithmetic below to itself.
 */
const PLANT = 9101
const PHASE = 5

test('the day of a year is the mean over the stations that reported it', () => {
  seedObservations([
    { station: 'A', year: 2000, plant: PLANT, phase: PHASE, julian: 60 },
    { station: 'B', year: 2000, plant: PLANT, phase: PHASE, julian: 70 },
    { station: 'C', year: 2000, plant: PLANT, phase: PHASE, julian: 80 },
  ])

  const point = comboSeries(PLANT, PHASE).points.find((p) => p.year === 2000)
  assert.ok(point, 'kein Punkt für 2000')
  assert.equal(point.day, 70, 'das Mittel aus 60, 70 und 80')
  assert.equal(point.reports, 3)
  assert.equal(point.stations, 3)
})

test('one station cannot report the same year twice', () => {
  // The primary key is station, year, plant and phase — a second report
  // replaces the first rather than pulling the mean towards itself.
  seedObservations([
    { station: 'A', year: 2001, plant: PLANT, phase: PHASE, julian: 50 },
    { station: 'A', year: 2001, plant: PLANT, phase: PHASE, julian: 150 },
    { station: 'B', year: 2001, plant: PLANT, phase: PHASE, julian: 150 },
  ])

  const point = comboSeries(PLANT, PHASE).points.find((p) => p.year === 2001)
  assert.equal(point.stations, 2)
  assert.equal(point.reports, 2, 'zwei Meldungen derselben Station sind eine')
  assert.equal(point.day, 150)
})

test('a combination under twenty years is not offered in the calendar', () => {
  const rows = []
  for (let year = 1990; year <= 2008; year++) {
    rows.push({ station: 'A', year, plant: 999, phase: 5, julian: 100 })
  }
  seedObservations(rows)
  assert.equal(
    phenoCalendar().find((c) => c.plant === 999),
    undefined,
    'neunzehn Jahre reichen nicht für eine Zeile im Kalender',
  )

  seedObservations([{ station: 'A', year: 2009, plant: 999, phase: 5, julian: 100 }])
  const entry = phenoCalendar().find((c) => c.plant === 999)
  assert.ok(entry, 'ab zwanzig Jahren gehört die Kombination in den Kalender')
  assert.equal(entry.years, 20)
  assert.equal(entry.first, 1990)
  assert.equal(entry.last, 2009)
})

test('the calendar is ordered by the day of the year, earliest first', () => {
  const rows = []
  for (let year = 1990; year <= 2019; year++) {
    rows.push({ station: 'A', year, plant: 901, phase: 5, julian: 300 })
    rows.push({ station: 'A', year, plant: 902, phase: 5, julian: 40 })
  }
  seedObservations(rows)

  const calendar = phenoCalendar()
  const at = (plant) => calendar.findIndex((c) => c.plant === plant)
  assert.ok(at(902) < at(901), 'der frühere Termin steht nicht vorn')

  let previous = -Infinity
  for (const entry of calendar) {
    assert.ok(entry.day >= previous, 'der Kalender ist nicht nach Tag sortiert')
    previous = entry.day
  }
})

test('every season names the plants and the phase it rests on', () => {
  const seasons = phenoSeasons()
  assert.equal(seasons.length, PHENO_SEASONS.length)
  for (const season of seasons) {
    assert.ok(season.plants.length > 0, `${season.key} ohne Pflanze`)
    assert.ok(season.phase.id > 0)
    assert.equal(season.years, season.points.length)
    for (const point of season.points) {
      assert.ok(point.day > 0 && point.day <= 366, `${season.key}: Tag ${point.day}`)
      assert.ok(point.earliest <= point.day && point.day <= point.latest)
    }
  }
})

test('a combination series comes back for a plant and phase pair', () => {
  const series = comboSeries(902, 5)
  assert.ok(series, 'keine Reihe für die Kombination')
  assert.equal(series.plant, 902)
  assert.equal(series.phase, 5)
  assert.equal(series.points.length, 30)
  assert.equal(series.points[0].day, 40)
  assert.equal(comboSeries(99999, 5), null, 'eine unbekannte Kombination gibt es nicht')
})
