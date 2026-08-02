import assert from 'node:assert/strict'
import test from 'node:test'

import { days, freshArchive, seed } from './helpers/fixture.js'

/**
 * The bridging rule, which is the whole of idea 17 and the part that can most
 * easily be got wrong: a single day below the threshold extends an episode, but
 * it must never create one, and a day nobody measured may not bridge anything.
 */

const db = await freshArchive()
const { episodes } = await import('../server/episodes.js')

/** A year of 10 °C days, with the named dates overridden. */
function year(station, y, overrides) {
  const rows = days(`${y}-01-01`, `${y}-12-31`).map((date) => ({
    date,
    temp_max: 10,
    temp_min: 5,
    temp_mean: 7,
    precipitation: 5,
  }))
  for (const row of rows) Object.assign(row, overrides[row.date] ?? {})
  seed(db, station, rows)
}

test('one day below the threshold extends a heat episode, and both lengths are kept', () => {
  const hot = {}
  // Twelve hot days, one day of 29 °C in the middle, then four more hot days.
  for (const date of days('2001-07-01', '2001-07-12')) hot[date] = { temp_max: 32 }
  hot['2001-07-13'] = { temp_max: 29 }
  for (const date of days('2001-07-14', '2001-07-17')) hot[date] = { temp_max: 32 }
  year('BRIDGE', 2001, hot)

  const result = episodes('BRIDGE', 'heat')
  assert.equal(result.counts.episodes, 1, 'die Lücke darf nicht zwei Episoden ergeben')

  const [episode] = result.strongest
  assert.equal(episode.start, '2001-07-01')
  assert.equal(episode.end, '2001-07-17')
  assert.equal(episode.span, 17, 'Spanne über den überbrückten Tag hinweg')
  assert.equal(episode.core, 12, 'längste ununterbrochene Strecke')
  assert.equal(episode.hits, 16, 'Tage über der Schwelle')
  assert.equal(episode.breaks, 1)
  assert.equal(episode.span, episode.hits + episode.breaks)
})

test('bridging never creates an episode out of two runs that are too short', () => {
  // Two two-day heat spikes around one cool day: five calendar days, but the
  // longest unbroken run is two, and the minimum is three.
  const hot = {}
  for (const date of ['2002-07-01', '2002-07-02', '2002-07-04', '2002-07-05']) {
    hot[date] = { temp_max: 32 }
  }
  hot['2002-07-03'] = { temp_max: 26 }
  year('SHORT', 2002, hot)

  const result = episodes('SHORT', 'heat')
  assert.equal(result.counts.episodes, 0, 'zwei Zweitagesspitzen sind keine Hitzewelle')
})

test('a day without a measurement ends the episode instead of bridging it', () => {
  const hot = {}
  for (const date of days('2003-07-01', '2003-07-05')) hot[date] = { temp_max: 32 }
  hot['2003-07-06'] = { temp_max: null }
  for (const date of days('2003-07-07', '2003-07-11')) hot[date] = { temp_max: 32 }
  year('GAP', 2003, hot)

  const result = episodes('GAP', 'heat')
  assert.equal(result.counts.episodes, 2, 'über eine Messlücke darf nicht überbrückt werden')
  for (const episode of result.strongest) {
    assert.equal(episode.breaks, 0)
    assert.equal(episode.span, episode.core)
  }
})

test('strength counts degree days, so a short hot episode beats a long mild one', () => {
  const hot = {}
  // Four days at 38 °C — 32 degree days above thirty.
  for (const date of days('2004-06-01', '2004-06-04')) hot[date] = { temp_max: 38 }
  // Nine days at 30.5 °C — 4.5 degree days.
  for (const date of days('2004-08-01', '2004-08-09')) hot[date] = { temp_max: 30.5 }
  year('STRONG', 2004, hot)

  const result = episodes('STRONG', 'heat')
  assert.equal(result.counts.episodes, 2)
  const [first, second] = result.strongest
  assert.equal(first.start, '2004-06-01', 'die stärkere Episode gehört nach vorn')
  assert.ok(Math.abs(first.severity - 32) < 1e-6, `Gradtage waren ${first.severity}`)
  assert.equal(first.rank, 1)
  // By length alone the order is the other way round, and that list says so.
  assert.equal(result.longest[0].start, '2004-08-01')
  assert.ok(second.span > first.span)
})

test('the relative definition needs the base period and says so when it is missing', () => {
  year('NOBASE', 2005, {})
  const result = episodes('NOBASE', 'warm')
  assert.ok(result.hint, 'ohne Basisperiode 1961–1990 muss ein Hinweis kommen')
  assert.match(result.hint, /1961/)
  assert.deepEqual(result.strongest, [])
})
