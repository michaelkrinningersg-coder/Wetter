import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * The tolerant half: this file runs against the *real* archive and therefore
 * may not assert a single measured value — the collectors add a day every
 * morning, and a test that pinned "the record is thirteen days" would go red on
 * its own. What it does assert is what must hold whatever the data say: every
 * endpoint answers, nothing is NaN, and no rank claims a place outside its own
 * field.
 *
 * NaN is worth a test of its own because `JSON.stringify` turns it into `null`.
 * A division by an empty count would therefore reach the browser disguised as a
 * missing value and be drawn as a gap in a chart rather than reported.
 */

const { db } = await import('../server/db.js')

const station = db
  .prepare('SELECT station_id AS id, COUNT(*) AS n FROM daily GROUP BY station_id ORDER BY n DESC')
  .get()

const skip = station
  ? false
  : 'kein Archiv vorhanden — `npm run import:stations` füllt es'

/** Every finite-number check the endpoints have to survive. */
function scan(value, path, found) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) found.push(`${path} = ${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, at) => scan(entry, `${path}[${at}]`, found))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) scan(entry, `${path}.${key}`, found)
  }
}

const ENDPOINTS = [
  ['annualMeans', async (id) => (await import('../server/queries.js')).annualMeans(id)],
  ['heatmap', async (id) => (await import('../server/queries.js')).heatmap(id)],
  ['seasons', async (id) => (await import('../server/queries.js')).seasons(id)],
  ['precipIntensity', async (id) => (await import('../server/queries.js')).precipIntensity(id)],
  ['pressure', async (id) => (await import('../server/pressure.js')).pressureAnalysis(id)],
  ['frostRisk', async (id) => (await import('../server/frost.js')).frostRiskAll(id)],
  ['distribution', async (id) => (await import('../server/distribution.js')).distributionOverview(id)],
  ['curiosities', async (id) => (await import('../server/curiosities.js')).curiosities(id)],
  ['recordAges', async (id) => (await import('../server/calendar-records.js')).recordAges(id)],
  ['recordSurvival', async (id) => (await import('../server/calendar-records.js')).recordSurvival(id)],
  ['nearMisses', async (id) => (await import('../server/calendar-records.js')).nearMisses(id)],
  ['episodes', async (id) => (await import('../server/episodes.js')).episodes(id, 'heat')],
  ['ticker', async (id) => (await import('../server/ticker.js')).ticker(id)],
  ['monthBalance', async (id) => (await import('../server/month-balance.js')).monthBalance(id, 7)],
  ['newsroom', async (id) => (await import('../server/newsroom.js')).newsroom(id)],
  ['yearbook', async (id) => (await import('../server/yearbook.js')).yearbook(id)],
  ['twins', async (id) => (await import('../server/twins.js')).weatherTwins(id)],
]

for (const [name, run] of ENDPOINTS) {
  test(`${name} antwortet und liefert nur endliche Zahlen`, { skip }, async () => {
    const result = await run(station.id)
    assert.ok(result, `${name} lieferte nichts`)

    const found = []
    scan(result, name, found)
    assert.deepEqual(found, [], `nicht-endliche Zahlen in ${name}`)
  })
}

test('Ränge liegen innerhalb ihres eigenen Feldes', { skip }, async () => {
  const { recordAges } = await import('../server/calendar-records.js')
  const ages = recordAges(station.id)
  for (const field of ages.fields) {
    assert.ok(field.allTime.observations >= 1, `${field.key}: keine Beobachtungen`)
    assert.ok(
      field.allTime.years >= 0,
      `${field.key}: negatives Alter des stehenden Rekords`,
    )
    for (const month of field.monthly) {
      assert.ok(month.month >= 1 && month.month <= 12)
    }
  }
})

test('der Newsroom veröffentlicht nichts über seiner eigenen Schwelle', { skip }, async () => {
  const { newsroom, newsroomDates } = await import('../server/newsroom.js')
  const dates = newsroomDates(station.id)
  assert.ok(dates.length > 0)

  // Ten editions spread over the window, not just the newest.
  const step = Math.max(1, Math.floor(dates.length / 10))
  for (let at = 0; at < dates.length; at += step) {
    const edition = newsroom(station.id, dates[at])
    for (const item of edition.items) {
      assert.ok(
        item.perYear > 0 && item.perYear < edition.threshold,
        `${edition.date}: „${item.headline}" mit ${item.perYear} Tagen im Jahr`,
      )
    }
    if (edition.quiet) assert.ok(edition.nearest, `${edition.date}: stille Ausgabe ohne Begründung`)
  }
})

test('die Monatsbilanz ordnet nur ein, was genug Messtage hat', { skip }, async () => {
  const { monthBalance } = await import('../server/month-balance.js')
  for (const month of [1, 4, 7, 10]) {
    const result = monthBalance(station.id, month)
    for (const field of result.fields) {
      for (const entry of field.history) {
        if (entry.rated) {
          assert.ok(entry.days >= result.minMonthDays, `${month}/${entry.year}: zu wenige Tage`)
          assert.ok(entry.rank >= 1 && entry.rank <= entry.total, `${month}/${entry.year}: Rang`)
        } else {
          assert.equal(entry.rank, null, `${month}/${entry.year}: Rang ohne Grundlage`)
        }
      }
    }
  }
})
