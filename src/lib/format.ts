export const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
] as const

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month)
}

const nf = (digits: number) =>
  new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

/** `null`-safe number formatting. The original app called `.toFixed()` on
 *  possibly-null API fields and crashed the whole tab when one was missing. */
export function num(
  value: number | null | undefined,
  digits = 1,
  unit = '',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return nf(digits).format(value) + (unit ? ` ${unit}` : '')
}

export function temp(value: number | null | undefined, digits = 1): string {
  return num(value, digits, '°C')
}

export function mm(value: number | null | undefined, digits = 1): string {
  return num(value, digits, 'mm')
}

/** Wind in m/s with the km/h equivalent, as the original tooltips showed. */
export function wind(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${nf(1).format(value)} m/s (${Math.round(value * 3.6)} km/h)`
}

/** Signed value, for anomalies and differences. */
export function signed(
  value: number | null | undefined,
  digits = 2,
  unit = '',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  const sign = value >= 0 ? '+' : '−'
  return `${sign}${nf(digits).format(Math.abs(value))}${unit ? ` ${unit}` : ''}`
}

export function percent(value: number | null | undefined, digits = 0): string {
  return num(value, digits, '%')
}

/** `1858-01-01` -> `01.01.1858`, without constructing a Date (which would
 *  shift the day for pre-1900 dates in some timezones). */
export function isoToGerman(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export function coverage(validDays: number, totalDays: number): string {
  if (!totalDays) return '—'
  return `${validDays} / ${totalDays} (${Math.round((validDays / totalDays) * 100)} %)`
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  // Forecast day-counts are fractional (blended climatology).
  return Number.isInteger(value)
    ? `${value} d`
    : `${nf(1).format(value)} d`
}
