import { ArrowLeftRight } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { SpanResponse } from '../types'
import { NationwideSpan } from './NationwideSpan'
import { ErrorState, InfoPanel, Loading, SubNav } from './ui'

/**
 * One day of German weather, seen four ways.
 *
 * Everything on this page is a statement about the country rather than about a
 * station, and all of it rests on the same archive: the shape of every day since
 * 1936, derived once from the DWD historical files and extended nightly from the
 * daily archive.
 */
const VIEWS = [{ value: 'spanne', label: 'Spanne', icon: ArrowLeftRight }] as const

export function Nationwide() {
  const [view, setView] = useUrlState<string>('ansicht', 'spanne')
  const { data, loading, error } = useApi<SpanResponse>('/api/nationwide/span')

  if (loading && !data) return <Loading message="Deutschlandtage werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { range } = data

  return (
    <div className="space-y-6">
      <InfoPanel title="Deutschlandtage">
        <p>
          Jede Zahl auf dieser Seite ist eine Aussage über das Land, nicht über
          eine Station. Grundlage ist ein eigenes Archiv: für jeden Tag die Form
          dieses Tages über Deutschland — wärmster und kältester Ort, das Gefälle
          von Süd nach Nord, die Abnahme mit der Höhe. Ein einmaliger Durchlauf
          durch die historischen DWD-Archive las dafür{' '}
          <span className="numeric">18,5 Millionen</span> Einzelmessungen; übrig
          blieb eine Zeile je Tag, <span className="numeric">{num(range.days, 0)}</span>{' '}
          insgesamt, die älteste vom {isoToGerman(range.first)}.
        </p>
        <p>
          Die Reihe hat zwei Hälften, die keine Naht zeigen dürfen. Alles vor dem{' '}
          {isoToGerman(range.cutoff)} stammt aus den historischen DWD-Archiven und
          wurde einmal berechnet; jeder Tag danach wird aus dem Tagesarchiv dieses
          Projekts neu gerechnet. Beide Hälften laufen durch dieselbe Rechnung,
          sonst gäbe es an der Nahtstelle einen Sprung.
        </p>
        <p>
          Beteiligt sind ausschließlich die Klimastationen. Das
          Niederschlagsnetz ist viermal so groß, misst aber keine Temperatur —
          und jede Frage hier ist eine Temperaturfrage. Ein Tag zählt erst ab{' '}
          {num(range.minStations, 0)} meldenden Stationen, was die belastbare
          Reihe am {isoToGerman(range.countedFrom)} beginnen lässt:{' '}
          {num(range.counted, 0)} von {num(range.days, 0)} Tagen. Die älteren
          bleiben im Archiv, gehen aber in keine Zahl ein.
        </p>
      </InfoPanel>

      {VIEWS.length > 1 && (
        <SubNav label="Auswertung" value={view} items={VIEWS} onChange={setView} />
      )}

      {view === 'spanne' && <NationwideSpan data={data} />}
    </div>
  )
}
