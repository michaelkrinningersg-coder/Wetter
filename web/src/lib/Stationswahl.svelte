<script>
  // Die Stationswahl: ein Knopf mit Name, Nummer und Höhe; ein Klick öffnet
  // die Suche über alle Stationen der DWD-Liste. Gesucht wird hier in der
  // Seite - 1.386 Zeilen sind schneller durchsucht als ein Aufruf dauert.
  import { suchen, tausend } from "./format.js";
  import { meinStandort, naechsteStation } from "./standort.js";
  import Symbol from "./Symbol.svelte";

  let { stationen = [], favoriten = [], aktuell = null, wahl, vollbild = false } = $props();

  let offen = $state(false);
  let text = $state("");
  let markiert = $state(0);
  let feld = $state();

  // ohne Suchtext: Favoriten zuerst, dann die schon geladenen, dann alle
  const treffer = $derived.by(() => {
    if (text.trim()) return suchen(stationen, text);
    const fav = favoriten.map((f) => stationen.find((s) => s[0] === f)).filter(Boolean);
    const geladen = stationen.filter((s) => s[6] && !favoriten.includes(s[0]));
    const rest = stationen.filter((s) => !s[6] && !favoriten.includes(s[0]));
    return [...fav, ...geladen, ...rest].slice(0, 80);
  });
  const jahrHeute = new Date().getFullYear();

  export function oeffnen() {
    offen = true;
    text = "";
    markiert = 0;
    queueMicrotask(() => feld?.focus());
  }

  // nächste aktive Station zum Standort des Geräts
  let naheText = $state("");
  async function inDerNaehe() {
    naheText = "Standort wird bestimmt …";
    try {
      const ort = await meinStandort(true);
      const n = naechsteStation(stationen, ort.lat, ort.lon);
      if (!n) throw new Error("keine aktive Station mit Lage in der Liste");
      naheText = "";
      offen = false;
      wahl(n[0][0]);
    } catch (e) {
      naheText = e.message;
    }
  }
  export function inDerNaeheWaehlen() {
    return inDerNaehe();
  }

  function nehmen(s) {
    offen = false;
    wahl(s[0]);
  }

  function taste(e) {
    if (e.key === "Escape") offen = false;
    else if (e.key === "ArrowDown") {
      markiert = Math.min(markiert + 1, treffer.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      markiert = Math.max(markiert - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter" && treffer[markiert]) nehmen(treffer[markiert]);
  }

  $effect(() => {
    text;
    markiert = 0;
  });
</script>

<div class="wahl-rahmen" class:vollbild>
  <button class="wahl" onclick={oeffnen} title="Station wählen">
    <b>{aktuell?.name ?? "Station wählen"}</b>
    {#if aktuell}
      <small class="num">{String(aktuell.id).padStart(5, "0")} · {aktuell.hoehe} m</small>
    {/if}
    <span class="pfeil">▾</span>
  </button>

  {#if offen}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="schleier" onclick={() => (offen = false)}></div>
    <div class="liste karte">
      <div class="suchzeile">
        <input
          bind:this={feld}
          bind:value={text}
          onkeydown={taste}
          class="feld"
          placeholder="Name, Nummer oder Bundesland"
        />
        <button class="knopf nahe" onclick={inDerNaehe} title="Nächste aktive Station zum Standort dieses Geräts"><Symbol name="standort" /> In meiner Nähe</button>
        {#if vollbild}<button class="knopf" onclick={() => (offen = false)}>Schließen</button>{/if}
      </div>
      {#if naheText}<div class="leise nahe-text">{naheText}</div>{/if}
      <div class="zeilen">
        {#each treffer as s, i (s[0])}
          {@const [id, name, land, hoehe, von, bis, tage] = s}
          {@const aktiv = bis && Number(bis.slice(0, 4)) >= jahrHeute - 1}
          <button
            class="zeile"
            class:markiert={i === markiert}
            class:alt={!aktiv}
            onmouseenter={() => (markiert = i)}
            onclick={() => nehmen(s)}
          >
            <span class="name">{#if favoriten.includes(id)}<Symbol name="favorit_an" groesse="1em" /> {/if}{name}</span>
            <span class="num klein">{String(id).padStart(5, "0")}</span>
            <span class="klein">{land}</span>
            <span class="num klein rechts">{von}–{aktiv ? "heute" : bis?.slice(0, 4)}</span>
            <span class="klein marke">{tage ? `${tausend(tage)} Tage` : ""}</span>
          </button>
        {:else}
          <div class="leise" style="padding:12px">Keine Station gefunden</div>
        {/each}
      </div>
      <div class="leise fuss">
        {tausend(stationen.length)} Stationen · <Symbol name="favorit_an" groesse="1em" /> Favorit · grau: keine aktuellen Daten mehr · mit Tagen: schon geladen
      </div>
    </div>
  {/if}
</div>

<style>
  .nahe {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .nahe-text {
    padding: 4px 12px;
  }
  .wahl-rahmen {
    position: relative;
  }
  .wahl {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rand-stark);
    border-radius: 8px;
    background: var(--flaeche);
    color: var(--text);
    cursor: pointer;
  }
  .wahl:hover {
    border-color: var(--text-3);
  }
  .wahl b {
    font-size: 15px;
  }
  .wahl small {
    color: var(--text-3);
    font-size: 12px;
  }
  .pfeil {
    font-size: 12px;
  }
  .schleier {
    position: fixed;
    inset: 0;
    z-index: 10;
  }
  .liste {
    position: absolute;
    top: 38px;
    left: 0;
    z-index: 11;
    width: 640px;
    padding: 10px;
    box-shadow: var(--schatten-hoch);
    display: grid;
    gap: 8px;
  }
  .suchzeile {
    display: flex;
    gap: 8px;
  }
  .liste .feld {
    flex: 1;
    min-width: 0;
  }
  .zeilen {
    max-height: 420px;
    overflow: auto;
  }
  .zeile {
    display: grid;
    grid-template-columns: 1fr 56px 150px 90px 90px;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .zeile.markiert {
    background: var(--akzent-zart);
  }
  .zeile.alt .name {
    color: var(--text-3);
  }
  .klein {
    font-size: 12px;
    color: var(--text-3);
  }
  .rechts {
    text-align: right;
  }
  .marke {
    color: var(--akzent);
    text-align: right;
  }
  .fuss {
    padding: 0 4px;
  }
  .wahl b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Handy: Knopf füllt die Kopfzeile, die Liste den Bildschirm */
  .vollbild .wahl {
    width: 100%;
    min-width: 0;
  }
  .vollbild .liste {
    position: fixed;
    inset: 0;
    width: auto;
    border-radius: 0;
    padding: calc(12px + env(safe-area-inset-top)) 12px 12px;
    grid-template-rows: auto 1fr auto;
    color: var(--text);
  }
  .vollbild .zeilen {
    max-height: none;
  }
  .vollbild .zeile {
    grid-template-columns: 1fr auto;
    grid-template-areas: "name nummer" "land jahre";
    row-gap: 0;
    padding: 9px 8px;
    border-bottom: 1px solid var(--rand);
  }
  .vollbild .zeile > :nth-child(1) {
    grid-area: name;
  }
  .vollbild .zeile > :nth-child(2) {
    grid-area: nummer;
  }
  .vollbild .zeile > :nth-child(3) {
    grid-area: land;
  }
  .vollbild .zeile > :nth-child(4) {
    grid-area: jahre;
  }
  .vollbild .zeile > :nth-child(5) {
    display: none;
  }
</style>
