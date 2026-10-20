<script module>
  let zaehler = 0; // eindeutige Masken je Symbol auf der Seite
</script>

<script>
  // Ein Symbol aus symbole.js: `name` für Ansichten und Bedienung, `wetter`
  // (mit `tag`) für die Vorhersage. Größe über CSS (Vorgabe 1.25em),
  // Farben über --symbol-akzent und --symbol-nass.
  import { SYMBOLE, wetterPfade } from "./symbole.js";

  let { name = null, wetter = null, tag = true, titel = null, groesse = null } = $props();

  const id = `sym${zaehler++}`;
  const pfade = $derived((wetter ? wetterPfade(wetter, tag) : SYMBOLE[name]) ?? []);
  const vorne = $derived(pfade.findIndex(([, art]) => art === "w"));
  const hinten = $derived(vorne < 0 ? [] : pfade.slice(0, vorne));
  const rest = $derived(vorne < 0 ? pfade : pfade.slice(vorne));
</script>

{#snippet pfad(d, art)}
  <path {d} class={art ? `s-${art}` : null} />
{/snippet}

<svg
  class="symbol"
  viewBox="0 0 24 24"
  style:width={groesse}
  style:height={groesse}
  role={titel ? "img" : null}
  aria-hidden={titel ? null : "true"}
  aria-label={titel}
>
  {#if titel}<title>{titel}</title>{/if}
  {#if vorne >= 0}
    <defs>
      <mask id={id}>
        <rect width="24" height="24" fill="#fff" />
        <path d={pfade[vorne][0]} fill="#000" stroke="#000" stroke-width="3.4" />
      </mask>
    </defs>
    <g mask="url(#{id})">
      {#each hinten as [d, art]}{@render pfad(d, art)}{/each}
    </g>
  {/if}
  {#each rest as [d, art]}{@render pfad(d, art)}{/each}
</svg>

<style>
  .symbol {
    width: 1.25em;
    height: 1.25em;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    vertical-align: middle;
    overflow: visible;
  }
  .s-a,
  .s-af,
  .s-aF,
  .s-d {
    stroke: var(--symbol-akzent, var(--akzent));
  }
  .s-af {
    fill: color-mix(in srgb, var(--symbol-akzent, var(--akzent)) 18%, transparent);
  }
  .s-aF {
    fill: var(--symbol-akzent, var(--akzent));
  }
  .s-d {
    stroke-dasharray: 2 2.4;
  }
  .s-n {
    stroke: var(--symbol-nass, var(--blau));
  }
</style>
