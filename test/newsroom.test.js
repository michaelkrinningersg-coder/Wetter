import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The newsroom's currency took three attempts. These tests hold the third one
 * in place: a statement that is true on hundreds of days a year must never
 * outrank a record, and a quiet day has to be able to prove it looked.
 */

const db = await freshArchive()
const { newsroom, newsroomDates } = await import('../server/newsroom.js')

/**
 * Forty years of flat weather, so anything the newsroom finds was put there on
 * purpose. Frost only ever in January, which makes "days since the last frost"
 * a near-certainty in summer — exactly the statement that once led an edition.
 */
function flatYears(station, from, to, overrides = {}) {
  const rows = []
  for (let year = from; year <= to; year++) {
    for (const date of days(`${year}-01-01`, `${year}-12-31`)) {
      const month = Number(date.slice(5, 7))
      rows.push({
        date,
        temp_mean: month === 1 ? -2 : 12,
        temp_max: month === 1 ? 1 : 16,
        temp_min: month === 1 ? -5 : 8,
        precipitation: 2,
        wind_max: 5,
        snow: 0,
        sunshine: 5,
        pressure: 1013,
      })
    }
  }
  for (const row of rows) Object.assign(row, overrides[row.date] ?? {})
  seed(db, station, rows)
  return rows
}

test('a statement that holds on most days of the year is never published', () => {
  flatYears('CALM', 1980, 2019)
  const edition = newsroom('CALM', '2019-07-15')

  for (const item of edition.items) {
    assert.ok(
      item.perYear < edition.threshold,
      `„${item.headline}" mit ${item.perYear} Tagen im Jahr steht über der Schwelle`,
    )
  }
  const since = edition.items.find((i) => i.key === 'streak_no_frost')
  assert.equal(since, undefined, 'im Juli ist Frostfreiheit keine Meldung')
})

test('an unremarkable day is quiet and says how close the nearest rule came', () => {
  const edition = newsroom('CALM', '2019-07-15')
  assert.equal(edition.quiet, true, 'ein völlig durchschnittlicher Tag hat keine Meldung')
  assert.ok(edition.candidates > 0, 'es wurden Kandidaten geprüft')
  assert.ok(edition.nearest, 'der knappste Kandidat muss genannt werden')
  assert.ok(
    edition.nearest.perYear >= edition.threshold,
    'der knappste Kandidat liegt per Definition über der Schwelle',
  )
  assert.ok(edition.checked.calendar > 0 && edition.checked.streaks > 0)
})

test('a calendar-day record is rare enough to be published — in a long series', () => {
  // Only in a long one: with forty years on record a date record happens about
  // nine times a year and the currency rightly keeps it out. With a hundred and
  // fifty it is 2.4 times a year and gets in.
  flatYears('RECORD', 1870, 2019, {
    '2019-07-16': { temp_max: 38, temp_mean: 30, temp_min: 22 },
  })
  const edition = newsroom('RECORD', '2019-07-16')

  assert.equal(edition.quiet, false)
  const record = edition.items.find((i) => i.category === 'kalendertag')
  assert.ok(record, 'der wärmste 16. Juli der Reihe muss gemeldet werden')
  assert.match(record.headline, /16\. Juli/)
  assert.ok(record.perYear < edition.threshold)
})

test('the rarest item leads, whatever category it comes from', () => {
  const edition = newsroom('RECORD', '2019-07-16')
  for (let i = 1; i < edition.items.length; i++) {
    assert.ok(
      edition.items[i - 1].perYear <= edition.items[i].perYear,
      'die Meldungen stehen nicht nach Seltenheit sortiert',
    )
  }
})

test('editions exist for the last year of the archive and no further', () => {
  const dates = newsroomDates('CALM')
  assert.equal(dates.length, 365)
  assert.equal(dates[0], '2019-12-31', 'die jüngste Ausgabe zuerst')
  assert.equal(dates[dates.length - 1], '2019-01-01', 'und genau ein Jahr zurück')

  // Asking for a day the static build never wrote falls back to the newest
  // edition rather than answering only in the live server.
  const stray = newsroom('CALM', '1985-03-03')
  assert.equal(stray.date, '2019-12-31')
})

test('every source names the span it rests on, and the gaps are listed', () => {
  const edition = newsroom('CALM')
  const station = edition.sources.find((s) => s.key === 'station')
  assert.ok(station, 'die Messreihe muss als Quelle geführt werden')
  assert.equal(station.from, '1980-01-01')
  assert.ok(edition.limits.length >= 2, 'die ausgelassenen Quellen müssen benannt sein')
  assert.ok(edition.limits.some((l) => /pegel/i.test(l)))
})
