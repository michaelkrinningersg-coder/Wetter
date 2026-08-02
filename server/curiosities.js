import { db } from './db.js'

/**
 * The cabinet of curiosities.
 *
 * Every other ranking in this project asks for the largest or the smallest of
 * something. That reliably returns the same twenty days: the 2003 heatwave, the
 * 1929 cold, the storm of 1990. This page asks the questions whose answers are
 * not in any of those lists — the warmest winter day, the coldest summer day,
 * the day that swung eight degrees from the one before, the June morning with
 * frost on the ground.
 *
 * Each entry is a small query with a sentence attached. Nothing here is a
 * record in the usual sense; that is the point.
 */

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const DAY = 86_400_000
const LIMIT = 10

/* -------------------------------------------------------------------------- */
/* One pass over the series                                                   */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT date, year, month, day, strftime('%m-%d', date) AS key,
         temp_mean, temp_max, temp_min, precipitation, snow, pressure, wind_max
  FROM daily WHERE station_id = ? ORDER BY date
`)

/**
 * How many years a calendar day needs before its mean is worth deviating from.
 *
 * The anomalies compare a day with the average of its own calendar day. With
 * ten observations that average is mostly noise and every day looks unusual.
 */
const MIN_YEARS_FOR_MEAN = 30

/** A month needs this much rain before one day's share of it means anything. */
const MIN_MONTH_RAIN = 20

const cache = new Map()

function seriesFor(stationId) {
  const last = db.prepare('SELECT MAX(date) AS last FROM daily WHERE station_id = ?').get(stationId)
  const cacheKey = `${stationId}|${last?.last ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const rows = seriesStmt.all(stationId)
  if (rows.length === 0) {
    cache.set(cacheKey, null)
    return null
  }

  // Derived quantities, in one pass while the rows are still in order.
  const byKey = new Map()
  const monthTotals = new Map()
  let previous = null

  for (const row of rows) {
    row.range =
      row.temp_max !== null && row.temp_min !== null ? row.temp_max - row.temp_min : null

    const consecutive =
      previous &&
      Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`) === DAY
    row.jump =
      consecutive && row.temp_mean !== null && previous.temp_mean !== null
        ? row.temp_mean - previous.temp_mean
        : null
    row.pressureChange =
      consecutive && row.pressure !== null && previous.pressure !== null
        ? row.pressure - previous.pressure
        : null
    row.previousDate = consecutive ? previous.date : null
    row.previousMean = consecutive ? previous.temp_mean : null

    if (row.temp_mean !== null) {
      if (!byKey.has(row.key)) byKey.set(row.key, [])
      byKey.get(row.key).push(row.temp_mean)
    }

    if (row.precipitation !== null) {
      const monthKey = `${row.year}-${row.month}`
      monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + row.precipitation)
    }

    previous = row
  }

  const calendarMean = new Map()
  for (const [key, values] of byKey) {
    if (values.length < MIN_YEARS_FOR_MEAN) continue
    calendarMean.set(key, {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      years: values.length,
    })
  }

  for (const row of rows) {
    const reference = calendarMean.get(row.key)
    row.calendarMean = reference?.mean ?? null
    row.calendarYears = reference?.years ?? null
    row.anomaly =
      reference && row.temp_mean !== null ? row.temp_mean - reference.mean : null

    const total = monthTotals.get(`${row.year}-${row.month}`) ?? 0
    row.monthRain = total
    row.rainShare =
      row.precipitation !== null && total >= MIN_MONTH_RAIN ? row.precipitation / total : null
  }

  const index = { rows, first: rows[0].date, last: rows.at(-1).date }
  cache.set(cacheKey, index)
  return index
}

/* -------------------------------------------------------------------------- */
/* The questions                                                              */
/* -------------------------------------------------------------------------- */

const label = (row) => `${row.day}. ${MONTHS[row.month - 1]} ${row.year}`

/**
 * Eleven questions whose answers appear in no ordinary record list.
 *
 * `pick` returns the value being ranked, or null when the day cannot answer the
 * question at all. `detail` builds the second line — the context that turns a
 * number into a small story. `signed` marks the differences, where the sign is
 * half the statement: −17,0 K is not the same fact as 17,0 K.
 */
const QUESTIONS = [
  {
    key: 'widest_range',
    title: 'Größter Tagesgang',
    note: 'Die Spanne zwischen Höchst- und Tiefstwert desselben Tages. Klare Strahlungstage im Frühjahr, wenn der Boden noch kalt und die Sonne schon stark ist.',
    unit: 'K',
    decimals: 1,
    accent: 'dry',
    direction: 'max',
    pick: (r) => r.range,
    detail: (r) => `${fmt(r.temp_min, 1)} °C bis ${fmt(r.temp_max, 1)} °C`,
  },
  {
    key: 'narrowest_range',
    title: 'Kleinster Tagesgang',
    note: 'Tage, an denen sich die Temperatur praktisch nicht bewegte — dichte Bewölkung, Wind und oft Nieselregen.',
    unit: 'K',
    decimals: 1,
    accent: 'cool',
    direction: 'min',
    pick: (r) => r.range,
    detail: (r) => `${fmt(r.temp_min, 1)} °C bis ${fmt(r.temp_max, 1)} °C`,
  },
  {
    key: 'jump_up',
    title: 'Größter Sprung nach oben',
    note: 'Wie weit das Tagesmittel von einem Tag zum nächsten stieg. Nur über echte Nachbartage gerechnet — über eine Archivlücke hinweg wäre der Sprung erfunden.',
    unit: 'K',
    decimals: 1,
    accent: 'hot',
    direction: 'max',
    signed: true,
    pick: (r) => r.jump,
    detail: (r) => `von ${fmt(r.previousMean, 1)} °C auf ${fmt(r.temp_mean, 1)} °C`,
  },
  {
    key: 'jump_down',
    title: 'Größter Sturz nach unten',
    note: 'Dieselbe Rechnung in der anderen Richtung.',
    unit: 'K',
    decimals: 1,
    accent: 'cold',
    direction: 'min',
    signed: true,
    pick: (r) => r.jump,
    detail: (r) => `von ${fmt(r.previousMean, 1)} °C auf ${fmt(r.temp_mean, 1)} °C`,
  },
  {
    key: 'warm_winter',
    title: 'Wärmster Wintertag',
    note: 'Höchstwerte im Dezember, Januar und Februar. Diese Tage stehen in keiner Hitzeliste und sind trotzdem außergewöhnlich.',
    unit: '°C',
    decimals: 1,
    accent: 'warm',
    direction: 'max',
    pick: (r) => ([12, 1, 2].includes(r.month) ? r.temp_max : null),
    detail: (r) => `Tagesmittel ${fmt(r.temp_mean, 1)} °C`,
  },
  {
    key: 'cold_summer',
    title: 'Kältester Sommertag',
    note: 'Der tiefste Höchstwert im Juni, Juli und August — Tage, an denen der Sommer schlicht ausfiel.',
    unit: '°C',
    decimals: 1,
    accent: 'cool',
    direction: 'min',
    pick: (r) => ([6, 7, 8].includes(r.month) ? r.temp_max : null),
    detail: (r) => `Tagesmittel ${fmt(r.temp_mean, 1)} °C, nachts ${fmt(r.temp_min, 1)} °C`,
  },
  {
    key: 'summer_frost',
    title: 'Frost im Sommer',
    note: 'Ein Minimum unter null zwischen Juni und August. Über eine ganze Messreihe hinweg bleiben davon meist nur eine Handvoll Tage übrig — wie viele es hier sind, steht unter der Liste.',
    unit: '°C',
    decimals: 1,
    accent: 'cold',
    direction: 'min',
    pick: (r) => ([6, 7, 8].includes(r.month) && r.temp_min !== null && r.temp_min < 0 ? r.temp_min : null),
    detail: (r) => `Höchstwert am selben Tag ${fmt(r.temp_max, 1)} °C`,
  },
  {
    key: 'late_snow',
    title: 'Schnee außerhalb der Saison',
    note: 'Eine geschlossene Schneedecke von Mai bis September.',
    unit: 'cm',
    decimals: 0,
    accent: 'cool',
    direction: 'max',
    pick: (r) => (r.month >= 5 && r.month <= 9 && r.snow !== null && r.snow > 0 ? r.snow : null),
    detail: (r) => `Tagesmittel ${fmt(r.temp_mean, 1)} °C`,
  },
  {
    key: 'warm_anomaly',
    title: 'Weiteste Abweichung nach oben',
    note: 'Wie weit ein Tag über dem Mittel seines eigenen Kalendertages lag. Ein warmer Februartag schlägt hier jeden Hochsommertag.',
    unit: 'K',
    decimals: 1,
    accent: 'hot',
    direction: 'max',
    signed: true,
    pick: (r) => r.anomaly,
    detail: (r) =>
      `${fmt(r.temp_mean, 1)} °C statt der üblichen ${fmt(r.calendarMean, 1)} °C aus ${r.calendarYears} Jahren`,
  },
  {
    key: 'cold_anomaly',
    title: 'Weiteste Abweichung nach unten',
    note: 'Dieselbe Rechnung in der anderen Richtung.',
    unit: 'K',
    decimals: 1,
    accent: 'cold',
    direction: 'min',
    signed: true,
    pick: (r) => r.anomaly,
    detail: (r) =>
      `${fmt(r.temp_mean, 1)} °C statt der üblichen ${fmt(r.calendarMean, 1)} °C aus ${r.calendarYears} Jahren`,
  },
  {
    key: 'downpour_share',
    title: 'Ein Tag, der den Monat machte',
    note: `Der größte Anteil eines einzelnen Tages am Niederschlag seines Monats — gezählt erst ab ${MIN_MONTH_RAIN} mm im Monat, sonst gewänne ein Nieselregen in einem sonst regenlosen Februar.`,
    unit: '%',
    decimals: 0,
    accent: 'wet',
    direction: 'max',
    pick: (r) => (r.rainShare === null ? null : r.rainShare * 100),
    detail: (r) =>
      `${fmt(r.precipitation, 1)} mm von ${fmt(r.monthRain, 1)} mm im ${MONTHS[r.month - 1]}`,
  },
  {
    key: 'pressure_drop',
    title: 'Größter Druckfall an einem Tag',
    note: 'Die stärkste Änderung des Stationsdrucks binnen 24 Stunden — die Unterschrift eines durchziehenden Sturmtiefs.',
    unit: 'hPa',
    decimals: 1,
    accent: 'brand',
    direction: 'min',
    signed: true,
    pick: (r) => r.pressureChange,
    detail: (r) =>
      `auf ${fmt(r.pressure, 1)} hPa${r.wind_max !== null ? `, Bö ${fmt(r.wind_max * 3.6, 0)} km/h` : ''}`,
  },
]

function fmt(value, digits) {
  return value === null || value === undefined
    ? '—'
    : value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export const CURIOSITY_KEYS = QUESTIONS.map((q) => q.key)

export function curiosities(stationId) {
  const index = seriesFor(stationId)
  if (!index) return null

  const sections = QUESTIONS.map((question) => {
    // Only the value here — the sentence is built for the ten that survive.
    // Formatting all of them first cost twenty-seven seconds, almost all of it
    // inside `toLocaleString` on rows nobody would ever read.
    const entries = []
    for (const row of index.rows) {
      const value = question.pick(row)
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      entries.push({ row, value })
    }

    entries.sort((a, b) => (question.direction === 'max' ? b.value - a.value : a.value - b.value))

    return {
      key: question.key,
      title: question.title,
      note: question.note,
      unit: question.unit,
      decimals: question.decimals,
      accent: question.accent,
      direction: question.direction,
      signed: question.signed === true,
      found: entries.length,
      days: entries.slice(0, LIMIT).map(({ row, value }) => ({
        date: row.date,
        label: label(row),
        value,
        detail: question.detail(row),
      })),
    }
  }).filter((section) => section.days.length > 0)

  return {
    station: stationId,
    range: { first: index.first, last: index.last, days: index.rows.length },
    limit: LIMIT,
    minYearsForMean: MIN_YEARS_FOR_MEAN,
    minMonthRain: MIN_MONTH_RAIN,
    sections,
  }
}
