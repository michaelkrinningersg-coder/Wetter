import {
  CloudRain,
  CloudSnow,
  Flame,
  Gauge,
  Maximize2,
  Minimize2,
  Snowflake,
  Sparkles,
  Sun,
  ThermometerSnowflake,
  TrendingDown,
  TrendingUp,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { num, signed as withSign, year as yearOf } from '../lib/format'
import type { CuriositiesResponse, CuriositySection } from '../types'
import { Card, ErrorState, InfoPanel, Loading, SectionHeading } from './ui'

const ICONS: Record<string, ComponentType<LucideProps>> = {
  widest_range: Maximize2,
  narrowest_range: Minimize2,
  jump_up: TrendingUp,
  jump_down: TrendingDown,
  warm_winter: Sun,
  cold_summer: ThermometerSnowflake,
  summer_frost: Snowflake,
  late_snow: CloudSnow,
  warm_anomaly: Flame,
  cold_anomaly: Snowflake,
  downpour_share: CloudRain,
  pressure_drop: Gauge,
}

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

const ACCENT_BORDER: Record<string, string> = {
  brand: 'border-l-brand',
  warm: 'border-l-warm',
  hot: 'border-l-hot',
  cool: 'border-l-cool',
  cold: 'border-l-cold',
  wet: 'border-l-wet',
  dry: 'border-l-dry',
  good: 'border-l-good',
  neutral: 'border-l-line-strong',
}

function value(section: CuriositySection, v: number): string {
  return section.signed
    ? withSign(v, section.decimals, section.unit)
    : num(v, section.decimals, section.unit)
}

/**
 * How complete the list is.
 *
 * Ten of eleven thousand days is a top ten; ten of ten is the entire answer,
 * and six of six means the question has only six answers in the whole record.
 * The difference matters enough to say it out loud.
 */
function reach(section: CuriositySection, limit: number): string {
  if (section.found <= section.days.length) {
    return section.found === 1
      ? 'Ein einziger Tag im ganzen Archiv erfüllt diese Bedingung.'
      : `Nur ${num(section.found, 0)} Tage im ganzen Archiv erfüllen diese Bedingung — die Liste ist damit vollständig.`
  }
  return `Die ${num(limit, 0)} stärksten von ${num(section.found, 0)} Tagen, für die sich die Frage überhaupt stellt.`
}

function Section({ section, limit }: { section: CuriositySection; limit: number }) {
  const Icon = ICONS[section.key] ?? Sparkles
  const tone = ACCENT_TEXT[section.accent] ?? 'text-ink'

  return (
    <Card>
      <SectionHeading icon={Icon} title={section.title} hint={section.note} />

      <ol
        className={`space-y-1.5 border-l-2 pl-3 ${ACCENT_BORDER[section.accent] ?? 'border-l-line-strong'}`}
      >
        {section.days.map((day, at) => (
          <li key={day.date} className="flex items-baseline gap-3">
            <span className="numeric w-5 shrink-0 text-right text-[11px] text-ink-faint">
              {at + 1}.
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-xs text-ink">{day.label}</span>
              <span className="block text-[11px] text-ink-faint">{day.detail}</span>
            </span>
            <span className={`numeric shrink-0 text-sm font-semibold ${tone}`}>
              {value(section, day.value)}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[10px] text-ink-faint">{reach(section, limit)}</p>
    </Card>
  )
}

export function Curiosities({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const { data, loading, error } = useApi<CuriositiesResponse>(
    `/api/weather/curiosities?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Kuriositäten werden gesucht …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const from = yearOf(Number(data.range.first.slice(0, 4)))
  const to = yearOf(Number(data.range.last.slice(0, 4)))

  return (
    <div className="space-y-6">
      <InfoPanel title={`Das Kuriositätenkabinett von ${stationName}`}>
        <p>
          Jede andere Rangliste in diesem Projekt fragt nach dem größten oder dem
          kleinsten Wert — und bekommt zuverlässig dieselben zwanzig Tage
          zurück. Hier stehen die Fragen, deren Antworten in keiner dieser Listen
          auftauchen: der wärmste Wintertag, der kälteste Sommertag, der Tag, der
          fünfzehn Grad über dem Vortag lag, der Junimorgen mit Frost.
        </p>
        <p>
          {num(data.sections.length, 0)} Fragen an{' '}
          {num(data.range.days, 0)} Messtage zwischen {from} und {to}. Nichts
          davon ist ein Rekord im üblichen Sinn — das ist der Punkt. Wo eine
          Frage sich auf das Mittel des eigenen Kalendertages bezieht, zählt
          dieser Tag erst ab {num(data.minYearsForMean, 0)} Jahren mit Messwert;
          aus zehn Beobachtungen wäre das Mittel Rauschen und jeder Tag sähe
          außergewöhnlich aus.
        </p>
      </InfoPanel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {data.sections.map((section) => (
          <Section key={section.key} section={section} limit={data.limit} />
        ))}
      </div>

      <Card>
        <SectionHeading
          icon={Sparkles}
          title="Was hier gerechnet wird"
          hint="Damit jede Zeile nachprüfbar bleibt."
        />
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Sprünge und Druckänderungen</strong>{' '}
            werden nur über echte Nachbartage gebildet. Liegt zwischen zwei
            Messwerten eine Lücke im Archiv, wäre die Differenz erfunden, und der
            Tag fällt aus der Frage heraus.
          </li>
          <li>
            <strong className="text-ink">Abweichungen</strong> beziehen sich auf
            das Mittel desselben Kalendertages über die ganze Reihe, nicht auf
            das Jahresmittel. Ein milder Februartag schlägt hier jeden
            Hochsommertag.
          </li>
          <li>
            <strong className="text-ink">Der Monatsanteil</strong> zählt erst ab{' '}
            {num(data.minMonthRain, 0)} mm Monatssumme. Sonst gewänne ein
            Nieselregen in einem sonst regenlosen Februar mit 100 %.
          </li>
          <li>
            <strong className="text-ink">Schnee und Frost außerhalb der
            Saison</strong> sind keine Ranglisten, sondern Aufzählungen: Die
            Zeile unter jeder Liste sagt, ob sie die zehn stärksten Fälle zeigt
            oder alle, die es je gab.
          </li>
        </ul>
      </Card>
    </div>
  )
}
