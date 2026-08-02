import { Activity, AlertTriangle, CalendarClock, Hourglass, Radio } from 'lucide-react'

import { useApi } from '../lib/api'
import { isoToGerman, num } from '../lib/format'
import type { TickerResponse, TickerSeries } from '../types'
import { Card, ErrorState, InfoPanel, Loading, SectionHeading } from './ui'

const ACCENT_TEXT: Record<string, string> = {
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

const ACCENT_BAR: Record<string, string> = {
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

/**
 * "etwa dreimal im Jahr" or "alle vier Jahre" — whichever reads as a fact.
 *
 * The band around one is spelled out rather than divided: a rate of 0,91 per
 * year turns into "alle 1 Jahre", which is neither German nor informative.
 */
function frequency(perYear: number | null): string | null {
  if (perYear === null || perYear <= 0) return null
  if (perYear >= 1.5) {
    return `so lang oder länger etwa ${num(perYear, perYear >= 10 ? 0 : 1)}-mal im Jahr`
  }
  if (perYear >= 0.75) return 'so lang oder länger etwa einmal im Jahr'
  return `so lang oder länger im Mittel alle ${num(1 / perYear, 0)} Jahre`
}

function Row({ series }: { series: TickerSeries }) {
  const tone = ACCENT_TEXT[series.accent] ?? 'text-ink'
  const share =
    series.record && series.record.days > 0
      ? Math.min(1, series.lead / series.record.days)
      : 0
  const freq = frequency(series.perYear)

  return (
    <li className="rounded-card border border-line bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold text-ink">{series.label}</p>
        <p className={`numeric text-2xl font-semibold ${tone}`}>
          {num(series.lead, 0)}
          <span className="ml-1 text-xs font-normal text-ink-muted">
            {series.lead === 1 ? 'Tag' : 'Tage'}
          </span>
        </p>
      </div>

      {/* How far along the record this stand is — the bar is the sentence. */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${ACCENT_BAR[series.accent] ?? 'bg-brand'}`}
          style={{ width: `${Math.max(share * 100, series.lead > 0 ? 1.5 : 0)}%` }}
        />
      </div>

      <div className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
        {series.record && (
          <p>
            Rekord <span className="numeric text-ink">{num(series.record.days, 0)}</span> Tage
            {series.record.current ? (
              <span className="ml-1 text-good">— das ist diese Reihe selbst</span>
            ) : series.lead >= series.record.days ? (
              <span className="ml-1 text-good">
                bis {isoToGerman(series.record.end)} — bereits übertroffen
              </span>
            ) : (
              <>
                {' '}
                bis {isoToGerman(series.record.end)} — noch{' '}
                <span className="numeric">{num(series.record.days - series.lead, 0)}</span> Tage
                entfernt
              </>
            )}
          </p>
        )}

        {series.lead > 0 && series.rank !== null && (
          <p>
            Platz <span className="numeric text-ink">{num(series.rank, 0)}</span> unter{' '}
            {num(series.runs, 0)} Reihen dieser Art
            {freq ? ` — ${freq}` : ''}
          </p>
        )}

        {series.lead === 0 && (
          <p className="text-ink-faint">
            läuft derzeit nicht — {series.breakLabel} war der {isoToGerman(series.reference)}
          </p>
        )}

        {series.since && series.lead > 0 && (
          <p className="text-ink-faint">
            {series.breakLabel}: {isoToGerman(series.since.date)}
            {series.family === 'serie' && series.current.start
              ? ` · Beginn ${isoToGerman(series.current.start)}`
              : ''}
          </p>
        )}

        {!series.current.complete && series.lead > 0 && series.since && (
          <p className="flex items-start gap-1.5 text-bad">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            <span>
              Davon lückenlos belegt:{' '}
              <span className="numeric">{num(series.current.days, 0)}</span> Tage.{' '}
              {num(series.since.missing, 0)}{' '}
              {series.since.missing === 1 ? 'Tag' : 'Tage'} in diesem Zeitraum
              {series.since.missing === 1 ? ' trägt' : ' tragen'} keinen Messwert.
            </span>
          </p>
        )}
      </div>
    </li>
  )
}

export function Ticker({ stationId, stationName }: { stationId: string; stationName: string }) {
  const { data, loading, error, reload } = useApi<TickerResponse>(
    `/api/weather/ticker?stationId=${encodeURIComponent(stationId)}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Laufende Reihen werden gezählt …" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const running = data.series
    .filter((s) => s.lead > 0)
    .sort((a, b) => (a.perYear ?? 9e9) - (b.perYear ?? 9e9))
  const idle = data.series.filter((s) => s.lead === 0 && !s.never && !s.stale)
  const stale = data.series.filter((s) => s.stale && !s.never)
  const never = data.series.filter((s) => s.never)

  return (
    <div className="space-y-6">
      <InfoPanel icon={Radio} title={`Was gerade läuft — ${stationName}`}>
        <p>
          Alles andere in diesem Projekt sieht auf abgeschlossene Ereignisse
          zurück. Dies hier ist die einzige Zahl, die sich von einem Tag auf den
          nächsten ändert: eine Reihe, die noch läuft, mit dem Abstand zum
          Rekord und der Angabe, wie oft eine Reihe dieser Art so weit kommt.
          Fünf trockene Tage in Folge sind für sich genommen nichts — sie können
          alltäglich sein oder bemerkenswert, und erst die beiden Zusatzzahlen
          entscheiden, welches von beidem.
        </p>
        <p>
          Stichtag ist der{' '}
          <strong className="text-ink">{isoToGerman(data.reference)}</strong>, der
          letzte Tag im Archiv dieser Station — nicht heute. Der DWD
          veröffentlicht mit ein bis zwei Tagen Verzug, und ein Ticker, der
          stillschweigend bis zur Uhrzeit weiterzählte, addierte Tage, die
          niemand gemessen hat.
        </p>
      </InfoPanel>

      {running.length > 0 && (
        <Card>
          <SectionHeading
            icon={Activity}
            title="Laufende Reihen"
            hint="Nach Seltenheit sortiert: oben steht, was am wenigsten häufig so weit kommt."
          />
          <ul className="space-y-2.5">
            {running.map((series) => (
              <Row key={series.key} series={series} />
            ))}
          </ul>
        </Card>
      )}

      {idle.length > 0 && (
        <Card>
          <SectionHeading
            icon={Hourglass}
            title="Derzeit bei null"
            hint="Reihen, die am Stichtag nicht laufen — mit dem Rekord, den sie zu schlagen hätten."
          />
          <ul className="space-y-1.5">
            {idle.map((series) => (
              <li
                key={series.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs"
              >
                <span className="text-ink-muted">{series.label}</span>
                <span className="text-[11px] text-ink-faint">
                  Rekord{' '}
                  <span className="numeric text-ink-muted">
                    {num(series.record?.days ?? null, 0)}
                  </span>{' '}
                  Tage
                  {series.record ? ` bis ${isoToGerman(series.record.end)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stale.length > 0 && (
        <Card>
          <SectionHeading
            icon={AlertTriangle}
            title="Nicht mehr gemessen"
            hint="Diese Größen liegen am Stichtag nicht vor. Eine Reihe braucht ihren letzten Tag — ohne ihn ließe sich nur behaupten, sie laufe noch."
          />
          <ul className="space-y-1.5">
            {stale.map((series) => (
              <li
                key={series.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs"
              >
                <span className="text-ink-muted">{series.label}</span>
                <span className="text-[11px] text-ink-faint">
                  zuletzt gemessen am {isoToGerman(series.range.last)}
                  {series.since
                    ? ` · ${series.breakLabel}: ${isoToGerman(series.since.date)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {never.length > 0 && (
        <Card>
          <SectionHeading
            icon={Hourglass}
            title="Kommt an dieser Station nicht vor"
            hint="Kein einziger solcher Tag in der ganzen Messreihe — hier gibt es weder eine Serie noch eine Pause, die man zählen könnte."
          />
          <ul className="space-y-1.5">
            {never.map((series) => (
              <li
                key={series.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs"
              >
                <span className="text-ink-muted">{series.label}</span>
                <span className="text-[11px] text-ink-faint">
                  in {num(series.range.days, 0)} Messtagen seit{' '}
                  {isoToGerman(series.range.first)} nie eingetreten
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionHeading
          icon={CalendarClock}
          title="Wie gezählt wird"
          hint="Damit die große Zahl nicht mehr behauptet, als gemessen wurde."
        />
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Zwei Zahlen, wo sie auseinanderfallen.</strong>{' '}
            Eine Reihe endet, wo das Kriterium bricht — aber auch, wo ein Messwert
            fehlt. Meldet eine Station mitten in einer langen frostfreien Strecke
            an ein paar Tagen kein Minimum, dann ist der Abstand zum letzten
            aufgezeichneten Frost die eine Wahrheit und die lückenlos belegte
            Teilstrecke die andere. Beide stehen in der Zeile, und wo sie
            auseinanderfallen, ist es rot vermerkt — mitsamt der Zahl der Tage
            ohne Messwert.
          </li>
          <li>
            <strong className="text-ink">Die Kopfzahl ist die, um die es geht.</strong>{' '}
            Bei „seit N Tagen kein …" ist das der Abstand zum letzten Ereignis, bei
            einer Serie die Serie selbst. Der Platz bezieht sich immer auf die
            Kopfzahl; die belegte Teilstrecke danach zu bewerten, verglich das
            Falsche.
          </li>
          <li>
            <strong className="text-ink">Der Vergleich läuft gegen abgeschlossene
            Reihen.</strong> Die laufende wird nicht gegen sich selbst gezählt.
            Steht sie an erster Stelle, ist sie gerade dabei, den Rekord zu
            schreiben — dann steht das dort.
          </li>
          <li>
            <strong className="text-ink">Zwei Fälle bekommen gar keine Zahl.</strong>{' '}
            Wird eine Größe am Stichtag nicht mehr gemeldet, ist keine Aussage über
            eine laufende Reihe möglich — die Zugspitze meldet seit Februar 2026
            keine Schneehöhe, und ohne diese Regel hätte hier „180 Tage ohne
            Schneedecke, Rekord übertroffen" gestanden, gestützt auf keinen einzigen
            gemessenen Tag. Und kam ein Ereignis an dieser Station nie vor — der
            Brocken hat in 130 Jahren keinen einzigen Tag mit 30 °C —, dann zählt
            „seit dem letzten Mal" nichts als den Abstand zur letzten Messlücke.
          </li>
          <li>
            <strong className="text-ink">Das Kalendermittel</strong> hinter „Tage über
            dem Mittel" braucht mindestens {num(data.minYearsForMean, 0)} Jahre für
            denselben Kalendertag. Aus zehn Beobachtungen wäre der Bezugswert
            Rauschen, und jeder zweite Tag läge zufällig darüber.
          </li>
        </ul>
      </Card>
    </div>
  )
}
