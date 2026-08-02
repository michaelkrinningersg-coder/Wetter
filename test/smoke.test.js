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

/**
 * The nationwide analyses are exercised here rather than against a fixture:
 * they read the committed CSV archive at import, and rebuilding ninety-three
 * thousand days of it in a temporary directory would test the fixture more than
 * the code. What is asserted is what must hold whatever the archive says.
 */
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
  ['dashboard', async () => (await import('../server/dashboard.js')).dashboard()],
  ['spanAnalysis', async () => (await import('../server/nationwide.js')).spanAnalysis()],
  ['lapseAnalysis', async () => (await import('../server/nationwide.js')).lapseAnalysis()],
  ['gradientAnalysis', async () => (await import('../server/nationwide.js')).gradientAnalysis()],
  ['extremePoints', async () => (await import('../server/nationwide.js')).extremePoints()],
  ['nationalOverview', async () => (await import('../server/national.js')).nationalOverview()],
  ['regionalBalance', async () => (await import('../server/regional.js')).regionalBalance('temp_mean')],
  ['airOverview', async () => (await import('../server/air.js')).airOverview()],
  ['phenology', async () => (await import('../server/pheno.js')).phenoOverview()],
  ['pollen', async () => (await import('../server/pollen.js')).pollenOverview()],
  ['radiation', async () => (await import('../server/odl.js')).odlOverview()],
  ['notable', async () => (await import('../server/germany.js')).notableOverview()],
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

test('die Deutschlandtage ordnen jeden Tag genau einer Quelle zu', { skip }, async () => {
  const { spanAnalysis, lapseAnalysis } = await import('../server/nationwide.js')
  const span = spanAnalysis()
  assert.ok(span.range.days > 0)
  assert.ok(span.range.counted <= span.range.days, 'mehr gezählte als vorhandene Tage')

  for (const scope of span.scopes) {
    for (const year of scope.annual) {
      assert.ok(year.days > 0, `${year.year}: Jahr ohne Tage`)
      assert.ok(year.maxAbsSpan >= year.absSpan, 'das Maximum liegt unter dem Mittel')
      assert.ok(year.stations >= span.range.minStations, `${year.year}: zu wenige Stationen`)
    }
    for (const day of scope.top.absolute) {
      assert.ok(day.absHi >= day.absLo, `${day.date}: Höchstwert unter dem Tiefstwert`)
      assert.ok(Math.abs(day.absSpan - (day.absHi - day.absLo)) < 1e-6)
    }
  }

  const lapse = lapseAnalysis()
  for (const bin of lapse.histogram) {
    assert.ok(bin.share >= 0 && bin.share <= 1, `Anteil ${bin.share}`)
  }
  const total = lapse.histogram.reduce((sum, bin) => sum + bin.share, 0)
  assert.ok(Math.abs(total - 1) < 0.01, `die Verteilung summiert sich auf ${total}`)
})

test('das Dashboard verlinkt nur Ansichten, die es gibt', { skip }, async () => {
  const { dashboard } = await import('../server/dashboard.js')
  const board = dashboard()

  assert.ok(board.station.id)
  if (board.latest?.rank) {
    assert.ok(
      board.latest.rank.place >= 1 && board.latest.rank.place <= board.latest.rank.of,
      'der Platz des letzten Messtags liegt außerhalb seines Feldes',
    )
  }
  if (board.year) {
    assert.ok(board.year.place >= 1 && board.year.place <= board.year.of)
    assert.ok(board.year.days > 0)
  }
  for (const entry of board.ticker ?? []) {
    assert.ok(entry.days > 0, `${entry.label} steht mit null Tagen im Ticker`)
    assert.ok(entry.perYear > 0)
  }
  if (board.newsroom) {
    assert.equal(board.newsroom.quiet, board.newsroom.top.length === 0)
  }
})
