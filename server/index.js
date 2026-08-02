import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import express from 'express'

import * as api from './queries.js'
import { getImportState, isImporting } from './db.js'
import { importStation } from './dwd.js'
import { STATIONS, findStation, recentUrl } from './stations.js'
import {
  GAUGES,
  findGauge,
  gaugeSeries,
  gaugeSummary,
  refreshAll,
} from './gauges.js'
import {
  archiveRange,
  availableDates,
  germanyMap,
  germanyStationRegister,
  notableOverview,
  superlatives,
} from './germany.js'
import { recordCount, recordDays, recordRange, recordSpread, recordsForDate } from './records.js'
import {
  extremePoints,
  gradientAnalysis,
  lapseAnalysis,
  nationwideOverview,
  shapeForDate,
  spanAnalysis,
} from './nationwide.js'
import { regionalMeta, regionalSeries } from './regional.js'
import { airComponentKeys, airOverview, airProfiles } from './air.js'
import { odlOverview } from './odl.js'
import { pollenOverview } from './pollen.js'
import { comboSeries, phenoOverview } from './pheno.js'
import { dashboard } from './dashboard.js'
import { NATIONAL_FIELD_KEYS, nationalField, nationalOverview } from './national.js'
import { pressureAnalysis } from './pressure.js'
import { frostRiskAll } from './frost.js'
import { distributionOverview } from './distribution.js'
import { recordAges, recordCalendar, recordVintages } from './calendar-records.js'

const here = dirname(fileURLToPath(import.meta.url))
const app = express()

app.disable('x-powered-by')

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve `?stationId=` to a known station.
 *
 * The original interpolated the raw query value straight into SQL string
 * literals and accepted anything, so an unknown id silently returned an empty
 * result set instead of a 400.
 */
function resolveStation(req, res) {
  const station = findStation(req.query.stationId)
  if (!station) {
    res.status(400).json({
      error: `Unbekannte Station "${req.query.stationId ?? ''}".`,
    })
    return null
  }
  return station
}

/** Wrap a handler so a thrown error becomes a JSON 500 instead of a hang. */
const handler = (fn) => (req, res, next) => {
  try {
    const result = fn(req, res)
    if (result instanceof Promise) result.catch(next)
  } catch (error) {
    next(error)
  }
}

/* -------------------------------------------------------------------------- */
/* Stations, status, import                                                   */
/* -------------------------------------------------------------------------- */

app.get('/api/stations', (_req, res) => {
  res.json(
    STATIONS.map((s) => ({
      id: s.id,
      name: s.name,
      altitude: s.altitude,
      recentUrl: recentUrl(s.id),
    })),
  )
})

app.get(
  '/api/status',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return
    res.json({ ...getImportState(station.id), ...api.getBounds(station.id) })
  }),
)

app.post(
  '/api/import',
  handler(async (req, res) => {
    const station = resolveStation(req, res)
    if (!station) return

    // Concurrent imports of the same station would fight over the same rows.
    if (isImporting(station.id)) {
      return res
        .status(409)
        .json({ error: 'Für diese Station läuft bereits ein Import.' })
    }

    try {
      res.json(await importStation(station.id))
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : 'Der DWD-Server war nicht erreichbar.',
      })
    }
  }),
)

/* -------------------------------------------------------------------------- */
/* Weather data                                                               */
/* -------------------------------------------------------------------------- */

const simple = {
  '/api/weather/trends/temp': api.tempTrend,
  '/api/weather/trends/precip': api.precipTrend,
  '/api/weather/annual-means': api.annualMeans,
  '/api/weather/heatmap': api.heatmap,
  '/api/weather/climate-diagram': api.climateDiagram,
  '/api/weather/comparisons': api.comparisons,
  '/api/weather/ytd-temp': api.ytdTemperatures,
  '/api/weather/annual-overview': api.annualOverview,
  '/api/weather/vegetation': api.vegetation,
  '/api/weather/coverage': api.coverage,
  '/api/weather/seasons': api.seasons,
  '/api/weather/records-balance': api.recordBalance,
  '/api/weather/precip-intensity': api.precipIntensity,
  '/api/weather/indices': api.extraIndices,
  '/api/weather/pressure': pressureAnalysis,
  '/api/weather/frost-risk': frostRiskAll,
  '/api/weather/distribution': distributionOverview,
  '/api/weather/record-ages': recordAges,
  '/api/weather/record-calendar': recordCalendar,
  '/api/weather/record-vintages': recordVintages,
}

for (const [path, query] of Object.entries(simple)) {
  app.get(
    path,
    handler((req, res) => {
      const station = resolveStation(req, res)
      if (!station) return
      res.json(query(station.id))
    }),
  )
}

app.get(
  '/api/weather/forecast',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return
    const forecast = api.buildForecast(station.id)
    if (!forecast) {
      return res.status(404).json({
        error:
          'Für diese Station fehlen die historischen Messreihen, die für eine Prognose nötig sind.',
      })
    }
    res.json(forecast)
  }),
)

app.get(
  '/api/weather/monthly',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return

    const year = Number(req.query.year)
    const month = Number(req.query.month)
    if (!Number.isInteger(year) || year < 1700 || year > 2200) {
      return res.status(400).json({ error: 'Ungültiges Jahr.' })
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Ungültiger Monat.' })
    }

    res.json(api.monthlyDetail(station.id, year, month))
  }),
)

app.get(
  '/api/weather/day-in-history',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return

    const now = new Date()
    const month = Number(req.query.month ?? now.getMonth() + 1)
    const day = Number(req.query.day ?? now.getDate())
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Ungültiger Monat.' })
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'Ungültiger Tag.' })
    }

    res.json(api.dayInHistory(station.id, month, day))
  }),
)

app.get(
  '/api/weather/spells',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return
    const result = api.spells(station.id, String(req.query.kind ?? ''))
    if (result === null) {
      return res.status(400).json({
        error: `Unbekannte Periodenart "${req.query.kind ?? ''}". Erlaubt: ${api.SPELL_KEYS.join(', ')}.`,
      })
    }
    res.json(result)
  }),
)

app.get(
  '/api/weather/extremes',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return
    const rows = api.extremeDays(station.id, String(req.query.category ?? ''))
    if (rows === null) {
      return res
        .status(400)
        .json({ error: `Unbekannte Kategorie "${req.query.category ?? ''}".` })
    }
    res.json(rows)
  }),
)

app.get(
  '/api/weather/extreme-months',
  handler((req, res) => {
    const station = resolveStation(req, res)
    if (!station) return
    const rows = api.extremeMonths(station.id, String(req.query.category ?? ''))
    if (rows === null) {
      return res
        .status(400)
        .json({ error: `Unbekannte Kategorie "${req.query.category ?? ''}".` })
    }
    res.json(rows)
  }),
)

/* -------------------------------------------------------------------------- */
/* River gauges                                                               */
/* -------------------------------------------------------------------------- */

/** Days of history the gauge views may request. */
function gaugeDays(req) {
  const days = Number(req.query.days ?? 30)
  return Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : 30
}

app.get(
  '/api/gauges',
  handler(async (req, res) => {
    // Readings come from two remote sources; refreshing on read keeps the view
    // current without a scheduler, and the ten-minute cache in gauges.js stops
    // a reload from hammering either of them.
    if (req.query.refresh !== 'false') {
      await refreshAll({ force: req.query.refresh === 'force' })
    }
    const days = gaugeDays(req)
    res.json({ days, gauges: GAUGES.map((g) => gaugeSummary(g, days)) })
  }),
)

app.get(
  '/api/gauges/:id/series',
  handler((req, res) => {
    const gauge = findGauge(req.params.id)
    if (!gauge) {
      return res.status(400).json({ error: `Unbekannter Pegel "${req.params.id}".` })
    }
    const days = gaugeDays(req)
    res.json({ id: gauge.id, days, readings: gaugeSeries(gauge, days) })
  }),
)

app.post(
  '/api/gauges/refresh',
  handler(async (_req, res) => res.json({ results: await refreshAll({ force: true }) })),
)

/* -------------------------------------------------------------------------- */
/* Germany-wide superlatives                                                  */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/germany',
  handler((req, res) => {
    const range = archiveRange()
    if (!range.last) {
      return res.json({
        range,
        dates: [],
        day: null,
        // A clone that has never run the collector has an empty archive; the
        // view says so instead of rendering eight empty cards.
        hint: 'Noch keine Deutschlandwerte im Archiv. Einmal `npm run fetch:germany -- --backfill` ausführen.',
      })
    }

    const requested = req.query.date
    if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(requested))) {
      return res.status(400).json({ error: `Ungültiges Datum "${requested}".` })
    }

    const date = String(requested ?? range.last)
    const day = superlatives(date)
    if (!day) {
      return res.status(404).json({ error: `Für den ${date} liegen keine Werte vor.` })
    }

    // The count travels with the day so the view can flag a record without a
    // second request; the list itself lives on its own page.
    res.json({ range, dates: availableDates(), day, records: recordCount(date) })
  }),
)

app.get(
  '/api/germany/notable',
  handler((_req, res) => res.json(notableOverview())),
)

app.get(
  '/api/germany/stations',
  handler((_req, res) => res.json(germanyStationRegister())),
)

app.get(
  '/api/germany/map',
  handler((req, res) => {
    const range = archiveRange()
    if (!range.last) return res.json({ range, dates: [], day: null })

    const requested = req.query.date
    if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(requested))) {
      return res.status(400).json({ error: `Ungültiges Datum "${requested}".` })
    }

    const date = String(requested ?? range.last)
    const day = germanyMap(date)
    if (!day) return res.status(404).json({ error: `Für den ${date} liegen keine Werte vor.` })

    res.json({ range, dates: availableDates(), day, shape: shapeForDate(date) })
  }),
)

/* -------------------------------------------------------------------------- */
/* The shape of a German day                                                  */
/* -------------------------------------------------------------------------- */

/*
 * No station parameter: these are statements about the country, not about a
 * station, so they are the same answer for every visitor and every selection.
 */
for (const [path, query] of [
  ['/api/nationwide', nationwideOverview],
  ['/api/nationwide/span', spanAnalysis],
  ['/api/nationwide/lapse', lapseAnalysis],
  ['/api/nationwide/gradient', gradientAnalysis],
  ['/api/nationwide/extremes', extremePoints],
]) {
  app.get(
    path,
    handler((_req, res) => {
      res.json(query())
    }),
  )
}

/* -------------------------------------------------------------------------- */
/* All-time station records                                                   */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/records',
  handler((req, res) => {
    const range = recordRange()
    const days = recordDays()

    if (days.length === 0) {
      return res.json({
        range,
        days: [],
        day: null,
        hint:
          'Noch keine Rekordbasis. Einmal `npm run fetch:records` ausführen —' +
          ' das liest die historischen DWD-Archive und legt die Allzeitwerte an.',
      })
    }

    const requested = req.query.date
    if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(requested))) {
      return res.status(400).json({ error: `Ungültiges Datum "${requested}".` })
    }

    // Without a date the newest day that actually saw a record is shown —
    // landing on an empty page would be the common case otherwise.
    const date = String(requested ?? days[0].date)
    const events = recordsForDate(date)
    res.json({ range, days, day: { date, events, spread: recordSpread(events) } })
  }),
)

/* -------------------------------------------------------------------------- */
/* Areal means for Germany and the federal states                             */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/regional',
  handler((req, res) => {
    const meta = regionalMeta()
    if (meta.parameters.length === 0) {
      return res.json({
        ...meta,
        series: null,
        hint:
          'Noch keine Gebietsmittel im Archiv. Einmal `npm run fetch:regional` ausführen.',
      })
    }

    const first = meta.parameters[0]
    const parameter = String(req.query.parameter ?? first.key)
    const known = meta.parameters.find((p) => p.key === parameter)
    if (!known) {
      return res.status(400).json({ error: `Unbekannte Größe "${parameter}".` })
    }

    // 'year' where a parameter has it, otherwise its first available period —
    // the day-count parameters exist annually only.
    const period = String(
      req.query.period ?? (known.periods.includes('year') ? 'year' : known.periods[0]),
    )
    if (!known.periods.includes(period)) {
      return res.status(400).json({
        error: `Größe "${parameter}" gibt es nicht für "${period}". Verfügbar: ${known.periods.join(', ')}.`,
      })
    }

    res.json({ ...meta, series: regionalSeries(parameter, period) })
  }),
)

/* -------------------------------------------------------------------------- */
/* Air quality                                                                */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/air',
  handler((_req, res) => {
    const overview = airOverview()
    if (!overview.range.last) {
      return res.json({
        ...overview,
        hint:
          'Noch keine Luftmesswerte im Archiv. Einmal `npm run fetch:air -- --backfill`' +
          ' ausführen — das holt die Stundenwerte beider Göttinger Stationen ab 2016.',
      })
    }
    res.json(overview)
  }),
)

app.get(
  '/api/air/profiles',
  handler((req, res) => {
    const keys = airComponentKeys()
    if (keys.length === 0) {
      return res.status(503).json({ error: 'Noch keine Luftmesswerte im Archiv.' })
    }

    const component = String(req.query.component ?? keys[0])
    const profiles = airProfiles(component)
    if (!profiles) {
      return res.status(400).json({
        error: `Unbekannte Größe "${component}". Verfügbar: ${keys.join(', ')}.`,
      })
    }
    res.json(profiles)
  }),
)

/* -------------------------------------------------------------------------- */
/* Gamma dose rate                                                            */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/radiation',
  handler((req, res) => {
    // The window is capped: the archive grows by 264 hourly values a day, and
    // an uncapped request would eventually ship years of them to draw a chart
    // thirty days wide.
    const requested = Number(req.query.days)
    const days = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 365) : 30

    const overview = odlOverview({ days })
    if (!overview.range.last) {
      return res.json({
        ...overview,
        hint:
          'Noch keine Messwerte im Archiv. Einmal `npm run fetch:odl` ausführen —' +
          ' das holt das Sieben-Tage-Fenster des BfS für die Sonden um Göttingen.',
      })
    }
    res.json(overview)
  }),
)

/* -------------------------------------------------------------------------- */
/* Pollen                                                                     */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/pollen',
  handler((_req, res) => {
    const overview = pollenOverview()
    if (!overview.range.last) {
      return res.json({
        ...overview,
        hint:
          'Noch keine Ausgabe im Archiv. Einmal `npm run fetch:pollen` ausführen —' +
          ' das holt die aktuelle DWD-Vorhersage für die Region Niedersachsen.',
      })
    }
    res.json(overview)
  }),
)

/* -------------------------------------------------------------------------- */
/* Phenology                                                                  */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/phenology',
  handler((_req, res) => {
    const overview = phenoOverview()
    if (!overview.range.last) {
      return res.json({
        ...overview,
        hint:
          'Noch keine Beobachtungen im Archiv. Einmal `npm run fetch:phenology`' +
          ' ausführen — das liest die historischen DWD-Dateien im Strom und hält' +
          ' die Meldungen aus dem Umkreis fest.',
      })
    }
    res.json(overview)
  }),
)

app.get(
  '/api/phenology/series',
  handler((req, res) => {
    const plant = Number(req.query.plant)
    const phase = Number(req.query.phase)
    if (!Number.isInteger(plant) || !Number.isInteger(phase)) {
      return res.status(400).json({ error: 'plant und phase müssen ganze Zahlen sein.' })
    }

    const series = comboSeries(plant, phase)
    if (!series) {
      return res.status(404).json({
        error: `Keine Beobachtungen für Pflanze ${plant} in Phase ${phase}.`,
      })
    }
    res.json(series)
  }),
)

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/dashboard',
  handler((_req, res) => res.json(dashboard())),
)

/* -------------------------------------------------------------------------- */
/* National standing                                                          */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/national',
  handler((_req, res) => res.json(nationalOverview())),
)

app.get(
  '/api/national/field',
  handler((req, res) => {
    const key = String(req.query.field ?? NATIONAL_FIELD_KEYS[0])
    const result = nationalField(key)
    if (!result) {
      return res.status(400).json({
        error: `Unbekannte Größe "${key}". Verfügbar: ${NATIONAL_FIELD_KEYS.join(', ')}.`,
      })
    }
    res.json(result)
  }),
)

/* -------------------------------------------------------------------------- */
/* Static build (production)                                                  */
/* -------------------------------------------------------------------------- */

const dist = join(here, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

/* -------------------------------------------------------------------------- */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt.' }))

// Express erkennt einen Fehlerbehandler an der Stelligkeit — die vier
// Parameter müssen stehen bleiben, auch wenn zwei ungenutzt sind.
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({
    error: error instanceof Error ? error.message : 'Interner Serverfehler.',
  })
})

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`Wetterstation-API läuft auf http://localhost:${port}`)
})
