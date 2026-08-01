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
import { archiveRange, availableDates, superlatives } from './germany.js'
import { recordCount, recordDays, recordRange, recordsForDate } from './records.js'
import { regionalMeta, regionalSeries } from './regional.js'

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
    res.json({ range, days, day: { date, events: recordsForDate(date) } })
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
/* Static build (production)                                                  */
/* -------------------------------------------------------------------------- */

const dist = join(here, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

/* -------------------------------------------------------------------------- */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt.' }))

// eslint-disable-next-line no-unused-vars
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
