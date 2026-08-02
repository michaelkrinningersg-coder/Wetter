import { Activity, Award, Grid3x3, Hourglass } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { RecordAges } from './RecordAges'
import { RecordCalendar } from './RecordCalendar'
import { RecordSurvival } from './RecordSurvival'
import { RecordVintages } from './RecordVintages'
import { SubNav } from './ui'

/**
 * The station's own records, seen several ways.
 *
 * Everything here rests on one walk through the series: for each of the 366
 * calendar days, which value stands, when it was set, and every time the title
 * changed hands before that. From those spells follow the age of the standing
 * records, the calendar they are spread over, the years that left the most
 * behind, how long a record survives and the days that came close.
 *
 * Not to be confused with "Allzeitrekorde", which asks the same question of
 * every station in Germany for one day at a time.
 */
const VIEWS = [
  { value: 'alter', label: 'Alter', icon: Hourglass },
  { value: 'kalender', label: 'Kalender', icon: Grid3x3 },
  { value: 'jahrgaenge', label: 'Jahrgänge', icon: Award },
  { value: 'ueberleben', label: 'Überleben', icon: Activity },
] as const

export function RecordHistory({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [view, setView] = useUrlState<string>('ansicht', 'alter')

  return (
    <div className="space-y-6">
      <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      {view === 'kalender' && <RecordCalendar stationId={stationId} stationName={stationName} />}
      {view === 'jahrgaenge' && (
        <RecordVintages stationId={stationId} stationName={stationName} />
      )}
      {view === 'ueberleben' && (
        <RecordSurvival stationId={stationId} stationName={stationName} />
      )}
      {!['kalender', 'jahrgaenge', 'ueberleben'].includes(view) && (
        <RecordAges stationId={stationId} stationName={stationName} />
      )}
    </div>
  )
}
