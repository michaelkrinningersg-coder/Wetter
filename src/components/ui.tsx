import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, Inbox, type LucideProps } from 'lucide-react'

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                          */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={`rounded-card border border-line bg-surface ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

export function SectionHeading({
  icon: Icon,
  title,
  hint,
  actions,
}: {
  icon?: ComponentType<LucideProps>
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {Icon && <Icon className="size-4 shrink-0 text-brand" aria-hidden />}
          <span className="truncate">{title}</span>
        </h2>
        {hint && (
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {hint}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

/**
 * The explanatory blocks that head most tabs. In the original these were
 * `text-[10px] uppercase tracking-wider` paragraphs of 60+ words — technically
 * present but effectively unreadable. Same copy, readable typography.
 */
export function InfoPanel({
  icon: Icon,
  title,
  children,
}: {
  icon?: ComponentType<LucideProps>
  title: string
  children: ReactNode
}) {
  return (
    <Card className="border-brand/20 bg-gradient-to-br from-brand/[0.05] to-transparent">
      <div className="flex gap-4">
        {Icon && (
          <div className="hidden size-9 shrink-0 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand sm:grid">
            <Icon className="size-4" aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="mt-2 max-w-4xl text-xs leading-relaxed text-ink-muted [&_strong]:font-semibold [&_strong]:text-brand">
            {children}
          </div>
        </div>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Metric tiles                                                               */
/* -------------------------------------------------------------------------- */

export type Accent =
  | 'brand'
  | 'warm'
  | 'hot'
  | 'cool'
  | 'cold'
  | 'wet'
  | 'dry'
  | 'good'
  | 'neutral'

const ACCENT_TEXT: Record<Accent, string> = {
  brand: 'text-brand',
  warm: 'text-warm',
  hot: 'text-hot',
  cool: 'text-cool',
  cold: 'text-cold',
  wet: 'text-wet',
  dry: 'text-dry',
  good: 'text-good',
  neutral: 'text-ink',
}

const ACCENT_BAR: Record<Accent, string> = {
  brand: 'bg-brand',
  warm: 'bg-warm',
  hot: 'bg-hot',
  cool: 'bg-cool',
  cold: 'bg-cold',
  wet: 'bg-wet',
  dry: 'bg-dry',
  good: 'bg-good',
  neutral: 'bg-line-strong',
}

export function StatTile({
  label,
  value,
  caption,
  accent = 'neutral',
  icon: Icon,
}: {
  label: string
  value: ReactNode
  caption?: ReactNode
  accent?: Accent
  icon?: ComponentType<LucideProps>
}) {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-raised p-4">
      <span
        className={`absolute inset-y-0 left-0 w-0.5 ${ACCENT_BAR[accent]}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {Icon && (
          <Icon className={`size-4 shrink-0 ${ACCENT_TEXT[accent]}`} aria-hidden />
        )}
      </div>
      <p
        className={`numeric mt-2 text-2xl font-semibold tracking-tight ${ACCENT_TEXT[accent]}`}
      >
        {value}
      </p>
      {caption && (
        <p className="mt-1 text-[11px] leading-snug text-ink-faint">{caption}</p>
      )}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

export interface Choice<T extends string> {
  value: T
  label: string
  title?: string
}

/**
 * Replaces the ~40 hand-rolled `<button className={cond ? '...' : '...'}>`
 * pairs in the original. Renders as a real radio group so arrow keys work and
 * screen readers announce the selection.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
  size = 'md',
}: {
  label: string
  value: T
  choices: readonly Choice<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {choices.map((choice) => {
        const active = choice.value === value
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={choice.title}
            onClick={() => onChange(choice.value)}
            className={`${pad} cursor-pointer rounded-md font-medium transition-colors ${
              active
                ? 'bg-brand text-canvas'
                : 'border border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  icon: Icon,
  maxLength,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
  icon?: ComponentType<LucideProps>
  maxLength?: number
  className?: string
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      {Icon && (
        <Icon
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
      )}
      <input
        type="search"
        inputMode="numeric"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`numeric w-full rounded-md border border-line bg-inset py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none ${Icon ? 'pl-9 pr-3' : 'px-3'}`}
      />
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer items-center gap-3 rounded-md border border-line bg-raised px-3 py-2 text-left transition-colors hover:border-line-strong"
    >
      <span
        className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line-strong'}`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-canvas transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        {hint && (
          <span className="block text-[10px] leading-tight text-ink-faint">
            {hint}
          </span>
        )}
      </span>
    </button>
  )
}

/** Sortable table header cell. */
export function SortHeader({
  label,
  active,
  direction,
  onClick,
  title,
  className = '',
}: {
  label: ReactNode
  active: boolean
  direction: 'asc' | 'desc'
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <th
      scope="col"
      title={title}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap px-3 py-2.5 text-left ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`label flex cursor-pointer items-center gap-1 transition-colors hover:text-ink ${active ? 'text-brand' : ''}`}
      >
        {label}
        <span aria-hidden className="text-[9px]">
          {active ? (direction === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  )
}

/* -------------------------------------------------------------------------- */
/* Async states                                                               */
/* -------------------------------------------------------------------------- */

export function Loading({ message }: { message: string }) {
  return (
    <Card className="grid place-items-center py-20 text-center">
      <div
        className="size-8 animate-spin rounded-full border-2 border-line border-t-brand"
        role="status"
        aria-label="Lädt"
      />
      <p className="mt-4 text-xs text-ink-muted">{message}</p>
    </Card>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <Card className="border-bad/25 bg-bad/[0.06] py-12 text-center">
      <AlertTriangle className="mx-auto size-9 text-bad" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-ink">
        Daten konnten nicht geladen werden
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 cursor-pointer rounded-md border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          Erneut versuchen
        </button>
      )}
    </Card>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Card className="py-16 text-center">
      <Inbox className="mx-auto size-9 text-ink-faint" aria-hidden />
      <p className="mt-3 text-xs text-ink-muted">{message}</p>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

/** Shared visual language for every Recharts surface. */
export const CHART = {
  grid: 'oklch(28% 0.008 260)',
  axis: 'oklch(56% 0.008 260)',
  tick: { fill: 'oklch(72% 0.008 260)', fontSize: 11 },
  colors: {
    brand: 'oklch(84% 0.17 92)',
    warm: 'oklch(70% 0.19 25)',
    hot: 'oklch(75% 0.17 55)',
    cool: 'oklch(76% 0.13 235)',
    cold: 'oklch(68% 0.15 255)',
    wet: 'oklch(78% 0.12 205)',
    neutral: 'oklch(62% 0.008 260)',
    accent: 'oklch(74% 0.17 340)',
  },
} as const

export function ChartTooltip({
  title,
  subtitle,
  rows,
  footer,
}: {
  title: ReactNode
  subtitle?: ReactNode
  rows: { label: ReactNode; value: ReactNode; className?: string }[]
  footer?: ReactNode
}) {
  return (
    <div className="max-w-[300px] rounded-lg border border-line-strong bg-canvas/95 p-3 shadow-2xl backdrop-blur">
      <p className="text-xs font-semibold text-brand">{title}</p>
      {subtitle && (
        <p className="mt-0.5 border-b border-line pb-1.5 text-[10px] text-ink-faint">
          {subtitle}
        </p>
      )}
      <dl className="mt-2 space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <dt className="text-[11px] text-ink-muted">{row.label}</dt>
            <dd className={`numeric text-[11px] font-semibold ${row.className ?? 'text-ink'}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer && (
        <p className="mt-2 border-t border-line pt-1.5 text-[10px] text-ink-faint">
          {footer}
        </p>
      )}
    </div>
  )
}

export function ChartFrame({
  height = 380,
  children,
}: {
  height?: number
  children: ReactNode
}) {
  return (
    <div className="w-full" style={{ height }}>
      {children}
    </div>
  )
}
