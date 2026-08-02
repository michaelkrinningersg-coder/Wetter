import { CalendarRange, Waves } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { Episodes } from './Episodes'
import { Spells } from './Spells'
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
 * one that finds a warm spell in December.
 */
const VIEWS = [
  { value: 'schwellen', label: 'Schwellen', icon: Waves },
  { value: 'episoden', label: 'Episoden', icon: CalendarRange },
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
      {view === 'episoden' ? (
        <Episodes stationId={stationId} stationName={stationName} />
      ) : (
        <Spells stationId={stationId} stationName={stationName} />
      )}
    </div>
  )
}
