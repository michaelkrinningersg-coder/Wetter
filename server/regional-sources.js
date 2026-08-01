import { Buffer } from 'node:buffer'

/**
 * Official DWD areal means for Germany and its federal states.
 *
 * These are the DWD's own figures, not an aggregation of ours: the service
 * computes them from its full station network with a spatial interpolation we
 * could not reproduce from open daily data. Temperature reaches back to 1881,
 * which is three times the span of any single station series in this project.
 *
 * A caveat worth stating plainly: the file has seventeen columns, not sixteen
 * states plus Germany. Thirteen states appear on their own; Berlin, Hamburg and
 * Bremen never do — they are folded into `Brandenburg/Berlin` and
 * `Niedersachsen/Hamburg/Bremen`. `Thueringen/Sachsen-Anhalt` is a third
 * combination that overlaps two states that are also listed individually. The
 * view has to say so, otherwise a reader adds up regions that share area.
 *
 * Like the other collectors, this module imports no database.
 */

const BASE = 'https://opendata.dwd.de/climate_environment/CDC/regional_averages_DE'

/** Every parameter, with the DWD's short code and the directory holding it. */
export const REGIONAL_PARAMETERS = [
  {
    key: 'temp_mean',
    code: 'tm',
    dir: 'air_temperature_mean',
    label: 'Mitteltemperatur',
    unit: '°C',
    decimals: 1,
    direction: 'warm',
  },
  {
    key: 'precipitation',
    code: 'rr',
    dir: 'precipitation',
    label: 'Niederschlag',
    unit: 'mm',
    decimals: 0,
    direction: 'wet',
  },
  {
    key: 'sunshine',
    code: 'sd',
    dir: 'sunshine_duration',
    label: 'Sonnenscheindauer',
    unit: 'h',
    decimals: 0,
    direction: 'warm',
  },
  {
    key: 'frost_days',
    code: 'tnas',
    dir: 'frost_days',
    label: 'Frosttage',
    unit: 'd',
    decimals: 0,
    direction: 'cold',
  },
  {
    key: 'ice_days',
    code: 'txcs',
    dir: 'ice_days',
    label: 'Eistage',
    unit: 'd',
    decimals: 0,
    direction: 'cold',
  },
  {
    key: 'summer_days',
    code: 'txas',
    dir: 'summer_days',
    label: 'Sommertage',
    unit: 'd',
    decimals: 0,
    direction: 'warm',
  },
  {
    key: 'hot_days',
    code: 'txbs',
    dir: 'hot_days',
    label: 'Heiße Tage',
    unit: 'd',
    decimals: 0,
    direction: 'warm',
  },
  {
    key: 'tropical_nights',
    code: 'tnes',
    dir: 'tropical_nights_tminGE20',
    label: 'Tropennächte',
    unit: 'd',
    decimals: 0,
    direction: 'warm',
  },
  {
    key: 'precip_ge10',
    code: 'rrsfs',
    dir: 'precipGE10mm_days',
    label: 'Tage ab 10 mm',
    unit: 'd',
    decimals: 0,
    direction: 'wet',
  },
  {
    key: 'precip_ge20',
    code: 'rrsgs',
    dir: 'precipGE20mm_days',
    label: 'Tage ab 20 mm',
    unit: 'd',
    decimals: 0,
    direction: 'wet',
  },
]

export const PERIODS = ['annual', 'monthly', 'seasonal']

export const PARAMETER_BY_KEY = new Map(REGIONAL_PARAMETERS.map((p) => [p.key, p]))

/* -------------------------------------------------------------------------- */
/* Fetch                                                                      */
/* -------------------------------------------------------------------------- */

async function fetchText(url, { attempts = 3 } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // DWD serves ISO-8859-1 throughout; the region names carry umlauts.
      return Buffer.from(await res.arrayBuffer()).toString('latin1')
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : last}`)
}

/**
 * Which files a parameter actually has for a period.
 *
 * Read from the directory listing rather than assembled from a hard-coded list
 * of month numbers and season names — not every parameter offers every period,
 * and a guessed filename fails as a 404 at collection time instead of loudly
 * here.
 */
export async function listFiles(period, parameter) {
  const url = `${BASE}/${period}/${parameter.dir}/`
  let html
  try {
    html = await fetchText(url)
  } catch {
    // A parameter that does not exist for this period has no directory at all.
    return []
  }
  const pattern = new RegExp(`regional_averages_${parameter.code}_([a-z0-9]+)\\.txt`, 'g')
  const found = new Map()
  for (const m of html.matchAll(pattern)) found.set(m[1], m[0])
  return [...found.entries()]
    .map(([suffix, file]) => ({ suffix, file, url: url + file }))
    .sort((a, b) => a.suffix.localeCompare(b.suffix))
}

/**
 * Parse one areal-mean file into `{ region, year, period, value }` rows.
 *
 * Line 1 is a comment with the generation date, line 2 the header. The first
 * two columns are the year and the period label; everything after is a region.
 */
export function parseRegional(text) {
  const lines = text.split('\n')
  const header = (lines[1] ?? '').trim().split(';').map((s) => s.trim())
  const regions = header.slice(2).filter(Boolean)

  const rows = []
  for (const raw of lines.slice(2)) {
    const line = raw.trim()
    if (!line) continue
    const cells = line.split(';').map((s) => s.trim())

    const year = Number(cells[0])
    const period = cells[1]
    if (!Number.isFinite(year) || !period) continue

    for (const [i, region] of regions.entries()) {
      const value = Number(cells[i + 2])
      if (!Number.isFinite(value) || value === -999) continue
      rows.push({ region, year, period, value })
    }
  }
  return rows
}

export async function fetchRegional(period, parameter) {
  const files = await listFiles(period, parameter)
  const rows = []
  for (const entry of files) {
    for (const row of parseRegional(await fetchText(entry.url))) {
      rows.push({ ...row, parameter: parameter.key })
    }
  }
  return { files: files.length, rows }
}
