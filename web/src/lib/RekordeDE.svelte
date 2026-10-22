<script>
  // Rekorde Deutschland: neue Rekorde aller aktiven Stationen der letzten
  // 12 Monate (rekorde_de.py), nach Tagen. Im Dropdown nur Tage mit
  // Rekorden, darunter nur die Kategorien, in denen es welche gab.
  import { de } from "./format.js";
  import Symbol from "./Symbol.svelte";

  let { daten, oeffnen, neu, rechnen = null } = $props();

  // Reihenfolge der Kategorien wie in der Rekorde-Ansicht der Station
  const REIHE = ["Höchstwert", "wärmstes Tagesmittel", "wärmste Nacht", "Tiefstwert", "kältestes Tagesmittel", "kältester Höchstwert", "Erdbodenminimum", "Niederschlag", "Böe", "Sonnenschein", "Schneehöhe"];
  const TAG = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  const tagText = (iso) => TAG.format(new Date(`${iso}T12:00:00Z`));
  const kurz = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

  const tage = $derived.by(() => {
    const m = new Map();
    for (const e of daten?.eintraege ?? []) {
      if (!m.has(e.datum)) m.set(e.datum, []);
      m.get(e.datum).push(e);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  });
  let gewaehlt = $state(null);
  const tag = $derived(tage.find(([d]) => d === gewaehlt) ?? tage[0]);
  const kategorien = $derived.by(() => {
    if (!tag) return [];
    const m = new Map();
    for (const e of tag[1]) {
      if (!m.has(e.kategorie)) m.set(e.kategorie, []);
      m.get(e.kategorie).push(e);
    }
    const ord = (k) => (REIHE.indexOf(k) < 0 ? 99 : REIHE.indexOf(k));
    return [...m.entries()]
      .sort((a, b) => ord(a[0]) - ord(b[0]))
      .map(([k, liste]) => [k, liste.sort((a, b) => a.platz - b.platz || (a.richtung === "hoch" ? b.wert - a.wert : a.wert - b.wert))]);
  });
  const symbolVon = (spalte) => ({ txk: "sonne", tmk: "wellen", tnk: "wellen", rsk: "niederschlag", fx: "wind", sdk: "sonne", shk: "schnee", tgk: "frost" })[spalte] ?? "rekorde";
</script>

<div class="rde">
  <div class="karte kopf">
    <div>
      <div class="lbl">Rekorde Deutschland · letzte 12 Monate</div>
      {#if daten && !daten.leer}
        <div class="text-2">
          Stand {kurz(daten.stand)} · {daten.stationen} Stationen · {daten.eintraege.length} Rekorde
        </div>
      {/if}
      <div class="leise" title="Gleicher Wert wie früher: der frühere bleibt vorn · Quelle: {daten.quelle}">Reihe ab 3 Jahren: Platz 1 · ab 20: Top 3 · ab 30: Top 5 · ab 50: Top 10</div>
    </div>
    <div class="knoepfe">
      {#if tage.length}
        <select class="chip an" value={tag?.[0]} onchange={(e) => (gewaehlt = e.currentTarget.value)} title="Tag">
          {#each tage as [d, liste]}<option value={d}>{tagText(d)} · {liste.length}</option>{/each}
        </select>
      {/if}
      <button class="chip" onclick={neu} title="Neu laden"><Symbol name="aktualisieren" /></button>
      {#if daten?.selbst && rechnen}
        <button class="chip" onclick={rechnen} disabled={daten.rechnet} title="Alle aktiven Stationen laden (beim ersten Mal rund 400 MB) und selbst rechnen">
          {daten.rechnet ? "rechnet …" : "selbst rechnen"}
        </button>
      {/if}
    </div>
  </div>

  {#if !daten}
    <div class="leise">lädt …</div>
  {:else if daten.leer}
    <div class="karte leer">
      Noch keine Rekorddaten da. Die GitHub-Aktion „Rekorde Deutschland“ rechnet sie jeden Morgen{daten.selbst ? " – oder hier selbst rechnen" : ""}.
    </div>
  {:else if tag}
    <div class="raster">
      {#each kategorien as [k, liste]}
        <div class="karte kat">
          <div class="kat-kopf"><Symbol name={symbolVon(liste[0].spalte)} /> <b>{k}</b> <span class="leise">{liste.length}</span></div>
          {#each liste as e}
            <div class="zeile">
              <button class="station" onclick={() => oeffnen(e.id)} title="Station öffnen">{e.name}</button>
              <span class="num wert">{de(e.wert)} {e.einheit}</span>
              <span class="platz" class:eins={e.platz === 1}>{e.platz === 1 ? "Rekord" : `Platz ${e.platz}`}</span>
              <span class="leise klein">
                {e.land} · {e.hoehe} m · Reihe seit {e.seit}{e.von > 1 ? ` · zählt bis Top ${e.von}` : ""}
                {#if e.bisher} · bisher {de(e.bisher[0])} {e.einheit} ({kurz(e.bisher[1])}){/if}
              </span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .rde {
    height: 100%;
    overflow: auto;
    display: grid;
    align-content: start;
    gap: 12px;
  }
  .kopf {
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-between;
    align-items: start;
  }
  .kopf > div:first-child {
    flex: 1 1 320px;
    display: grid;
    gap: 3px;
  }
  .knoepfe {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .text-2 {
    color: var(--text-2);
    font-size: 13px;
  }
  .leer {
    padding: 16px;
  }
  .raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 12px;
    align-items: start;
  }
  .kat {
    padding: 10px 12px;
    display: grid;
    gap: 2px;
  }
  .kat-kopf {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rand);
  }
  .zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 2px 8px;
    align-items: baseline;
    padding: 5px 0;
    border-bottom: 1px solid var(--rand-zart);
  }
  .zeile .klein {
    grid-column: 1 / -1;
    font-size: 12px;
  }
  .station {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .station:hover {
    color: var(--akzent);
    text-decoration: underline;
  }
  .wert {
    font-weight: 600;
  }
  .platz {
    font-size: 11px;
    padding: 0 7px;
    border-radius: 9px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    white-space: nowrap;
  }
  .platz.eins {
    background: var(--akzent);
    border-color: var(--akzent);
    color: #fff;
    font-weight: 700;
  }
  @media (max-width: 700px) {
    .rde {
      height: auto;
      overflow: visible;
    }
    .raster {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
