#!/usr/bin/env node
/**
 * Write every API answer to a file, so the app can be served by GitHub Pages.
 *
 *   node scripts/prerender.js [zielverzeichnis]     # default: dist
 *
 * Pages serves files, not query strings. This walks the same query functions
 * the Express routes call and materialises each answer at the path
 * `lib/static-path.js` derives — the frontend uses that identical function to
 * decide where to read, so the two cannot drift apart.
 *
 * Two things a static build cannot do, and does not pretend to: importing from
 * the DWD on demand, and refreshing gauges on read. Both buttons are hidden in
 * that mode; the data is as fresh as the last deploy.
 *
 * Unlike the collectors, this one needs the database and therefore the
 * dependencies — it runs after `npm ci` and `npm run build`.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import * as api from '../server/queries.js'
import { STATIONS } from '../server/stations.js'
import { db, getImportState } from '../server/db.js'
import { GAUGES, gaugeSeries, gaugeSummary } from '../server/gauges.js'
import { archiveRange, availableDates, superlatives } from '../server/germany.js'
import { recordCount, recordDays, recordRange, recordsForDate } from '../server/records.js'
import { regionalMeta, regionalPairs, regionalSeries } from '../server/regional.js'
import { staticPath } from '../src/lib/static-path.js'

const outDir = process.argv[2] ?? 'dist'

let files = 0
let bytes = 0
const groups = new Map()

function emit(requestPath, payload, group) {
  const file = join(outDir, staticPath(requestPath))
  mkdirSync(dirname(file), { recursive: true })
  const json = JSON.stringify(payload)
  writeFileSync(file, json, 'utf8')

  files++
  bytes += json.length
  const g = groups.get(group) ?? { files: 0, bytes: 0 }
  g.files++
  g.bytes += json.length
  groups.set(group, g)
}

/* -------------------------------------------------------------------------- */
/* Stations, status                                                           */
/* -------------------------------------------------------------------------- */

const stationList = STATIONS.map((s) => {
  const bounds = api.getBounds(s.id)
  return { ...s, hasData: Boolean(bounds?.minDate) }
})
emit('/api/stations', stationList, 'Stationen')

for (const station of STATIONS) {
  const bounds = api.getBounds(station.id)
  const state = getImportState(station.id)
  emit(
    `/api/status?stationId=${station.id}`,
    {
      rowCount: bounds?.rowCount ?? 0,
      minDate: bounds?.minDate ?? null,
      maxDate: bounds?.maxDate ?? null,
      importInProgress: false,
      lastError: state?.lastError ?? null,
    },
    'Stationen',
  )
}

/* -------------------------------------------------------------------------- */
/* Per-station analyses                                                       */
/* -------------------------------------------------------------------------- */

const SIMPLE = [
  ['annual-means', api.annualMeans],
  ['annual-overview', api.annualOverview],
  ['climate-diagram', api.climateDiagram],
  ['comparisons', api.comparisons],
  ['coverage', api.coverage],
  ['forecast', api.buildForecast],
  ['heatmap', api.heatmap],
  ['precip-intensity', api.precipIntensity],
  ['records-balance', api.recordBalance],
  ['seasons', api.seasons],
  ['trends/precip', api.precipTrend],
  ['trends/temp', api.tempTrend],
  ['vegetation', api.vegetation],
  ['ytd-temp', api.ytdTemperatures],
]

// Taken from the query module, never restated here: a hand-written copy that
// drifts produces a 404 in the browser rather than an error at build time,
// which is exactly how the first version of this script shipped three broken
// tabs.
const DAY_CATEGORIES = api.DAY_CATEGORY_KEYS
const MONTH_CATEGORIES = api.MONTH_CATEGORY_KEYS
const SPELL_KINDS = api.SPELL_KEYS

const monthsStmt = db.prepare(
  'SELECT DISTINCT year, month FROM daily WHERE station_id = ? ORDER BY year, month',
)

for (const station of STATIONS) {
  const id = station.id
  if (!api.getBounds(id)?.minDate) {
    console.warn(`  ${id}: keine Daten, übersprungen`)
    continue
  }

  for (const [route, fn] of SIMPLE) {
    emit(`/api/weather/${route}?stationId=${id}`, fn(id), 'Stationsanalysen')
  }

  for (const category of DAY_CATEGORIES) {
    emit(
      `/api/weather/extremes?category=${category}&stationId=${id}`,
      api.extremeDays(id, category),
      'Spitzenwerte',
    )
  }

  for (const category of MONTH_CATEGORIES) {
    emit(
      `/api/weather/extreme-months?category=${category}&stationId=${id}`,
      api.extremeMonths(id, category),
      'Spitzenmonate',
    )
  }

  for (const kind of SPELL_KINDS) {
    emit(`/api/weather/spells?kind=${kind}&stationId=${id}`, api.spells(id, kind), 'Perioden')
  }

  for (const { year, month } of monthsStmt.all(id)) {
    emit(
      `/api/weather/monthly?year=${year}&month=${month}&stationId=${id}`,
      api.monthlyDetail(id, year, month),
      'Monatsansicht',
    )
  }

  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= 31; day++) {
      let payload
      try {
        payload = api.dayInHistory(id, month, day)
      } catch {
        // 31 February and friends.
        continue
      }
      emit(
        `/api/weather/day-in-history?month=${month}&day=${day}&stationId=${id}`,
        payload,
        'Dieser Tag',
      )
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Gauges                                                                     */
/* -------------------------------------------------------------------------- */

// The views ask for these windows only.
const GAUGE_DAYS = [1, 7, 30]

emit(
  '/api/gauges?days=30',
  { days: 30, gauges: GAUGES.map((g) => gaugeSummary(g, 30)) },
  'Pegel',
)
for (const gauge of GAUGES) {
  for (const days of GAUGE_DAYS) {
    emit(
      `/api/gauges/${gauge.id}/series?days=${days}`,
      { id: gauge.id, days, readings: gaugeSeries(gauge, days) },
      'Pegel',
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Germany and records                                                        */
/* -------------------------------------------------------------------------- */

const range = archiveRange()
const dates = availableDates()

if (range.last) {
  for (const date of dates) {
    const payload = {
      range,
      dates,
      day: superlatives(date),
      records: recordCount(date),
    }
    emit(`/api/germany?date=${date}`, payload, 'Deutschland')
    // The view's first request carries no date at all.
    if (date === range.last) emit('/api/germany', payload, 'Deutschland')
  }
}

const recRange = recordRange()
const recDays = recordDays()

if (recDays.length > 0) {
  for (const { date } of recDays) {
    const payload = { range: recRange, days: recDays, day: { date, events: recordsForDate(date) } }
    emit(`/api/records?date=${date}`, payload, 'Rekorde')
    if (date === recDays[0].date) emit('/api/records', payload, 'Rekorde')
  }
}

/* -------------------------------------------------------------------------- */
/* Areal means                                                                */
/* -------------------------------------------------------------------------- */

const meta = regionalMeta()
if (meta.parameters.length > 0) {
  const firstParam = meta.parameters[0]
  const defaultPeriod = firstParam.periods.includes('year') ? 'year' : firstParam.periods[0]

  for (const { parameter, period } of regionalPairs()) {
    const payload = { ...meta, series: regionalSeries(parameter, period) }
    emit(`/api/regional?parameter=${parameter}&period=${period}`, payload, 'Gebietsmittel')
    // The view's first request names neither.
    if (parameter === firstParam.key && period === defaultPeriod) {
      emit('/api/regional', payload, 'Gebietsmittel')
      emit(`/api/regional?parameter=${parameter}`, payload, 'Gebietsmittel')
    }
  }
}

/* -------------------------------------------------------------------------- */

console.log(`\nGruppe                 Dateien       Größe`)
console.log('─'.repeat(45))
for (const [name, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(
    name.padEnd(20) + String(g.files).padStart(9) + (g.bytes / 1048576).toFixed(1).padStart(10) + ' MB',
  )
}
console.log('─'.repeat(45))
console.log(
  'Summe'.padEnd(20) + String(files).padStart(9) + (bytes / 1048576).toFixed(1).padStart(10) + ' MB',
)
console.log(`\nGeschrieben nach ${outDir}/api/`)
