import { CalendarRange, Radio, Waves } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { Episodes } from './Episodes'
import { Spells } from './Spells'
import { Ticker } from './Ticker'
import { SubNav } from './ui'

/**
 * Runs of days, counted two ways.
 *
 * "Schwellen" is the plain question: how many days in a row cleared a fixed
 * limit, ranked by length. "Episoden" asks the same series for events rather
 * than runs — it bridges a single day below the limit, weighs duration and
 * intensity into one strength, adds the calendar day's own percentile as a
 * second definition, and says how often something like it has happened.
 *
 * Both stay, because the first is checkable at a glance and the second is the
 * one that finds a warm spell in December. "Ticker" turns the same question to
 * the present tense: which of those runs has not ended yet.
 */
const VIEWS = [
  { value: 'schwellen', label: 'Schwellen', icon: Waves },
  { value: 'episoden', label: 'Episoden', icon: CalendarRange },
  { value: 'ticker', label: 'Ticker', icon: Radio },
] as const

export function Periods({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [view, setView] = useUrlState<string>('ansicht', 'schwellen')

  return (
    <div className="space-y-6">
      <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      {view === 'episoden' && <Episodes stationId={stationId} stationName={stationName} />}
      {view === 'ticker' && <Ticker stationId={stationId} stationName={stationName} />}
      {view !== 'episoden' && view !== 'ticker' && (
        <Spells stationId={stationId} stationName={stationName} />
      )}
    </div>
  )
}
