<script>
  // Laufband der Startseite: die Rekorde aller Stationen der letzten 7 Tage,
  // neueste zuerst. Steht still, solange die Maus darauf ist oder das
  // System weniger Bewegung wünscht. Klick führt zur Seite "Rekorde
  // Deutschland".
  import { de } from "./format.js";
  import Symbol from "./Symbol.svelte";

  let { rekorde, gehe } = $props();

  const kurz = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  // die 7 Tage bis zum Stand der Daten (meist gestern)
  const grenze = $derived(rekorde?.stand ? new Date(Date.parse(`${rekorde.stand}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10) : "");
  const eintraege = $derived(
    (rekorde?.eintraege ?? []).filter((x) => x.datum >= grenze).sort((a, b) => b.datum.localeCompare(a.datum) || a.platz - b.platz),
  );
  // Geschwindigkeit: rund 60 px je Sekunde, gleich wie lang die Liste ist
  const dauer = $derived(Math.max(20, eintraege.length * 4.5));
</script>

{#if rekorde?.stand}
  <button class="laufband karte" onclick={gehe} title="Alle Rekorde Deutschland">
    <span class="kopf"><Symbol name="rekorde_de" /> Rekorde</span>
    {#if !eintraege.length}
      <span class="leise">keine neuen in 7 Tagen bis {kurz(rekorde.stand)} · alle ›</span>
    {:else}
    <span class="fenster">
      <span class="lauf" style:animation-duration="{dauer}s">
        {#each [0, 1] as runde}
          {#each eintraege as r}
            <span class="eintrag" aria-hidden={runde === 1 ? "true" : null}>
              <span class="leise">{kurz(r.datum)}</span>
              <b>{r.name}</b>
              {r.kategorie}
              <span class="num wert">{de(r.wert, r.stellen ?? 1)} {r.einheit}</span>
              <span class="platz" class:eins={r.platz === 1}>{r.platz === 1 ? "Rekord" : `Platz ${r.platz}`}</span>
              <span class="leise">seit {r.seit}</span>
            </span>
          {/each}
        {/each}
      </span>
    </span>
    {/if}
  </button>
{/if}

<style>
  .laufband {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .kopf {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    color: var(--akzent);
    white-space: nowrap;
    flex: none;
  }
  .fenster {
    flex: 1;
    overflow: hidden;
    min-width: 0;
    mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
  }
  .lauf {
    display: inline-flex;
    gap: 28px;
    white-space: nowrap;
    animation: laufen linear infinite;
    padding-left: 28px;
  }
  .laufband:hover .lauf {
    animation-play-state: paused;
  }
  .eintrag {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  .wert {
    font-weight: 600;
  }
  .platz {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
  }
  .platz.eins {
    background: var(--akzent);
    border-color: var(--akzent);
    color: #fff;
    font-weight: 700;
  }
  @keyframes laufen {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lauf {
      animation: none;
    }
    .fenster {
      overflow-x: auto;
    }
  }
</style>
