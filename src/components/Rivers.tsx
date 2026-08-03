import { Clock, Waves } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { Gauges } from './Gauges'
import { GaugeCycle } from './GaugeCycle'
import { SubNav } from './ui'

/**
 * Two questions to the same readings.
 *
 * "Ganglinie" is the level itself: where it stands, how it got there, how far
 * it is from the thresholds. "Tagesgang" throws exactly that away — every hour
 * is measured against the day around it — and asks what is left over when the
 * weeks-long drift is gone. The two cannot share a chart, because the first is
 * about centimetres above the gauge datum and the second about tenths of a
 * centimetre around a moving zero.
 *
 * Both sub-views read the same `pegel` parameter, so a river picked in one is
 * still picked in the other.
 */
const VIEWS = [
  { value: 'ganglinie', label: 'Ganglinie', icon: Waves },
  { value: 'tagesgang', label: 'Tagesgang', icon: Clock },
] as const

export function Rivers() {
  const [view, setView] = useUrlState<string>('ansicht', 'ganglinie')

  return (
    <div className="space-y-6">
      <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      {view === 'tagesgang' ? <GaugeCycle /> : <Gauges />}
    </div>
  )
}
