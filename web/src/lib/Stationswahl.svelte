<script>
  // Die Stationswahl: ein Knopf mit Name, Nummer und Höhe; ein Klick öffnet
  // die Suche über alle Stationen der DWD-Liste. Gesucht wird hier in der
  // Seite - 1.386 Zeilen sind schneller durchsucht als ein Aufruf dauert.
  import { suchen, tausend } from "./format.js";

  let { stationen = [], aktuell = null, wahl } = $props();

  let offen = $state(false);
  let text = $state("");
  let markiert = $state(0);
  let feld = $state();

  const treffer = $derived(suchen(stationen, text));
  const jahrHeute = new Date().getFullYear();

  function oeffnen() {
    offen = true;
    text = "";
    markiert = 0;
    queueMicrotask(() => feld?.focus());
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

<div class="wahl-rahmen">
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
      <input
        bind:this={feld}
        bind:value={text}
        onkeydown={taste}
        class="feld"
        placeholder="Name, Nummer oder Bundesland"
      />
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
            <span class="name">{name}</span>
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
        {tausend(stationen.length)} Stationen · grau: keine aktuellen Daten mehr · mit Tagen: schon geladen
      </div>
    </div>
  {/if}
</div>

<style>
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
  .liste .feld {
    width: 100%;
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
</style>
