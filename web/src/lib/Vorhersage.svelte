<script>
  // Aktuelles Wetter und die Vorhersage je Modell als Tabelle, Stunde für
  // Stunde: Symbol, Temperatur, Bewölkung, Niederschlag, Wind und Böen.
  // Zeiten kommen in UTC und werden hier in Ortszeit (Europe/Berlin) gezeigt.
  import { SYMBOL_TEXT, de, istTag } from "./format.js";
  import Symbol from "./Symbol.svelte";
  import ModellWahl from "./ModellWahl.svelte";
  import { ortsTag } from "./kurzfrist.js";
  import { tageswerte } from "./tageswerte.js";

  // standard: Modell-Schlüssel oder "mittel"; standardSetzen(id) merkt ihn sich
  // modell: gezeigtes Modell (Auswahl der Klappliste oder Standard), waehle(id) ändert es
  let { v, standard, standardSetzen, modell, waehle } = $props();

  const ZONE = "Europe/Berlin";
  const STUNDE = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: ZONE });
  // nur die Zahl - "de-DE" schreibt sonst "18 Uhr"
  const stunde = (iso) => Number(STUNDE.formatToParts(new Date(iso)).find((t) => t.type === "hour").value);
  const uhr = (iso) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: ZONE }).format(new Date(iso));
  const tagKopf = (iso) => new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: ZONE }).format(new Date(iso));
  const tagSchluessel = (iso) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: ZONE }).format(new Date(iso));

  const gewaehlt = $derived(v.modelle.find((m) => m.id === modell && m.stunden) ?? v.modelle.find((m) => m.stunden));

  // Tageswerte über den ganzen Ortstag 0-24 Uhr, auch die schon vergangenen Stunden
  const werte = $derived(tageswerte(gewaehlt?.stunden));
  const hh = (h) => String(h).padStart(2, "0");
  const spanne = (w) => (w.von > 0 || w.bis < 23 ? `nur ${hh(w.von)}–${hh(w.bis)} Uhr` : "") + (w.luecken ? `${w.von > 0 || w.bis < 23 ? ", " : ""}teils 6-Stunden-Werte` : "");

  // ab der laufenden Stunde, nach Tagen gruppiert
  const tage = $derived.by(() => {
    if (!gewaehlt?.stunden) return [];
    const ab = Date.now() - 3600 * 1000;
    const gruppen = [];
    for (const z of gewaehlt.stunden) {
      if (Date.parse(z[0]) < ab) continue;
      const k = tagSchluessel(z[0]);
      if (!gruppen.length || gruppen.at(-1).k !== k) gruppen.push({ k, titel: tagKopf(z[0]), werte: werte.get(ortsTag(Date.parse(z[0]))), zeilen: [] });
      gruppen.at(-1).zeilen.push(z);
    }
    return gruppen;
  });

  const a = $derived(v.aktuell);
  const wolkenBalken = (w) => `linear-gradient(90deg, var(--rand-stark) ${w ?? 0}%, transparent ${w ?? 0}%)`;
</script>

<div class="vorhersage">
  <div class="karte aktuell">
    <div class="lbl">Jetzt gemessen · {v.station.name}</div>
    {#if a?.fehler}
      <div class="leise">{a.fehler}</div>
    {:else if a}
      <div class="jetzt">
        <span class="gross-symbol"><Symbol wetter={a.symbol} tag={istTag(a.tag, a.zeit, v.station)} titel={SYMBOL_TEXT[a.symbol]} /></span>
        <span class="gross num">{de(a.temp)} °C</span>
        <div class="details">
          <div>{SYMBOL_TEXT[a.symbol] ?? ""} · Wolken {de(a.wolken, 0)} %</div>
          <div>Wind {de(a.wind, 0)} km/h, Böen {de(a.boe, 0)} km/h · Feuchte {de(a.feuchte, 0)} %</div>
          <div>Regen letzte Stunde {de(a.regen)} mm</div>
          <div class="leise">DWD-Station {a.station}{a.abstand ? ` (${de(a.abstand)} km)` : ""} · {uhr(a.zeit)} Uhr · Bright Sky</div>
        </div>
      </div>
    {/if}
  </div>

  <div class="karte modelle">
    <ModellWahl modelle={v.modelle} wert={gewaehlt?.id} {standard} {waehle} {standardSetzen} />

  </div>

  <div class="karte tabelle">
    {#if !gewaehlt}
      <div class="leise">Kein Modell liefert Werte für diesen Ort.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th class="l">Uhr</th><th></th><th>Temp.<small>°C</small></th><th class="l">Wolken<small>%</small></th>
            <th>Regen<small>mm</small></th><th>Wind<small>km/h</small></th><th>Böen<small>km/h</small></th>
          </tr>
        </thead>
        {#each tage as t}
          <tbody>
            <tr class="tag">
              <td colspan="7">
                <span class="titel">{t.titel}</span>
                {#if t.werte}
                  {@const w = t.werte}
                  <span class="tw">
                    <span title="Tagesmittel der Temperatur">Ø <b>{de(w.mittel)} °C</b></span>
                    <span title="Höchstwert">↑ <b class="warm">{de(w.max.wert)} °C</b> {hh(w.max.h)} Uhr</span>
                    <span title="Tiefstwert">↓ <b class="kalt">{de(w.min.wert)} °C</b> {hh(w.min.h)} Uhr</span>
                    <span title="Niederschlag über den Tag">
                      {#if w.regen != null && w.regen >= 0.05}<b class="nass">{de(w.regen)} mm</b>{w.arten.length ? ` ${w.arten.join(", ")}` : ""}{:else}trocken{/if}
                    </span>
                    {#if w.wind}<span title="stärkster mittlerer Wind">Wind bis <b>{de(w.wind.wert, 0)} km/h</b> {hh(w.wind.h)} Uhr</span>{/if}
                    {#if w.boe}<span title="stärkste Böe">Böen bis <b class:sturm={w.boe.wert >= 75}>{de(w.boe.wert, 0)} km/h</b> {hh(w.boe.h)} Uhr</span>{/if}
                    {#if spanne(w)}<span class="leise">{spanne(w)}</span>{/if}
                  </span>
                {/if}
              </td>
            </tr>
            {#each t.zeilen as [zeit, temp, wolken, regen, wind, boe, symbol, tag, , sp]}
              {@const h = stunde(zeit)}
              <tr class:nacht={!istTag(tag, zeit, v.station)}>
                <td class="l num">{String(h).padStart(2, "0")}</td>
                <td class="symbol"><Symbol wetter={symbol} tag={istTag(tag, zeit, v.station)} titel={SYMBOL_TEXT[symbol]} /></td>
                <td class="num temp" style:color={temp >= 25 ? "var(--rot)" : temp < 0 ? "var(--blau)" : null}>{de(temp)}{#if sp?.n > 1}<small class="spanne">{de(sp.tmin, 0)}…{de(sp.tmax, 0)}</small>{/if}</td>
                <td class="l"><span class="wolken" style:background={wolkenBalken(wolken)}>{de(wolken, 0)}</span></td>
                <td class="num" class:nass={regen >= 0.1}>{regen ? de(regen) : "–"}{#if sp?.n > 1 && regen >= 0.1}<small class="spanne">{de(sp.rmin)}…{de(sp.rmax)}</small>{/if}</td>
                <td class="num">{de(wind, 0)}</td>
                <td class="num" class:sturm={boe >= 75}>{boe == null ? "–" : de(boe, 0)}</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    {/if}
  </div>
  <div class="leise quellen">Vorhersage: Open-Meteo (CC BY 4.0) mit Modellen von DWD, KNMI, DMI, Météo-France, ECMWF, NOAA, MeteoSwiss · MET Norway · aktuell: Bright Sky (DWD)</div>
</div>

<style>
  .vorhersage {
    height: 100%;
    overflow: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    grid-template-rows: auto auto 1fr auto;
    gap: 12px;
  }
  .aktuell,
  .modelle {
    grid-column: 2;
    padding: 12px 14px;
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .tabelle {
    grid-column: 1;
    grid-row: 1 / span 4;
    padding: 6px 10px;
    overflow: auto;
    min-height: 0;
  }
  .quellen {
    grid-column: 2;
  }
  .jetzt {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 4px 12px;
  }
  .gross-symbol {
    display: flex;
    font-size: 36px;
    line-height: 1;
  }
  .gross {
    font-size: 34px;
    font-weight: 300;
  }
  .details {
    grid-column: 1 / span 2;
    font-size: 13px;
    color: var(--text-2);
    display: grid;
    gap: 2px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--flaeche);
    text-align: right;
    font-size: 12px;
    color: var(--text-2);
    padding: 5px 8px;
    border-bottom: 1px solid var(--rand);
    z-index: 1;
  }
  th small {
    display: block;
    font-weight: 400;
    color: var(--text-3);
    font-size: 10px;
  }
  td {
    text-align: right;
    padding: 3px 8px;
    border-bottom: 1px solid var(--rand);
    white-space: nowrap;
  }
  .l {
    text-align: left;
  }
  tr.tag td {
    text-align: left;
    background: var(--flaeche-2);
    padding-top: 8px;
    white-space: normal;
  }
  .titel {
    font-weight: 600;
    margin-right: 14px;
  }
  .tw {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    font-size: 12px;
    color: var(--text-2);
  }
  .tw b {
    font-weight: 600;
    color: var(--text);
  }
  .tw b.warm {
    color: var(--rot);
  }
  .tw b.kalt {
    color: var(--blau);
  }
  .tw b.nass {
    color: var(--blau);
  }
  .tw b.sturm {
    color: var(--rot);
  }
  tr.nacht td {
    background: color-mix(in srgb, var(--flaeche-2) 70%, transparent);
  }
  .symbol {
    text-align: center;
    font-size: 18px;
    width: 34px;
  }
  .temp {
    font-weight: 600;
  }
  .spanne {
    display: block;
    font-size: 10px;
    font-weight: 400;
    color: var(--text-3);
    line-height: 1.1;
  }
  .wolken {
    display: inline-block;
    min-width: 64px;
    padding: 0 4px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .nass {
    color: var(--blau);
    font-weight: 600;
  }
  .sturm {
    color: var(--rot);
    font-weight: 600;
  }
  @media (max-width: 700px) {
    .vorhersage {
      grid-template-columns: minmax(0, 1fr);
      height: auto;
      overflow: visible;
    }
    .aktuell,
    .modelle,
    .tabelle,
    .quellen {
      grid-column: 1;
      grid-row: auto;
    }
    .tabelle {
      overflow: visible;
    }
    td,
    th {
      padding: 3px 4px;
    }
  }
</style>
