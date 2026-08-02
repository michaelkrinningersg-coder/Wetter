import { CalendarDays, Gauge } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { MonthBalance } from './MonthBalance'
import { MonthlyOverview } from './MonthlyOverview'
import { SubNav } from './ui'

/**
 * One month, twice.
 *
 * "Tageswerte" is the table of what happened; "Bilanz" is what it amounts to —
 * the same month set against every other edition of itself, and, while it is
 * still running, the range in which it can still end up. The two share the
 * month and year in the URL, so switching between them stays on the same month.
 */
const VIEWS = [
  { value: 'tage', label: 'Tageswerte', icon: CalendarDays },
  { value: 'bilanz', label: 'Bilanz', icon: Gauge },
] as const

export function MonthlyView(props: {
  stationId: string
  stationName: string
  year: number
  month: number
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
  maxYear: number
  minYear: number
}) {
  const [view, setView] = useUrlState<string>('ansicht', 'tage')

  return (
    <div className="space-y-6">
      <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      {view === 'bilanz' ? (
        <MonthBalance
          stationId={props.stationId}
          stationName={props.stationName}
          year={props.year}
          month={props.month}
          onYearChange={props.onYearChange}
          onMonthChange={props.onMonthChange}
        />
      ) : (
        <MonthlyOverview {...props} />
      )}
    </div>
  )
}
