<script>
  // Wetter - die Seite. Oben die Kopfzeile (Station, Ansicht, QN, Stand,
  // Aktualisieren), darunter Jahresband oder Zeitreihe.
  //
  // Alles kommt aus Python über `rufe()`. Beim Start zeigt die Seite sofort
  // den gespeicherten Stand; was Python im Hintergrund vom DWD holt, meldet
  // `status()` mit einem Zähler - steigt er, wird die Ansicht neu geladen.
  import { onMount } from "svelte";
  import { rufe } from "./lib/api.js";
  import { MONATE, datum, tausend } from "./lib/format.js";
  import Jahresband from "./lib/Jahresband.svelte";
  import Monat from "./lib/Monat.svelte";
  import Rangliste from "./lib/Rangliste.svelte";
  import Stationswahl from "./lib/Stationswahl.svelte";
  import Zeitreihe from "./lib/Zeitreihe.svelte";

  let stationen = $state([]);
  let station = $state(null); // {station, zeitraum, abruf}
  let ansicht = $state("band");
  let qn = $state("alle");
  let jahr = $state(null);
  let groesse = $state("m");
  let aufloesung = $state("jahr");

  let monatWahl = $state(null); // [jahr, monat] oder null = letzter
  let rangModus = $state("heute");
  let rangPrognose = $state(true);

  let band = $state(null);
  let monat = $state(null);
  let liste = $state(null);
  let reihe = $state(null);
  let laedt = $state("");
  let fehler = $state("");
  let hintergrund = $state({ laeuft: "", meldung: "", stand: 0 });
  let version = $state("");

  const QN = [
    ["alle", "alle"],
    ["ab5", "ab 5"],
    ["nur10", "nur 10"],
  ];

  async function sicher(arbeit) {
    try {
      const r = await arbeit();
      if (r?.fehler) fehler = r.fehler;
      return r;
    } catch (e) {
      fehler = String(e?.message ?? e);
      return { fehler };
    }
  }

  async function stationLaden(id, mitMeldung = true) {
    const name = stationen.find((s) => s[0] === id)?.[1] ?? id;
    const hatTage = stationen.find((s) => s[0] === id)?.[6];
    if (mitMeldung && !hatTage) laedt = `${name}: erster Abruf beim DWD …`;
    const r = await sicher(() => rufe("station", id));
    laedt = "";
    if (r.fehler) return false;
    station = r;
    jahr = null;
    monatWahl = null;
    rufe("einstellung", "station", id);
    if (r.geladen) await listeNeu();
    await ansichtLaden();
    return true;
  }

  async function listeNeu() {
    const r = await rufe("stationen");
    if (r.stationen) stationen = r.stationen;
  }

  async function ansichtLaden() {
    if (!station) return;
    const id = station.station.id;
    if (ansicht === "band") {
      const r = await sicher(() => rufe("jahresband", id, jahr, qn));
      if (!r.fehler) band = r;
    } else if (ansicht === "monat") {
      const r = await sicher(() => rufe("monat", id, monatWahl?.[0] ?? null, monatWahl?.[1] ?? null, qn));
      if (!r.fehler) monat = r;
    } else if (ansicht === "rang") {
      const r = await sicher(() => rufe("rangliste", id, rangModus, rangPrognose, qn));
      if (!r.fehler) liste = r;
    } else {
      const r = await sicher(() => rufe("zeitreihe", id, groesse, aufloesung, qn));
      if (!r.fehler) reihe = r;
    }
  }

  function setze(was, wert) {
    if (was === "ansicht") ((ansicht = wert), rufe("einstellung", "ansicht", wert));
    if (was === "qn") ((qn = wert), rufe("einstellung", "qn", wert));
    if (was === "jahr") jahr = wert;
    if (was === "groesse") groesse = wert;
    if (was === "aufloesung") aufloesung = wert;
    if (was === "monat") monatWahl = wert;
    if (was === "rangModus") ((rangModus = wert), rufe("einstellung", "rang_modus", wert));
    if (was === "rangPrognose") ((rangPrognose = wert), rufe("einstellung", "rang_prognose", wert));
    ansichtLaden();
  }

  async function aktualisieren() {
    if (!station) return;
    laedt = `${station.station.name}: Abruf beim DWD …`;
    const r = await sicher(() => rufe("aktualisieren", station.station.id));
    laedt = "";
    if (!r.fehler) {
      station = { ...station, zeitraum: r.zeitraum };
      await ansichtLaden();
    }
  }

  let letzterStand = 0;
  async function horchen() {
    const s = await rufe("status").catch(() => null);
    if (s && !s.fehler) {
      hintergrund = s;
      if (s.stand !== letzterStand) {
        letzterStand = s.stand;
        await listeNeu();
        if (station) {
          const r = await rufe("station", station.station.id);
          if (!r.fehler) station = r;
          await ansichtLaden();
        }
      }
    }
    setTimeout(horchen, hintergrund.laeuft ? 700 : 3000);
  }

  onMount(async () => {
    const r = await sicher(() => rufe("start"));
    if (r.fehler) return;
    version = r.version;
    stationen = r.stationen;
    ansicht = ["band", "monat", "rang", "reihe"].includes(r.einstellungen.ansicht) ? r.einstellungen.ansicht : "band";
    rangModus = r.einstellungen.rang_modus === "jahr" ? "jahr" : "heute";
    rangPrognose = r.einstellungen.rang_prognose !== false;
    qn = r.einstellungen.qn;
    await stationLaden(r.einstellungen.station);
    horchen();
  });

  const jahreAuswahl = $derived(band?.jahre ?? []);
  const kopfStation = $derived(
    station ? { id: station.station.id, name: station.station.name, hoehe: station.station.hoehe } : null,
  );
</script>

<div class="seite">
  <header>
    <div class="logo">W</div>
    <b class="titel">Wetter</b>
    <Stationswahl {stationen} aktuell={kopfStation} wahl={(id) => stationLaden(id)} />

    <div class="gruppe">
      <button class="chip" class:an={ansicht === "band"} onclick={() => setze("ansicht", "band")}>Jahresband</button>
      <button class="chip" class:an={ansicht === "monat"} onclick={() => setze("ansicht", "monat")}>Monat</button>
      <button class="chip" class:an={ansicht === "rang"} onclick={() => setze("ansicht", "rang")}>Rangliste</button>
      <button class="chip" class:an={ansicht === "reihe"} onclick={() => setze("ansicht", "reihe")}>Zeitreihe</button>
    </div>

    {#if ansicht === "band" && band && !band.leer}
      <div class="gruppe">
        {#each jahreAuswahl.slice(0, 2) as j}
          <button class="chip" class:an={band.jahr === j} onclick={() => setze("jahr", j)}>{j}</button>
        {/each}
        <select
          class="chip"
          class:an={jahreAuswahl.indexOf(band.jahr) > 1}
          value={jahreAuswahl.indexOf(band.jahr) > 1 ? band.jahr : ""}
          onchange={(e) => setze("jahr", Number(e.currentTarget.value))}
          title="Anderes Jahr"
        >
          <option value="" disabled>…</option>
          {#each jahreAuswahl.slice(2) as j}
            <option value={j}>{j}</option>
          {/each}
        </select>
      </div>
    {:else if ansicht === "monat" && monat && !monat.leer}
      {@const [j, m] = [monat.jahr, monat.monat]}
      {@const vor = m === 1 ? [j - 1, 12] : [j, m - 1]}
      {@const nach = m === 12 ? [j + 1, 1] : [j, m + 1]}
      {@const ab = monat.erster.slice(0, 7)}
      {@const bis = monat.letzter.slice(0, 7)}
      {@const schluessel = (x) => `${x[0]}-${String(x[1]).padStart(2, "0")}`}
      <div class="gruppe">
        <button class="chip" disabled={schluessel(vor) < ab} onclick={() => setze("monat", vor)} title="Monat davor">‹</button>
        <span class="chip an monat-name">{MONATE[m - 1]} {j}</span>
        <button class="chip" disabled={schluessel(nach) > bis} onclick={() => setze("monat", nach)} title="Monat danach">›</button>
        <select
          class="chip"
          value={j}
          onchange={(e) => setze("monat", [Number(e.currentTarget.value), m])}
          title="Jahr"
        >
          {#each Array.from({ length: Number(bis.slice(0, 4)) - Number(ab.slice(0, 4)) + 1 }, (_, i) => Number(bis.slice(0, 4)) - i) as y}
            <option value={y}>{y}</option>
          {/each}
        </select>
        <button class="chip" onclick={() => setze("monat", null)} title="Zum letzten Monat mit Daten">aktuell</button>
      </div>
    {:else if ansicht === "rang"}
      <div class="gruppe">
        <button class="chip" class:an={rangModus === "heute"} onclick={() => setze("rangModus", "heute")}>bis heute</button>
        <button class="chip" class:an={rangModus === "jahr"} onclick={() => setze("rangModus", "jahr")}>bis Jahresende</button>
      </div>
      {#if rangModus === "jahr"}
        <div class="gruppe">
          <button class="chip" class:an={rangPrognose} onclick={() => setze("rangPrognose", true)}>mit Prognose</button>
          <button class="chip" class:an={!rangPrognose} onclick={() => setze("rangPrognose", false)}>ohne</button>
        </div>
      {/if}
    {:else if ansicht === "reihe"}
      <div class="gruppe">
        {#each [["m", "Mittel"], ["x", "Max"], ["n", "Min"]] as [k, t]}
          <button class="chip" class:an={groesse === k} onclick={() => setze("groesse", k)}>{t}</button>
        {/each}
      </div>
      <div class="gruppe">
        {#each [["tag", "Tag"], ["monat", "Monat"], ["jahr", "Jahr"]] as [k, t]}
          <button class="chip" class:an={aufloesung === k} onclick={() => setze("aufloesung", k)}>{t}</button>
        {/each}
      </div>
    {/if}

    <span class="raum"></span>

    <div class="gruppe" title="Qualitätsniveau des DWD: welche Tage zählen">
      <span class="qn-lbl">QN</span>
      {#each QN as [k, t]}
        <button class="chip" class:an={qn === k} onclick={() => setze("qn", k)}>{t}</button>
      {/each}
    </div>
    {#if station?.zeitraum?.bis}
      <span class="num leise" title="Letzter Tag in den Daten">Stand {datum(station.zeitraum.bis)}</span>
    {/if}
    <button class="knopf primaer" onclick={aktualisieren} disabled={!!laedt || !station}>Aktualisieren</button>
  </header>

  <main>
    {#if fehler}
      <div class="meldung fehler">
        {fehler}
        <button class="knopf" onclick={() => (fehler = "")}>OK</button>
      </div>
    {/if}

    {#if ansicht === "band" && band && !band.leer}
      <Jahresband {band} name={station.station.name} />
    {:else if ansicht === "monat" && monat && !monat.leer}
      <Monat {monat} />
    {:else if ansicht === "rang" && liste}
      <Rangliste {liste} name={station.station.name} />
    {:else if ansicht === "reihe" && reihe}
      <Zeitreihe {reihe} name={station.station.name} {groesse} {aufloesung} />
    {:else if band?.leer}
      <div class="mitte leise">Für diese Station gibt es keine Temperaturwerte.</div>
    {:else if !fehler}
      <div class="mitte leise">Lade …</div>
    {/if}
  </main>

  <footer class="leise">
    {#if band?.bilanz && ansicht === "band"}
      {@const b = band.bilanz}
      <span title="Rohwerte bleiben gespeichert; bereinigt wird beim Anzeigen">
        Bereinigt: {tausend(b.grenze_weg)} Werte außerhalb −45…+50 °C · {tausend(b.max_unter_min)} Tage Max unter Min ·
        {tausend(b.mittel_ausserhalb)} Mittel außerhalb Min…Max · {tausend(b.spruenge)} Sprünge &gt; 15 K markiert
        {#if b.qn_weg}· {tausend(b.qn_weg)} von {tausend(b.tage)} Tagen durch QN-Filter ausgeblendet{/if}
      </span>
    {/if}
    <span class="raum"></span>
    {#if hintergrund.laeuft}
      <span class="laeuft">{hintergrund.laeuft}</span>
    {:else if hintergrund.meldung}
      <span>{hintergrund.meldung}</span>
    {/if}
    <span>Daten: Deutscher Wetterdienst · {version}</span>
  </footer>

  {#if laedt}
    <div class="schleier"><div class="karte hinweis">{laedt}</div></div>
  {/if}
</div>

<style>
  .seite {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 18px;
    background: var(--flaeche);
    border-bottom: 1px solid var(--rand);
    white-space: nowrap;
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .logo {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--akzent);
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
  }
  .titel {
    font-size: 16px;
  }
  .raum {
    flex: 1;
  }
  .qn-lbl {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    padding: 3px 4px 3px 8px;
  }
  .chip:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .monat-name {
    min-width: 76px;
    text-align: center;
    cursor: default;
  }
  select.chip {
    appearance: none;
    padding-right: 11px;
  }
  main {
    padding: 16px 18px 8px;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
  footer {
    display: flex;
    gap: 14px;
    padding: 6px 18px 10px;
    white-space: nowrap;
    overflow: hidden;
  }
  .laeuft {
    color: var(--akzent);
  }
  .mitte {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 14px;
  }
  .meldung {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 12px;
    border-radius: 8px;
  }
  .meldung.fehler {
    background: var(--rot-hell);
    color: #7f1d1d;
  }
  .schleier {
    position: fixed;
    inset: 0;
    background: rgb(244 246 250 / 60%);
    display: grid;
    place-items: center;
    z-index: 20;
  }
  .hinweis {
    padding: 16px 22px;
    font-size: 15px;
  }
</style>
