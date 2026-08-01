#!/usr/bin/env node
/**
 * Collect the DWD's official areal means for Germany and its federal states.
 *
 *   node scripts/fetch-regional.js
 *
 * Small and slow-moving: 58 files, a few hundred kilobytes, revised a handful
 * of times a year. Written as one CSV per period so a diff shows which years
 * the DWD actually revised — it does adjust past values when its network or
 * its interpolation changes.
 *
 * Depends on nothing outside the Node standard library.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PERIODS, REGIONAL_PARAMETERS, fetchRegional } from '../server/regional-sources.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.env.REGIONAL_DATA_DIR ?? join(here, '..', 'data', 'regional')

const HEADER = 'region,parameter,period,year,value'

mkdirSync(outDir, { recursive: true })

const started = Date.now()
let total = 0
let fileCount = 0

for (const period of PERIODS) {
  const rows = []
  for (const parameter of REGIONAL_PARAMETERS) {
    const { files, rows: got } = await fetchRegional(period, parameter)
    fileCount += files
    rows.push(...got)
  }

  if (rows.length === 0) {
    console.log(`${period.padEnd(9)} keine Daten`)
    continue
  }

  // Sorted so a re-run produces a byte-identical file and no commit.
  const lines = rows
    .map((r) => `${r.region},${r.parameter},${r.period},${r.year},${r.value}`)
    .sort()

  writeFileSync(join(outDir, `${period}.csv`), `${HEADER}\n${lines.join('\n')}\n`, 'utf8')

  const regions = new Set(rows.map((r) => r.region)).size
  const params = new Set(rows.map((r) => r.parameter)).size
  const years = rows.map((r) => r.year)
  console.log(
    `${period.padEnd(9)} ${String(rows.length).padStart(7)} Werte · ${params} Größen ·` +
      ` ${regions} Gebiete · ${Math.min(...years)}–${Math.max(...years)}`,
  )
  total += rows.length
}

console.log(
  `\n${fileCount} Dateien gelesen, ${total.toLocaleString('de-DE')} Werte geschrieben` +
    ` (${((Date.now() - started) / 1000).toFixed(0)} s).`,
)
