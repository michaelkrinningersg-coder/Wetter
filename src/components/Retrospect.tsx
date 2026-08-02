import { CalendarHeart, Sparkles } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { Curiosities } from './Curiosities'
import { Yearbook } from './Yearbook'
import { SubNav } from './ui'

/**
 * The station's own record, read as stories rather than as series.
 *
 * Both views underneath ask which days were worth mentioning, and differ only
 * in how they narrow the field: the yearbook picks ten days out of one year,
 * the cabinet picks ten days out of the whole archive for each of a dozen
 * questions that no ordinary ranking would ever ask.
 */
const VIEWS = [
  { value: 'jahr', label: 'Jahresrückblick', icon: CalendarHeart },
  { value: 'kurioses', label: 'Kuriositätenkabinett', icon: Sparkles },
] as const

export function Retrospect({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [view, setView] = useUrlState<string>('ansicht', 'jahr')

  return (
    <div className="space-y-6">
      <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      {view === 'kurioses' ? (
        <Curiosities stationId={stationId} stationName={stationName} />
      ) : (
        <Yearbook stationId={stationId} stationName={stationName} />
      )}
    </div>
  )
}
