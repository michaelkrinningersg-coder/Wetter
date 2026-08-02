import {
  ArrowRight,
  CalendarClock,
  CalendarHeart,
  Fingerprint,
  Flower2,
  Map,
  Radiation as RadiationIcon,
  Radio,
  Thermometer,
  Trophy,
  Waves,
  Wind,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

import { useApi } from '../lib/api'
import { isoToGerman, num, shareOf, signed } from '../lib/format'
import type { DashboardResponse } from '../types'
import { type Accent, Card, ErrorState, InfoPanel, Loading, SectionHeading } from './ui'

/**
 * Accent classes spelled out rather than composed.
 *
 * Tailwind scans the source for complete class names; `bg-${accent}` is
 * invisible to it and the rule would simply be missing from the stylesheet at
 * runtime. Every other component in this project maps them the same way.
 */
const ACCENT_BAR: Record<Accent, string> = {
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

const ACCENT_TEXT: Record<Accent, string> = {
  brand: 'text-brand',
  warm: 'text-warm',
  hot: 'text-hot',
  cool: 'text-cool',
  cold: 'text-cold',
  wet: 'text-wet',
  dry: 'text-dry',
  good: 'text-good',
  neutral: 'text-ink-muted',
}

/*
 * The opening view.
 *
 * Deliberately built without the chart library. It is the one view every
 * visitor loads, and recharts is 167 kB gzipped — two thirds of everything the
 * app ships. Keeping it out of the first paint is worth more here than a
 * sparkline would be, and nothing on this page needs one: it is figures, ranks
 * and comparisons, each of which links into the view that draws them properly.
 */

/** Where a tile sends you. Built here so the links use the same URL grammar. */
function link(tab: string, params: Record<string, string | number> = {}): string {
  const query = new URLSearchParams({ bereich: tab })
  for (const [key, value] of Object.entries(params)) query.set(key, String(value))
  return `?${query.toString()}`
}

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="group mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint transition-colors hover:text-brand"
    >
      {children}
      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </a>
  )
}

function Tile({
  icon: Icon,
  title,
  accent = 'brand',
  children,
}: {
  icon: ComponentType<LucideProps>
  title: string
  accent?: Accent
  children: React.ReactNode
}) {
  return (
    <Card className="relative overflow-hidden" padded={false}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${ACCENT_BAR[accent]}`} aria-hidden />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="label">{title}</span>
          <Icon className={`size-4 shrink-0 ${ACCENT_TEXT[accent]}`} aria-hidden />
        </div>
        {children}
      </div>
    </Card>
  )
}

/** A departure from normal, coloured by direction and read as a sentence. */
function Anomaly({ value, unit = 'K' }: { value: number | null; unit?: string }) {
  if (value === null) return null
  const warm = value > 0
  return (
    <span
      className={`numeric rounded px-1.5 py-0.5 text-xs font-semibold ${
        Math.abs(value) < 0.5
          ? 'bg-raised text-ink-muted'
          : warm
            ? 'bg-hot/15 text-hot'
            : 'bg-cold/15 text-cold'
      }`}
    >
      {signed(value, 1)} {unit}
    </span>
  )
}

/**
 * A horizontal position marker — where a value sits between two bounds.
 *
 * Twelve lines of CSS instead of a charting dependency; at this size a library
 * would draw the same three rectangles.
 */
function Marker({ value, min, max, label }: { value: number; min: number; max: number; label?: string }) {
  const pos = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-inset">
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-canvas"
          style={{ left: `${pos}%` }}
          aria-hidden
        />
      </div>
      {label && <p className="mt-1 text-[10px] text-ink-faint">{label}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function Dashboard({ stationName }: { stationName: string }) {
  const { data, loading, error } = useApi<DashboardResponse>('/api/dashboard')

  if (loading && !data) return <Loading message="Überblick wird zusammengestellt …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { latest, year, germany, records, today, twin, ticker, monthBalance, environment } = data
  const pollen = environment.pollen
  const air = environment.air
  const radiation = environment.radiation

  // The background station carries the components a first glance wants.
  const airPicks = (air?.values ?? []).filter(
    (v) => v.kind === 'background' && ['no2', 'o3', 'pm10'].includes(v.component),
  )

  return (
    <div className="space-y-6">
      <InfoPanel title={`${stationName} auf einen Blick`}>
        <p>
          Alles hier steht auch in den Detailansichten — dies ist die Auswahl,
          die eine Frage sofort beantwortet, mit einem Weg in die Ansicht, die
          sie ausführlich zeigt. Abweichungen sind gegen die Referenzperiode{' '}
          {latest?.reference.from}–{latest?.reference.to} gerechnet.
        </p>
      </InfoPanel>

      {/* ---------------------------------------------------------------- */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {latest && (
          <Tile icon={Thermometer} title={`Letzter Messtag · ${isoToGerman(latest.date)}`} accent="brand">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {latest.temp_mean === null ? '—' : `${num(latest.temp_mean, 1)} °C`}
              <span className="ml-2 align-middle">
                <Anomaly value={latest.anomaly?.temp_mean ?? null} />
              </span>
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              {latest.temp_min === null ? '—' : num(latest.temp_min, 1)} bis{' '}
              {latest.temp_max === null ? '—' : num(latest.temp_max, 1)} °C
              {latest.precipitation !== null && latest.precipitation > 0 && (
                <> · {num(latest.precipitation, 1)} mm Niederschlag</>
              )}
              {latest.sunshine !== null && <> · {num(latest.sunshine, 1)} h Sonne</>}
            </p>
            {latest.normal && (
              <p className="mt-1 text-[11px] text-ink-faint">
                Üblich an diesem Datum: {num(latest.normal.temp_mean, 1)} °C, gemittelt
                über {num(latest.normal.days, 0)} Tage im Fenster von ±{latest.windowDays}{' '}
                Tagen.
              </p>
            )}
            {latest.rank && (
              <p className="mt-1.5 text-[11px] text-ink-muted">
                Wärmster{' '}
                <span className="numeric text-ink">
                  {num(latest.rank.place, 0)}.
                </span>{' '}
                von {num(latest.rank.of, 0)} gemessenen {latest.day}.{latest.month}.
              </p>
            )}
            <TileLink href={link('overview', { jahr: latest.year, monat: latest.month })}>
              Monatsübersicht
            </TileLink>
          </Tile>
        )}

        {year && (
          <Tile icon={CalendarHeart} title={`Jahr ${year.year} bis ${year.upTo}`} accent="warm">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {num(year.mean, 1)} °C
              <span className="ml-2 align-middle">
                <Anomaly value={year.anomaly} />
              </span>
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              Platz <span className="numeric text-ink">{num(year.place, 0)}</span> von{' '}
              {num(year.of, 0)} Jahren — von warm nach kalt.
            </p>
            {year.referenceMean !== null && (
              <Marker
                value={year.place}
                min={1}
                max={year.of}
                label={`Mittel ${year.reference.from}–${year.reference.to}: ${num(year.referenceMean, 1)} °C · aus ${num(year.days, 0)} Messtagen`}
              />
            )}
            <TileLink href={link('ytd-temp')}>Mitteltemperatur YTD</TileLink>
          </Tile>
        )}

        {today && (
          <Tile icon={CalendarHeart} title={`Der ${today.day}. ${monthName(today.month)} im Archiv`} accent="cool">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {today.meanOfDay === null ? '—' : `${num(today.meanOfDay, 1)} °C`}
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              Mittel aus {num(today.count, 0)} Jahren
              {today.firstYear && <> ({today.firstYear}–{today.lastYear})</>}
            </p>
            <ul className="mt-2 space-y-0.5 text-[11px]">
              {today.holders.warmest && (
                <li className="text-ink-muted">
                  Wärmster: <span className="numeric text-hot">{num(today.holders.warmest.value, 1)} °C</span>{' '}
                  im Jahr {today.holders.warmest.year}
                </li>
              )}
              {today.holders.coldest && (
                <li className="text-ink-muted">
                  Kältester: <span className="numeric text-cold">{num(today.holders.coldest.value, 1)} °C</span>{' '}
                  im Jahr {today.holders.coldest.year}
                </li>
              )}
              {today.holders.wettest && (
                <li className="text-ink-muted">
                  Nassester: <span className="numeric text-wet">{num(today.holders.wettest.value, 1)} mm</span>{' '}
                  im Jahr {today.holders.wettest.year}
                </li>
              )}
            </ul>
            <TileLink href={link('day-in-history', { monat: today.month, tag: today.day })}>
              Dieser Tag in der Geschichte
            </TileLink>
          </Tile>
        )}

        {ticker && ticker.length > 0 && (
          <Tile icon={Radio} title="Was gerade läuft" accent="brand">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {num(ticker[0]!.days, 0)}{' '}
              <span className="text-sm font-normal text-ink-muted">
                {ticker[0]!.days === 1 ? 'Tag' : 'Tage'}
              </span>
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">{ticker[0]!.label}</p>
            <ul className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
              {ticker.map((row) => (
                <li key={row.key}>
                  <span className="numeric text-ink">{num(row.days, 0)}</span> von{' '}
                  <span className="numeric">{num(row.record, 0)}</span> — {row.label}
                  {row.complete ? '' : ' (teils unbelegt)'}
                </li>
              ))}
              <li className="text-ink-faint">
                Stand {isoToGerman(ticker[0]!.reference)} — gezeigt wird nur, was
                seltener als zweimal im Jahr so weit kommt
              </li>
            </ul>
            <TileLink href={link('spells', { ansicht: 'ticker' })}>Serien-Ticker</TileLink>
          </Tile>
        )}

        {monthBalance && (
          <Tile icon={CalendarClock} title={`${monthBalance.monthName} ${monthBalance.year}`} accent="hot">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {num(monthBalance.value, monthBalance.decimals)}{' '}
              <span className="text-sm font-normal text-ink-muted">{monthBalance.unit}</span>
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              Stand nach {num(monthBalance.measured, 0)} von {num(monthBalance.monthLength, 0)}{' '}
              Tagen{monthBalance.missing > 0 ? ` (${num(monthBalance.missing, 0)} ohne Messwert)` : ''}
            </p>
            <ul className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
              <li>
                gemessen: Platz{' '}
                <span className="numeric text-ink">{num(monthBalance.window.rank, 0)}</span> von{' '}
                {num(monthBalance.window.total, 0)} — gegen dieselben Tage aller Jahre
              </li>
              {monthBalance.spread && monthBalance.members ? (
                <li>
                  noch offen: Endplatz zwischen{' '}
                  <span className="numeric text-ink">{num(monthBalance.spread.p90, 0)}</span> und{' '}
                  <span className="numeric text-ink">{num(monthBalance.spread.p10, 0)}</span> aus{' '}
                  {num(monthBalance.members, 0)} nachgespielten Jahren
                </li>
              ) : (
                <li className="text-ink-faint">Der Monat ist durch — nichts mehr offen.</li>
              )}
            </ul>
            <TileLink href={link('overview', { ansicht: 'bilanz', monat: monthBalance.month, jahr: monthBalance.year })}>
              Monatsbilanz
            </TileLink>
          </Tile>
        )}

        {twin && (
          <Tile icon={Fingerprint} title="Wetterzwilling" accent="brand">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {isoToGerman(twin.twin)}
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              der Tag, der dem {isoToGerman(twin.date)} am meisten ähnelt —{' '}
              {num(twin.yearsApart, 0)} Jahre entfernt
            </p>
            <ul className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
              <li>
                Abstand <span className="numeric text-ink">{num(twin.distance, 2)}</span> σ über{' '}
                {num(twin.fields, 0)} Größen, üblich sind{' '}
                <span className="numeric">{num(twin.median, 2)}</span>
              </li>
              {twin.percentile !== null && (
                <li>
                  <span className="numeric">{shareOf(twin.percentile)}</span> aller Tage haben
                  einen näheren Zwilling
                </li>
              )}
              <li>
                im Kalender <span className="numeric">{num(twin.calendarGap, 0)}</span> Tage
                auseinander
              </li>
            </ul>
            <TileLink href={link('twins')}>Wetterzwillinge</TileLink>
          </Tile>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}

      {germany && germany.picks.length > 0 && (
        <Card>
          <SectionHeading
            icon={Map}
            title={`Deutschland am ${isoToGerman(germany.date)}`}
            hint={
              germany.stations
                ? `Aus ${num(germany.stations, 0)} meldenden Stationen beider DWD-Netze.`
                : undefined
            }
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {germany.picks.map((pick) => (
              <div key={pick.key} className="rounded-card border border-line bg-raised p-4">
                <p className="label truncate">{pick.short}</p>
                <p className="numeric mt-1.5 text-2xl font-semibold tracking-tight text-ink">
                  {num(pick.value, pick.decimals)}
                  <span className="ml-1 text-xs font-normal text-ink-faint">{pick.unit}</span>
                </p>
                <p className="mt-1 truncate text-[11px] text-ink-muted" title={pick.station}>
                  {pick.station}
                </p>
                <p className="truncate text-[10px] text-ink-faint">
                  {pick.state}
                  {pick.elevation !== null && <> · {num(pick.elevation, 0)} m</>}
                </p>
              </div>
            ))}
          </div>
          <TileLink href={link('germany', { datum: germany.date })}>
            Alle acht Kategorien mit den Top 50
          </TileLink>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {records && (
          <Tile icon={Trophy} title={`Allzeitrekorde am ${isoToGerman(records.date)}`} accent="hot">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {num(records.count, 0)}
              <span className="ml-2 text-xs font-normal text-ink-faint">
                {records.count === 1 ? 'Station' : 'Stationen'}
              </span>
            </p>
            {records.count === 0 ? (
              <p className="mt-1.5 text-xs text-ink-muted">
                An diesem Tag brach keine Station ihren eigenen Höchst- oder
                Tiefstwert.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-[11px]">
                {records.events.map((event, i) => (
                  <li key={`${event.station}-${i}`} className="truncate text-ink-muted">
                    <span className="text-ink">{event.name}</span> — {event.label}
                  </li>
                ))}
              </ul>
            )}
            <TileLink href={link('records', { datum: records.date })}>Rekordseite</TileLink>
          </Tile>
        )}

        {environment.gauges.length > 0 && (
          <Tile icon={Waves} title="Flusspegel" accent="wet">
            <ul className="mt-3 space-y-2">
              {environment.gauges.map((gauge) => (
                <li key={gauge.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-xs text-ink">
                    {gauge.name}
                    <span className="ml-1.5 text-[10px] text-ink-faint">{gauge.water}</span>
                  </span>
                  <span className="numeric shrink-0 text-sm font-semibold text-ink">
                    {gauge.value === null ? '—' : `${num(gauge.value, 0)} cm`}
                    {gauge.mean !== null && gauge.value !== null && (
                      <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                        Mittel {num(gauge.mean, 0)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-ink-faint">
              {environment.gauges.every((g) => (g.level ?? 0) === 0)
                ? 'Keine Meldestufe erreicht.'
                : 'Mindestens ein Pegel über einer Meldestufe.'}
            </p>
            <TileLink href={link('gauges')}>Pegelverlauf</TileLink>
          </Tile>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pollen && (
          <Tile icon={Flower2} title={`Pollen · ${isoToGerman(pollen.issued)}`} accent="good">
            {pollen.active.length === 0 ? (
              <>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-good">keine</p>
                <p className="mt-1.5 text-xs text-ink-muted">
                  Alle {pollen.total} Arten auf Stufe 0.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                  {pollen.active.length}
                  <span className="ml-1.5 text-xs font-normal text-ink-faint">
                    von {pollen.total} Arten
                  </span>
                </p>
                <ul className="mt-2 space-y-1 text-[11px]">
                  {pollen.active.map((kind) => (
                    <li key={kind.label} className="flex items-baseline justify-between gap-2">
                      <span className="text-ink-muted">{kind.label}</span>
                      <span className="numeric font-semibold text-ink">{kind.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <TileLink href={link('pollen')}>Pollenvorhersage</TileLink>
          </Tile>
        )}

        {air && airPicks.length > 0 && (
          <Tile icon={Wind} title={`Luft · ${isoToGerman(air.date)} ${String(air.hour).padStart(2, '0')}:00`} accent="cool">
            <ul className="mt-3 space-y-1.5">
              {airPicks.map((value) => (
                <li key={value.component} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-ink-muted">{value.short}</span>
                  <span className="numeric text-sm font-semibold text-ink">
                    {num(value.value, value.decimals)}
                    <span className="ml-1 text-[10px] font-normal text-ink-faint">
                      {value.unit}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-ink-faint">
              Städtischer Hintergrund. Zeit wie vom UBA veröffentlicht.
            </p>
            <TileLink href={link('air')}>Luftqualität</TileLink>
          </Tile>
        )}

        {radiation && (
          <Tile icon={RadiationIcon} title="Ortsdosisleistung" accent="neutral">
            <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink">
              {num(radiation.value, 3)}
              <span className="ml-1 text-xs font-normal text-ink-faint">µSv/h</span>
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              Sonde {radiation.probe}
              {radiation.distance === 0 ? ' (an der Wetterstation)' : ` · ${num(radiation.distance, 1)} km`}
            </p>
            {radiation.mean !== null && (
              <p className="mt-1 text-[11px] text-ink-faint">
                Mittel dieser Sonde über {num(radiation.days, 0)} Tage:{' '}
                {num(radiation.mean, 3)} µSv/h
              </p>
            )}
            <TileLink href={link('radiation')}>Alle elf Sonden</TileLink>
          </Tile>
        )}
      </div>
    </div>
  )
}

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month)
}
