import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import express from 'express'

import * as api from './queries.js'
import { getImportState, isImporting } from './db.js'
import { importStation } from './dwd.js'
import { STATIONS, findStation, recentUrl } from './stations.js'

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
