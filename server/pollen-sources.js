/**
 * Pollen forecast for the Göttingen region, from the DWD.
 *
 * The service publishes one file for all of Germany, once a day around 11:00,
 * holding today and the next two days for eight kinds of pollen in 27 regions.
 * There is **no archive**: tomorrow's file replaces today's and the previous
 * one is gone. Like the gamma dose rate, everything this project has beyond the
 * current file exists because the collector ran.
 *
 * Which region Göttingen belongs to is not stated in the data. The DWD splits
 * Lower Saxony into "Westl. Niedersachsen/Bremen" and "Östl. Niedersachsen",
 * and Göttingen sits in the south-east, so the eastern part is the reading that
 * fits. Rather than commit to it in the archive, **both** parts of region 30 are
 * written: sixteen rows a day instead of eight, and the assignment stays
 * reversible if the assumption turns out wrong.
 *
 * Keeping all three horizons — today, tomorrow, the day after — costs almost
 * nothing and buys a question the DWD's own file cannot answer: how well a
 * two-day-ahead forecast matches what was said when the day arrived.
 *
 * Depends on nothing outside the Node standard library.
 */

const URL_S31FG = 'https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json'

/** The region Göttingen lies in, with both of its parts. */
export const REGION_ID = 30
export const REGION_NAME = 'Niedersachsen und Bremen'

/**
 * The part that covers Göttingen, as far as the DWD's naming allows.
 *
 * Used for the default view; the archive holds both parts either way.
 */
export const HOME_PARTREGION = 32

/**
 * The eight kinds, in the order the season runs.
 *
 * The DWD's keys are inconsistent about umlauts ("Beifuss", "Graeser"), so the
 * label is kept separately rather than derived.
 */
export const POLLEN_KINDS = [
  { key: 'Hasel', label: 'Hasel', order: 1 },
  { key: 'Erle', label: 'Erle', order: 2 },
  { key: 'Esche', label: 'Esche', order: 3 },
  { key: 'Birke', label: 'Birke', order: 4 },
  { key: 'Graeser', label: 'Gräser', order: 5 },
  { key: 'Roggen', label: 'Roggen', order: 6 },
  { key: 'Beifuss', label: 'Beifuß', order: 7 },
  { key: 'Ambrosia', label: 'Ambrosia', order: 8 },
]

export const KIND_BY_KEY = new Map(POLLEN_KINDS.map((k) => [k.key, k]))

/**
 * The seven severity steps, as the DWD's own legend defines them.
 *
 * The published value is a string like "1-2", not a number — the intermediate
 * steps are real categories, not rounding. `level` gives them an order so they
 * can be charted; it is a rank, not a measurement, and nothing here should
 * average it.
 */
export const POLLEN_LEVELS = [
  { value: '0', level: 0, label: 'keine Belastung' },
  { value: '0-1', level: 1, label: 'keine bis geringe Belastung' },
  { value: '1', level: 2, label: 'geringe Belastung' },
  { value: '1-2', level: 3, label: 'geringe bis mittlere Belastung' },
  { value: '2', level: 4, label: 'mittlere Belastung' },
  { value: '2-3', level: 5, label: 'mittlere bis hohe Belastung' },
  { value: '3', level: 6, label: 'hohe Belastung' },
]

export const LEVEL_BY_VALUE = new Map(POLLEN_LEVELS.map((l) => [l.value, l]))

/**
 * The three horizons the file carries.
 *
 * Named after the archive's columns, not the JSON's: the source calls the third
 * one `dayafter_to`, which is translated once where the file is parsed so the
 * odd name does not travel any further.
 */
export const HORIZONS = [
  { key: 'today', offset: 0, label: 'heute' },
  { key: 'tomorrow', offset: 1, label: 'morgen' },
  { key: 'dayafter', offset: 2, label: 'übermorgen' },
]

/* -------------------------------------------------------------------------- */
/* Fetch                                                                      */
/* -------------------------------------------------------------------------- */

async function fetchJson(url, { attempts = 4 } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : last}`)
}

/**
 * Today's file, reduced to region 30.
 *
 * Returns `{ issued, parts: [{ partregion, name, rows: [{ pollen, today, … }] }] }`.
 * `issued` is the DWD's own `last_update`, parsed to a date — the file is named
 * after it, so a run that fires twice on the same day overwrites rather than
 * duplicating, and a run that misses a day leaves a visible gap instead of
 * silently filing stale content under the wrong date.
 */
export async function fetchPollen() {
  const body = await fetchJson(URL_S31FG)
  if (!Array.isArray(body?.content)) throw new Error('s31fg.json ohne content-Feld')

  // "2026-08-01 11:00 Uhr"
  const stamp = String(body.last_update ?? '')
  const issued = stamp.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  if (!issued) throw new Error(`unlesbares last_update: "${stamp}"`)

  const parts = []
  for (const entry of body.content) {
    if (Number(entry.region_id) !== REGION_ID) continue

    const rows = []
    for (const kind of POLLEN_KINDS) {
      const values = entry.Pollen?.[kind.key]
      if (!values) continue
      rows.push({
        pollen: kind.key,
        today: String(values.today ?? ''),
        tomorrow: String(values.tomorrow ?? ''),
        dayafter: String(values.dayafter_to ?? ''),
      })
    }

    parts.push({
      partregion: Number(entry.partregion_id),
      name: String(entry.partregion_name ?? '').trim() || REGION_NAME,
      rows,
    })
  }

  if (parts.length === 0) {
    throw new Error(`Region ${REGION_ID} nicht in s31fg.json enthalten`)
  }

  return { issued, updated: stamp, next: String(body.next_update ?? ''), parts }
}
