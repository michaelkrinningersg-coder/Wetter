import { ChevronLeft, ChevronRight, Inbox, Newspaper, Ruler, ScrollText } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, rateText, signed } from '../lib/format'
import type { NewsItem, NewsroomResponse } from '../types'
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
  bad: 'text-bad',
  neutral: 'text-ink',
}

const ACCENT_BORDER: Record<string, string> = {
  brand: 'border-l-brand',
  warm: 'border-l-warm',
  hot: 'border-l-hot',
  cool: 'border-l-cool',
  cold: 'border-l-cold',
  wet: 'border-l-wet',
  dry: 'border-l-dry',
  good: 'border-l-good',
  bad: 'border-l-bad',
  neutral: 'border-l-line-strong',
}

function Item({ item }: { item: NewsItem }) {
  const tone = ACCENT_TEXT[item.accent] ?? 'text-ink'
  const params = new URLSearchParams({ bereich: item.link.tab })
  for (const [key, value] of Object.entries(item.link.params)) params.set(key, String(value))

  return (
    <li
      className={`rounded-card border border-line border-l-2 bg-raised p-4 ${ACCENT_BORDER[item.accent] ?? 'border-l-line-strong'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={`label ${tone}`}>{item.categoryLabel}</span>
        <span className="numeric text-[11px] text-ink-faint">{rateText(item.perYear)}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-ink">{item.headline}</p>
      <p className="mt-1 text-xs text-ink-muted">{item.detail}</p>
      {item.shortBase && (
        <p className="mt-1 text-[10px] text-ink-faint">
          Diese Rate stützt sich auf ein Archiv von gut einem Jahr und ist entsprechend grob.
        </p>
      )}
      <a
        href={`?${params.toString()}`}
        className="mt-2 inline-block text-[11px] font-medium text-ink-faint transition-colors hover:text-brand"
      >
        nachrechnen →
      </a>
    </li>
  )
}

export function Newsroom({ stationId, stationName }: { stationId: string; stationName: string }) {
  const [dateParam, setDateParam] = useUrlState<string>('datum', null)

  const { data, loading, error, reload } = useApi<NewsroomResponse>(
    `/api/weather/newsroom?${dateParam ? `datum=${encodeURIComponent(dateParam)}&` : ''}stationId=${encodeURIComponent(stationId)}`,
    [stationId, dateParam],
  )

  if (loading && !data) return <Loading message="Die Regeln laufen über den Tag …" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const at = data.dates.indexOf(data.date)
  const newer = at > 0 ? (data.dates[at - 1] ?? null) : null
  const older = at >= 0 && at < data.dates.length - 1 ? (data.dates[at + 1] ?? null) : null
  const rules =
    data.checked.calendar +
    data.checked.derived +
    data.checked.streaks +
    data.checked.germany +
    data.checked.air +
    data.checked.month
  const m = data.measured

  return (
    <div className="space-y-6">
      <InfoPanel icon={Newspaper} title={`Newsroom — ${stationName}`}>
        <p>
          Jede andere Ansicht beantwortet eine Frage, die jemand gestellt hat.
          Diese stellt die Frage selbst, einmal pro Tag, an jede Quelle des
          Projekts: War das berichtenswert? Sie muss auch nein sagen können — und
          begründen, was sie geprüft hat und wie nah das Nächstliegende kam.
        </p>
        <p>
          <strong className="text-ink">Kein Sprachmodell ist beteiligt.</strong> Die
          Sätze entstehen aus festen Bausteinen und gemessenen Zahlen. Ein Modell
          im Auslieferungspfad hätte zwei Kosten, die keine Formulierung wert
          ist: Dieselbe Frage an dasselbe Archiv ergäbe zweimal verschiedene
          Ausgaben, und ein falscher Satz wäre von einem richtigen nicht zu
          unterscheiden. Jede Aussage unten lässt sich aus dem Archiv
          nachrechnen — der Link unter jeder Meldung führt in die Ansicht, die
          es zeigt.
        </p>
        <p>
          <strong className="text-ink">Eine Währung für Ungleiches.</strong> Ein
          Kalendertagsrekord, eine Trockenserie und eine Ozonüberschreitung sind
          nicht vergleichbar — es sei denn, jede Regel sagt, an{' '}
          <em>wie vielen Tagen im Jahr</em> eine mindestens so extreme Aussage
          zutrifft. Gemeldet wird, was seltener als an {num(data.threshold, 0)}{' '}
          Tagen im Jahr vorkommt, sortiert nach Seltenheit. So entscheidet keine
          gesetzte Rangfolge der Kategorien, sondern das Archiv.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={ScrollText}
          title={`Ausgabe vom ${data.label}`}
          hint={`${num(rules, 0)} Regeln, ${num(data.candidates, 0)} Kandidaten geprüft · Ausgaben für die letzten ${num(data.dates.length, 0)} Archivtage`}
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={older === null}
                onClick={() => older !== null && setDateParam(older)}
                aria-label="Ältere Ausgabe"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={data.date}
                onChange={(e) => setDateParam(e.target.value)}
                aria-label="Ausgabe auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {data.dates.map((date) => (
                  <option key={date} value={date}>
                    {isoToGerman(date)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={newer === null}
                onClick={() => newer !== null && setDateParam(newer)}
                aria-label="Neuere Ausgabe"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          }
        />

        {/* The day in plain numbers, so the edition stands on its own. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          {[
            { label: 'Tagesmittel', value: m.temp_mean, unit: '°C', digits: 1 },
            { label: 'Höchstwert', value: m.temp_max, unit: '°C', digits: 1 },
            { label: 'Tiefstwert', value: m.temp_min, unit: '°C', digits: 1 },
            { label: 'Niederschlag', value: m.precipitation, unit: 'mm', digits: 1 },
          ].map((entry) => (
            <div key={entry.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-muted">{entry.label}</dt>
              <dd className="numeric text-ink">
                {entry.value === null ? '—' : `${num(entry.value, entry.digits)} ${entry.unit}`}
              </dd>
            </div>
          ))}
        </dl>
        {m.anomaly !== null && (
          <p className="mt-2 text-[11px] text-ink-faint">
            Das Tagesmittel lag <span className="numeric">{signed(m.anomaly, 1)} K</span> neben dem
            Mittel dieses Kalendertages.
          </p>
        )}
      </Card>

      {!data.quiet && (
        <Card>
          <SectionHeading
            icon={Newspaper}
            title={data.items.length === 1 ? 'Eine Meldung' : `${num(data.items.length, 0)} Meldungen`}
            hint={
              data.dropped > 0
                ? `Die seltensten zuerst. ${num(data.dropped, 0)} weitere Treffer haben die Schwelle ebenfalls erreicht, stehen aber nicht in dieser Ausgabe.`
                : 'Die seltensten zuerst.'
            }
          />
          <ul className="space-y-2.5">
            {data.items.map((entry) => (
              <Item key={entry.key} item={entry} />
            ))}
          </ul>
        </Card>
      )}

      {data.quiet && (
        <Card>
          <SectionHeading icon={Inbox} title="Nichts Besonderes" />
          <p className="text-sm text-ink">
            An diesem Tag hat keine der {num(rules, 0)} Regeln etwas gefunden, das
            seltener als an {num(data.threshold, 0)} Tagen im Jahr vorkommt.
          </p>
          {data.nearest && (
            <div className="mt-4 rounded-card border border-line bg-raised p-4">
              <p className="label mb-1.5">Am nächsten kam</p>
              <p className="text-sm font-semibold text-ink">{data.nearest.headline}</p>
              <p className="mt-1 text-xs text-ink-muted">{data.nearest.detail}</p>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Das kommt {rateText(data.nearest.perYear)} vor und liegt damit über
                der Schwelle von {num(data.threshold, 0)} Tagen im Jahr — zu häufig
                für eine Meldung.
              </p>
            </div>
          )}
          <p className="mt-4 text-xs text-ink-muted">
            Das ist die häufigste Ausgabe: Die meisten Tage sind gewöhnlich, und
            eine Zeitung, die jeden Tag eine Schlagzeile findet, hat ihre Schwelle
            zu tief gelegt.
          </p>
        </Card>
      )}

      <Card>
        <SectionHeading
          icon={Ruler}
          title="Was geprüft wurde"
          hint="Damit „nichts Besonderes“ nachprüfbar ist und nicht geglaubt werden muss."
        />
        <ul className="grid grid-cols-1 gap-1.5 text-xs text-ink-muted sm:grid-cols-2">
          <li>
            <span className="numeric text-ink">{num(data.checked.calendar, 0)}</span> Größen
            gegen alle Ausgaben desselben Kalendertages
          </li>
          <li>
            <span className="numeric text-ink">{num(data.checked.derived, 0)}</span> abgeleitete
            Tageswerte (Tagesgang, Sprung, Sturz, Druckfall)
          </li>
          <li>
            <span className="numeric text-ink">{num(data.checked.streaks, 0)}</span> laufende
            Serien und Pausen
          </li>
          <li>
            <span className="numeric text-ink">{num(data.checked.month, 0)}</span> Monatsstand
            gegen dieselben Teilmonate aller Jahre
          </li>
          <li>
            <span className="numeric text-ink">{num(data.checked.germany, 0)}</span> bundesweite
            Regeln (Extrempunkte, Allzeitrekorde)
          </li>
          <li>
            <span className="numeric text-ink">{num(data.checked.air, 0)}</span> Grenzwerte der
            Luftqualität
          </li>
        </ul>

        <div className="mt-4 space-y-1.5 border-t border-line pt-4">
          <p className="label">Wie weit die Quellen zurückreichen</p>
          {data.sources.map((source) => (
            <p key={source.key} className="text-xs text-ink-muted">
              <span className="text-ink">{source.label}</span> — {isoToGerman(source.from)} bis{' '}
              {isoToGerman(source.to)}, {source.note}
            </p>
          ))}
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs text-ink-faint">
          {data.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
