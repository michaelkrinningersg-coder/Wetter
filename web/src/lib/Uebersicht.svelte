<script>
  // Die Startseite: oben das Laufband mit den Rekorden aller Stationen,
  // rechts heute und morgen Stunde für Stunde mit dem feinsten
  // Kurzfristmodell, links die Kacheln der Station - jede führt in ihre
  // Ansicht. Daten aus Jahresband, Monat, Geschichte und Vorhersage.
  import { MONATE, SYMBOL_TEXT, datum, de, istTag, mitVorzeichen, tagText } from "./format.js";
  import { heuteMorgen } from "./kurzfrist.js";
  import Laufband from "./Laufband.svelte";
  import Symbol from "./Symbol.svelte";

  let { name, band, monat, geschichte, vorhersage, rekorde = null, gehe } = $props();

  const a = $derived(vorhersage?.aktuell);
  const hm = $derived(vorhersage ? heuteMorgen(vorhersage.modelle) : null);

  const gestern = $derived.by(() => {
    if (!band?.tage?.length) return null;
    const [k, m, x, n] = band.tage.at(-1);
    const nm = band.normal.find((z) => z[0] === k);
    return { k, m, x, n, normal: nm?.[1] ?? null };
  });
  const gPlatz = $derived(geschichte?.groessen?.find((g) => g.spalte === "tmk"));
  const p = $derived(band?.prognose);
</script>

<div class="uebersicht">
  {#if rekorde?.eintraege?.length}
    <div class="band-zeile"><Laufband {rekorde} gehe={() => gehe("rekorde_de")} /></div>
  {/if}

  <div class="links">
    <button class="karte kachel jetzt" onclick={() => gehe("vorhersage")}>
      <div class="lbl">Jetzt · {name}</div>
      {#if a && !a.fehler}
        <div class="zeile">
          <span class="symbol"><Symbol wetter={a.symbol} tag={istTag(a.tag, a.zeit, vorhersage.station)} titel={SYMBOL_TEXT[a.symbol]} /></span>
          <span class="gross num">{de(a.temp)} °C</span>
        </div>
        <div class="text-2">{SYMBOL_TEXT[a.symbol] ?? ""} · Wind {de(a.wind, 0)} km/h · Feuchte {de(a.feuchte, 0)} %</div>
        <div class="leise">DWD {a.station}</div>
      {:else}
        <div class="leise">{a?.fehler ?? "lädt …"}</div>
      {/if}
    </button>

    {#if gestern}
      <button class="karte kachel" onclick={() => gehe("geschichte")}>
        <div class="lbl">Letzter Messtag · {tagText(gestern.k)}</div>
        <div class="gross num">{de(gestern.m)} °C</div>
        <div class="text-2">↑ {de(gestern.x)} · ↓ {de(gestern.n)} · normal {de(gestern.normal)}
          {#if gestern.m != null && gestern.normal != null}
            <b style:color={gestern.m > gestern.normal ? "var(--rot)" : "var(--blau)"}>{mitVorzeichen(gestern.m - gestern.normal)}</b>
          {/if}
        </div>
        {#if gPlatz?.platz_warm}<div class="leise">Platz {gPlatz.platz_warm} von {gPlatz.von} an diesem Kalendertag</div>{/if}
      </button>
    {/if}

    {#if band?.bisher}
      <button class="karte kachel" onclick={() => gehe("rang")}>
        <div class="lbl">{band.jahr} bis heute</div>
        <div class="gross num">{de(band.bisher.m)} °C</div>
        <div class="text-2">Platz <b>{band.bisher.platz ?? "–"}</b> von {band.bisher.von} Jahren</div>
      </button>
    {/if}

    {#if p}
      <button class="karte kachel" onclick={() => gehe("verlauf")}>
        <div class="lbl">Prognose 31.12.</div>
        <div class="gross num">{de(p.mitte)} °C</div>
        <div class="text-2">Band {de(p.tief, 2)} – {de(p.hoch, 2)} · Platz <b>{p.platz}</b> ({p.platz_hoch}–{p.platz_tief})</div>
      </button>
    {/if}

    {#if monat && !monat.leer}
      {@const d = monat.summe.tmk - monat.normal.tmk}
      <button class="karte kachel" onclick={() => gehe("monat")}>
        <div class="lbl">{MONATE[monat.monat - 1]} bisher</div>
        <div class="gross num">{de(monat.summe.tmk)} °C</div>
        <div class="text-2">normal {de(monat.normal.tmk)} <b style:color={d > 0 ? "var(--rot)" : "var(--blau)"}>{mitVorzeichen(d)}</b></div>
        <div class="leise">Regen {de(monat.summe.rsk)} von {de(monat.normal.rsk)} mm (normal bis {monat.bis_tag}.)</div>
      </button>
    {/if}
  </div>

  <div class="karte hm">
    <div class="hm-kopf">
      <span class="lbl">Heute und morgen{hm ? ` · ${hm.modell}` : ""}</span>
      <button class="chip" onclick={() => gehe("vorhersage")}>alle Modelle ›</button>
    </div>
    {#if hm}
      <div class="hm-tage">
        {#each hm.tage as t}
          <div class="hm-tag">
            <div class="hm-titel">
              <b>{t.titel}</b> <span class="leise">{t.datum}</span>
              <div class="text-2">
                <span class="num" style:color="var(--blau)">{de(t.min, 0)}°</span> / <span class="num" style:color="var(--rot)">{de(t.max, 0)}°</span>
                · Regen {de(t.regen)} mm
              </div>
            </div>
            <table>
              <tbody>
                {#each t.stunden as s}
                  <tr class:nacht={!istTag(s.tagLicht, s.zeit, vorhersage.station)} class:ersatz={s.ersatz} title={s.ersatz ? `aus ${s.ersatz}` : null}>
                    <td class="num leise">{String(s.h).padStart(2, "0")}</td>
                    <td class="sym"><Symbol wetter={s.symbol} tag={istTag(s.tagLicht, s.zeit, vorhersage.station)} titel={SYMBOL_TEXT[s.symbol]} /></td>
                    <td class="num temp" style:color={s.temp >= 25 ? "var(--rot)" : s.temp < 0 ? "var(--blau)" : null}>{de(s.temp)}°</td>
                    <td class="num" class:nass={s.regen >= 0.1}>{s.regen >= 0.1 ? `${de(s.regen)} mm` : ""}</td>
                    <td class="num leise">{de(s.wind, 0)}{s.boe != null && s.boe >= 40 ? `/${de(s.boe, 0)}` : ""}</td>
                  </tr>
                {/each}
                {#if !t.stunden.length}<tr><td class="leise" colspan="5">keine Werte</td></tr>{/if}
              </tbody>
            </table>
          </div>
        {/each}
      </div>
      {#if hm.tage.some((t) => t.stunden.some((s) => s.ersatz))}
        <div class="leise">Blasser: jenseits der Reichweite von {hm.modell}, Werte aus {hm.tage.flatMap((t) => t.stunden).find((s) => s.ersatz)?.ersatz}.</div>
      {/if}
      <div class="leise">Wind km/h, ab 40 km/h mit Böen (Wind/Böe)</div>
    {:else}
      <div class="leise">{vorhersage ? "kein Kurzfristmodell liefert Werte für diesen Ort" : "lädt …"}</div>
    {/if}
  </div>

  <div class="leise fuss">Tippen bzw. klicken führt in die Ansicht · Stand der Messwerte {datum(band?.letzter)}</div>
</div>

<style>
  .uebersicht {
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 12px;
    height: 100%;
    overflow: hidden;
  }
  .band-zeile {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .links {
    display: grid;
    gap: 12px;
    align-content: start;
    overflow: auto;
    min-height: 0;
  }
  .kachel {
    display: grid;
    gap: 4px;
    align-content: start;
    padding: 14px 16px;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .kachel:hover {
    border-color: var(--akzent);
  }
  .zeile {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .symbol {
    display: flex;
    font-size: 34px;
    line-height: 1;
  }
  .gross {
    font-size: 32px;
    font-weight: 300;
  }
  .text-2 {
    color: var(--text-2);
    font-size: 13px;
  }
  .hm {
    padding: 12px 14px;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    gap: 6px;
    min-height: 0;
  }
  .hm-kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hm-tage {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    overflow: auto;
    min-height: 0;
    align-items: start;
  }
  .hm-titel {
    position: sticky;
    top: 0;
    background: var(--flaeche);
    padding-bottom: 4px;
    border-bottom: 1px solid var(--rand);
    z-index: 1;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  td {
    padding: 2px 4px;
    border-bottom: 1px solid var(--rand-zart);
    text-align: right;
    white-space: nowrap;
  }
  td:first-child {
    text-align: left;
  }
  td.sym {
    text-align: center;
    font-size: 17px;
    width: 30px;
  }
  .temp {
    font-weight: 600;
  }
  .nass {
    color: var(--blau);
  }
  tr.nacht td {
    background: color-mix(in srgb, var(--flaeche-2) 70%, transparent);
  }
  tr.ersatz {
    opacity: 0.6;
  }
  .fuss {
    grid-column: 1 / -1;
  }
  @media (max-width: 700px) {
    .uebersicht {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      height: auto;
      overflow: visible;
    }
    .links {
      display: contents;
    }
    .jetzt {
      order: 1;
    }
    .hm {
      order: 2;
    }
    .links > :not(.jetzt) {
      order: 3;
    }
    .fuss {
      order: 4;
    }
    .hm-tage {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      overflow: visible;
    }
    .hm-titel {
      position: static;
    }
    td {
      padding: 2px 2px;
      font-size: 12px;
    }
  }
</style>
