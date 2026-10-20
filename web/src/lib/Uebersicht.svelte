<script>
  // Die Startseite: das Wichtigste auf einen Blick, jede Kachel führt in
  // ihre Ansicht. Daten kommen aus Jahresband, Monat, Geschichte und
  // Vorhersage - dieselben Aufrufe wie in den Ansichten.
  import { MONATE, SYMBOL_TEXT, datum, de, mitVorzeichen, tagText, wetterSymbol } from "./format.js";

  let { name, band, monat, geschichte, vorhersage, modell, gehe } = $props();

  const ZONE = "Europe/Berlin";
  const STUNDE = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: ZONE });
  // nur die Zahl - "de-DE" schreibt sonst "18 Uhr"
  const stunde = (iso) => Number(STUNDE.formatToParts(new Date(iso)).find((t) => t.type === "hour").value);

  const a = $derived(vorhersage?.aktuell);
  const naechste = $derived.by(() => {
    const m = vorhersage?.modelle?.find((x) => x.id === modell && x.stunden) ?? vorhersage?.modelle?.find((x) => x.stunden);
    if (!m) return null;
    const jetzt = Date.now() - 3600 * 1000;
    const z = m.stunden.filter((s) => Date.parse(s[0]) >= jetzt).slice(0, 24);
    if (!z.length) return null;
    const temps = z.map((s) => s[1]).filter((t) => t != null);
    return {
      name: m.name,
      min: Math.min(...temps),
      max: Math.max(...temps),
      regen: z.reduce((s, x) => s + (x[3] ?? 0), 0),
      boe: z.some((s) => s[5] != null) ? Math.max(...z.map((s) => s[5] ?? 0)) : null,
      reihe: z.filter((_, i) => i % 3 === 0),
    };
  });

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
  <button class="karte kachel" onclick={() => gehe("vorhersage")}>
    <div class="lbl">Jetzt · {name}</div>
    {#if a && !a.fehler}
      <div class="zeile">
        <span class="symbol">{wetterSymbol(a.symbol, a.tag, a.zeit, vorhersage.station)}</span>
        <span class="gross num">{de(a.temp)} °C</span>
      </div>
      <div class="text-2">{SYMBOL_TEXT[a.symbol] ?? ""} · Wind {de(a.wind, 0)} km/h · Feuchte {de(a.feuchte, 0)} %</div>
      <div class="leise">DWD {a.station}</div>
    {:else}
      <div class="leise">{a?.fehler ?? "lädt …"}</div>
    {/if}
  </button>

  <button class="karte kachel breit" onclick={() => gehe("vorhersage")}>
    <div class="lbl">Nächste 24 Stunden{naechste ? ` · ${naechste.name}` : ""}</div>
    {#if naechste}
      <div class="reihe">
        {#each naechste.reihe as s}
          {@const h = stunde(s[0])}
          <div class="stunde">
            <span class="leise num">{String(h).padStart(2, "0")}</span>
            <span class="symbol klein">{wetterSymbol(s[6], s[7], s[0], vorhersage.station)}</span>
            <span class="num">{de(s[1], 0)}°</span>
          </div>
        {/each}
      </div>
      <div class="text-2">
        {de(naechste.min)} bis {de(naechste.max)} °C · Regen {de(naechste.regen)} mm{naechste.boe != null ? ` · Böen bis ${de(naechste.boe, 0)} km/h` : ""}
      </div>
    {:else}
      <div class="leise">{vorhersage ? "keine Vorhersage" : "lädt …"}</div>
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

  <div class="leise fuss">Tippen bzw. klicken führt in die Ansicht · Stand der Messwerte {datum(band?.letzter)}</div>
</div>

<style>
  .uebersicht {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    align-content: start;
    height: 100%;
    overflow: auto;
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
  .breit {
    grid-column: span 2;
  }
  .zeile {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .symbol {
    font-size: 40px;
    line-height: 1;
  }
  .symbol.klein {
    font-size: 22px;
  }
  .gross {
    font-size: 32px;
    font-weight: 300;
  }
  .text-2 {
    color: var(--text-2);
    font-size: 13px;
  }
  .reihe {
    display: flex;
    gap: 6px;
    justify-content: space-between;
    padding: 6px 0;
  }
  .stunde {
    display: grid;
    justify-items: center;
    gap: 2px;
    font-size: 13px;
  }
  .fuss {
    grid-column: 1 / -1;
  }
  @media (max-width: 700px) {
    .uebersicht {
      grid-template-columns: minmax(0, 1fr);
      height: auto;
      overflow: visible;
    }
    .breit {
      grid-column: auto;
    }
  }
</style>
