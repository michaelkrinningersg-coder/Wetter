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

/**
 * A value that is *already* in percent units — 16.5 becomes "16,5 %".
 *
 * The name is a trap and has caught this project once: it appends a sign, it
 * does not convert. For a fraction between 0 and 1, use `shareOf` instead.
 */
export function percent(value: number | null | undefined, digits = 0): string {
  return num(value, digits, '%')
}

/** A fraction between 0 and 1 — 0.8 becomes "80 %". */
export function shareOf(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? num(value, digits, '%') : num(value * 100, digits, '%')
}

/** `1858-01-01` -> `01.01.1858`, without constructing a Date (which would
 *  shift the day for pre-1900 dates in some timezones). */
/**
 * A year, without a thousands separator.
 *
 * `num(1885, 0)` produces "1.885" under de-DE grouping, which is correct for a
 * count and wrong for a year. Every axis, legend and caption that shows a year
 * goes through here instead.
 */
export function year(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : String(Math.round(value))
}

/**
 * A rate of days per year, said the way a person would.
 *
 * The newsroom's one currency: "an einem Tag alle 40 Jahre" beats "0,025/Jahr"
 * for a reader, and the band around one is spelled out because dividing gives
 * "alle 1 Jahre".
 */
export function rateText(perYear: number | null | undefined): string {
  if (perYear === null || perYear === undefined || !(perYear > 0)) return 'noch nie'
  if (perYear >= 1.5) return `an etwa ${num(perYear, perYear >= 10 ? 0 : 1)} Tagen im Jahr`
  if (Math.round(1 / perYear) <= 1) return 'an etwa einem Tag im Jahr'
  return `an einem Tag alle ${num(1 / perYear, 0)} Jahre`
}

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
