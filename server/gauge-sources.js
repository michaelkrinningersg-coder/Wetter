/**
 * River gauges.
 *
 * Two very different sources, because the gauges sit on different waters:
 *
 *  - The Weser is a federal waterway, so Wahmbeck is served by PEGELONLINE of
 *    the WSV — a documented, key-free REST API that hands out a rolling 30-day
 *    series at 15-minute resolution.
 *  - Leine and Rhume are state waters. Lower Saxony's NLWKN portal publishes
 *    them, but only as a rendered page: the current reading plus the long-term
 *    characteristic values. There is no documented interface and no series, so
 *    the page is parsed for the current value and every reading is written to
 *    the database. The app therefore grows its own series from the day it
 *    starts polling.
 *
 * The portal does expose an internal endpoint, but it carries a subscription
 * key embedded in the public page and never returned the measurements in
 * testing. It is deliberately not used.
 */
export const GAUGES = [
  {
    id: 'leine-goettingen',
    name: 'Göttingen',
    water: 'Leine',
    source: 'nlwkn',
    nlwknId: 280,
    /** Catchment area at the gauge, km². */
    catchment: 633,
  },
  {
    id: 'rhume-northeim',
    name: 'Northeim',
    water: 'Rhume',
    source: 'nlwkn',
    nlwknId: 454,
    catchment: 1176,
  },
  {
    id: 'weser-wahmbeck',
    name: 'Wahmbeck',
    water: 'Weser',
    source: 'pegelonline',
    nlwknId: 102,
    pegelonlineName: 'WAHMBECK',
    catchment: 13000,
  },
]

export const findGauge = (id) => GAUGES.find((g) => g.id === id) ?? null

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                            */
/* -------------------------------------------------------------------------- */

const UA =
  'Wetterstation/1.0 (DWD- und Pegel-Klimaanalyse; Kontakt über das Repository)'

async function fetchText(url, { timeoutMs = 30_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
    })
    if (!res.ok) throw new Error(`${url} antwortete mit HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/g, 'ß')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

/** Flatten an HTML table into `label | value` rows. */
function tableRows(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  const rows = []
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => decodeEntities(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Collapse a doubled string ("X X" -> "X"). */
function dedupe(text) {
  if (!text) return text
  const t = text.trim()
  const half = (t.length - 1) / 2
  if (Number.isInteger(half) && t.slice(0, half) === t.slice(half + 1)) {
    return t.slice(0, half)
  }
  return t
}

/** German decimal notation -> Number. */
function toNumber(text) {
  if (!text) return null
  const m = String(text).match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  return Number(m[0].replace(',', '.'))
}

/** "35 cm / NN + 140,78 m" -> { cm: 35, mNN: 140.78 } */
function levelPair(text) {
  if (!text) return null
  const [left, right] = text.split('/')
  const cm = toNumber(left)
  const mNN = right ? toNumber(right.replace(/NN\s*\+?/i, '')) : null
  return cm === null ? null : { cm, mNN }
}

/**
 * Offset of Europe/Berlin at a given instant, as "+02:00" / "+01:00".
 *
 * The portal prints local German time without a zone. Storing it as-is would
 * put NLWKN readings an hour or two off the PEGELONLINE series, which does
 * carry an offset — and the two would no longer line up on a shared axis.
 */
function berlinOffset(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'longOffset',
  }).formatToParts(date)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00'
  const m = name.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+01:00'
}

/** "31.07.2026 21:30" -> "2026-07-31T21:30:00+02:00". */
function germanToIso(text) {
  const m = String(text ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const [, d, mo, y, h = '00', mi = '00'] = m
  const pad = (v) => String(v).padStart(2, '0')
  const naive = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`
  // Approximate the instant with UTC first; the offset only shifts by an hour,
  // which cannot move the date across a DST boundary in practice.
  return naive + berlinOffset(new Date(`${naive}Z`))
}

/* -------------------------------------------------------------------------- */
/* NLWKN                                                                      */
/* -------------------------------------------------------------------------- */

const NLWKN_URL = (id) =>
  `https://www.pegelonline.nlwkn.niedersachsen.de/Pegel/Binnenpegel/ID/${id}`

/**
 * Scrape one NLWKN gauge page.
 *
 * The portal renders server-side, so the values sit in the markup. That also
 * means the layout can change without notice — every field is therefore
 * optional and a missing one yields null rather than throwing.
 */
export async function fetchNlwkn(gauge) {
  const html = await fetchText(NLWKN_URL(gauge.nlwknId))
  const rows = tableRows(html)

  /** First row whose label matches, returning its value cell. */
  const value = (pattern) => {
    const row = rows.find((r) => pattern.test(r[0]))
    return row?.[1] ?? null
  }
  /** Rows whose label matches, as [label, value] pairs. */
  const all = (pattern) => rows.filter((r) => pattern.test(r[0]))

  const current = levelPair(value(/^Wasserstand:/))
  const measuredAt = germanToIso(value(/^Zeitpunkt:/))

  const thresholds = all(/^Meldestufe \d/).map((r) => ({
    level: toNumber(r[0]),
    ...levelPair(r[1]),
  }))

  // "Wasserstandshauptwerte" carries its period in a separate, label-only row.
  const periodRow = rows.find((r) => /für den Zeitraum von/.test(r[0]))
  const extremeRow = rows.find((r) => /^Extremwerte/.test(r[0]))

  const named = (pattern) => {
    const row = rows.find((r) => pattern.test(r[0]))
    if (!row) return null
    return {
      ...levelPair(row[1]),
      date: germanToIso(row[0]),
      label: row[0].replace(/\s*\(.*?\)\s*:?$/, '').replace(/:$/, '').trim(),
    }
  }

  const extremes = all(/^Hochwasser \d/).map((r) => ({
    ...levelPair(r[1]),
    date: germanToIso(r[0]),
  }))

  const flood = all(/^Überflutungsflächen/).map((r) => ({
    label: (r[0].match(/\((HQ[^)]*)\)/)?.[1] ?? r[0]).trim(),
    ...levelPair(r[1]),
  }))

  return {
    gaugeDatum: toNumber((value(/^Pegelnullpunkt:/) ?? '').replace(/NN\s*\+?/i, '')),
    current: current ? { ...current, measuredAt } : null,
    trend: value(/^Trend:/),
    change: toNumber(value(/^Veränderung:/)),
    currentLevel: toNumber(value(/^Aktuelle Meldestufe:/)),
    thresholds,
    characteristic: {
      period: periodRow?.[0]?.replace(/^für den Zeitraum von\s*/i, '') ?? null,
      lowest: named(/^niedrigster Wasserstand/),
      meanLow: named(/^mittlerer Niedrigwasserstand/),
      mean: named(/^mittlerer Wasserstand/),
      meanHigh: named(/^mittlerer Hochwasserstand/),
      highest: named(/^höchster Wasserstand/),
    },
    extremes: {
      period: extremeRow?.[1]?.replace(/^für den Zeitraum von\s*/i, '') ?? null,
      records: extremes,
    },
    floodScenarios: flood,
    // The operator cell holds the name twice — once as link text, once as
    // plain text — which the tag stripper concatenates.
    operator: dedupe(value(/^Betreiber:/)),
    sourceUrl: NLWKN_URL(gauge.nlwknId),
  }
}

/* -------------------------------------------------------------------------- */
/* PEGELONLINE (WSV)                                                          */
/* -------------------------------------------------------------------------- */

const PEGELONLINE = 'https://pegelonline.wsv.de/webservices/rest-api/v2'

/** Rolling 30-day series at 15-minute resolution. */
export async function fetchPegelonlineSeries(gauge) {
  const text = await fetchText(
    `${PEGELONLINE}/stations/${encodeURIComponent(gauge.pegelonlineName)}/W/measurements.json?start=P30D`,
    { timeoutMs: 60_000 },
  )
  const rows = JSON.parse(text)
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => typeof r.value === 'number' && r.timestamp)
    .map((r) => ({ ts: r.timestamp, value: r.value }))
}
