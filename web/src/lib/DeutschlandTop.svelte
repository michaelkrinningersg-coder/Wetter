<script>
  // Deutschland Top 50: für einen der letzten 7 Tage, eine Größe und eine
  // Richtung die 50 Stationen mit den höchsten bzw. niedrigsten Werten,
  // wahlweise nur unter oder ab einer Höhe.
  import { GROESSEN, HOEHEN, anzahl, top } from "./deutschland.js";
  import { de } from "./format.js";
  import Symbol from "./Symbol.svelte";

  let { daten, oeffnen, neu } = $props();

  let tag = $state(null);
  let spalte = $state("txk");
  let richtung = $state("hoch");
  let hoehe = $state("alle");

  const TAG = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  const tagText = (iso) => TAG.format(new Date(`${iso}T12:00:00Z`));
  const kurz = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

  const tage = $derived([...(daten?.tage ?? [])].reverse());
  const gewaehlt = $derived(tag && tage.includes(tag) ? tag : tage[0]);
  const g = $derived(GROESSEN.find((x) => x[0] === spalte));
  const liste = $derived(daten && !daten.leer ? top(daten, gewaehlt, spalte, richtung, hoehe) : []);
  const von = $derived(daten && !daten.leer ? anzahl(daten, gewaehlt, spalte, hoehe) : 0);
</script>

<div class="dt">
  <div class="karte kopf">
    <div class="titel">
      <div class="lbl">Deutschland · Top 50</div>
      {#if daten && !daten.leer}
        <div class="text-2">Stand {kurz(daten.stand)} · {daten.stationen.length} aktive Stationen{daten.laedt ? " · lädt neu …" : ""}</div>
      {/if}
    </div>
    <div class="knoepfe">
      {#if tage.length}
        <select class="chip an" value={gewaehlt} onchange={(e) => (tag = e.currentTarget.value)} title="Tag">
          {#each tage as t}<option value={t}>{tagText(t)}</option>{/each}
        </select>
      {/if}
      <select class="chip" class:an={hoehe !== "alle"} bind:value={hoehe} title="Höhe der Station">
        {#each HOEHEN as [k, t]}<option value={k}>{t}</option>{/each}
      </select>
      <button class="chip" onclick={neu} disabled={daten?.laedt} title="Alle Stationen neu vom DWD"><Symbol name="aktualisieren" /></button>
    </div>
    <div class="groessen gruppe">
      {#each GROESSEN as [k, t]}
        <button class="chip" class:an={spalte === k} onclick={() => (spalte = k)}>{t}</button>
      {/each}
    </div>
    <div class="gruppe">
      <button class="chip" class:an={richtung === "hoch"} onclick={() => (richtung = "hoch")}>höchste</button>
      <button class="chip" class:an={richtung === "tief"} onclick={() => (richtung = "tief")}>niedrigste</button>
    </div>
  </div>

  {#if !daten || (daten.leer && daten.laedt)}
    <div class="karte leer">Alle aktiven Stationen werden beim DWD geladen (rund 570 kleine Dateien, zusammen etwa 17 MB) – der Fortschritt steht unten bzw. oben in der Statuszeile.</div>
  {:else if daten.leer}
    <div class="karte leer">Noch keine Daten – ohne Netz lassen sie sich nicht laden.</div>
  {:else}
    <div class="karte tabelle">
      <div class="leise unter">
        {g[1]}, {richtung === "hoch" ? "höchste" : "niedrigste"} Werte am {tagText(gewaehlt)} · {von} Stationen mit Wert{hoehe !== "alle" ? ` (${HOEHEN.find((h) => h[0] === hoehe)[1]})` : ""}
      </div>
      <table>
        <thead><tr><th>Platz</th><th class="l">Station</th><th class="l">Land</th><th>Höhe</th><th>{g[1]}<small>{g[2]}</small></th></tr></thead>
        <tbody>
          {#each liste as z}
            <tr>
              <td class="num">{z.platz}</td>
              <td class="l"><button class="station" onclick={() => oeffnen(z.id)} title="Station öffnen">{z.name}</button></td>
              <td class="l leise">{z.land}</td>
              <td class="num leise">{z.hoehe} m</td>
              <td class="num wert">{de(z.wert, g[4])}</td>
            </tr>
          {/each}
          {#if !liste.length}<tr><td colspan="5" class="leise">keine Station mit Wert</td></tr>{/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .dt {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
  }
  .kopf {
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }
  .titel {
    flex: 1 1 220px;
  }
  .knoepfe {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .groessen {
    flex-wrap: wrap;
    max-width: 100%;
    border-radius: 14px;
  }
  .text-2 {
    color: var(--text-2);
    font-size: 13px;
  }
  .leer {
    padding: 16px;
  }
  .tabelle {
    padding: 8px 12px;
    overflow: auto;
    min-height: 0;
  }
  .unter {
    padding: 2px 0 6px;
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
  }
  th small {
    margin-left: 4px;
    font-weight: 400;
    color: var(--text-3);
  }
  td {
    text-align: right;
    padding: 4px 8px;
    border-bottom: 1px solid var(--rand-zart);
    white-space: nowrap;
  }
  .l {
    text-align: left;
  }
  .wert {
    font-weight: 600;
  }
  .station {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .station:hover {
    color: var(--akzent);
    text-decoration: underline;
  }
  @media (max-width: 700px) {
    .dt {
      height: auto;
    }
    .tabelle {
      overflow-x: auto;
    }
    .station {
      white-space: normal;
    }
    td,
    th {
      padding: 4px 4px;
    }
    td:nth-child(3),
    th:nth-child(3) {
      display: none;
    }
  }
</style>
