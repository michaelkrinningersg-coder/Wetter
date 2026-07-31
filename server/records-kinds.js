/**
 * The record categories, shared by the collector and the server.
 *
 * Kept in its own module so `scripts/fetch-records.js` can import it without
 * pulling in the database — the scheduled workflow runs with nothing installed.
 */
export const RECORD_KINDS = [
  {
    key: 'temp_max',
    field: 'temp_max',
    direction: 'max',
    label: 'Höchsttemperatur',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_min',
    field: 'temp_min',
    direction: 'min',
    label: 'Tiefsttemperatur',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_mean_high',
    field: 'temp_mean',
    direction: 'max',
    label: 'Wärmstes Tagesmittel',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'temp_mean_low',
    field: 'temp_mean',
    direction: 'min',
    label: 'Kältestes Tagesmittel',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'precipitation',
    field: 'precipitation',
    direction: 'max',
    label: 'Tagesniederschlag',
    unit: 'mm',
    decimals: 1,
  },
  {
    key: 'wind_max',
    field: 'wind_max',
    direction: 'max',
    label: 'Windböe',
    unit: 'm/s',
    decimals: 1,
  },
]

export const KIND_BY_KEY = new Map(RECORD_KINDS.map((k) => [k.key, k]))

/** True when `value` beats `record` in the kind's direction. */
export function beats(kind, value, record) {
  return kind.direction === 'max' ? value > record : value < record
}
