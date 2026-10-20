<script>
  // Ein Wert je Jahr als Balken, dazu das Normal (Vergleichszeitraum) als Linie.
  // Für Kenntage, Wellen, Schnee, Wind, Frost.
  import { normalText } from "./zeitraum.svelte.js";
  import { de, schritte } from "./format.js";

  let { punkte, normal = null, farbe = "var(--akzent)", einheit = "", hoehe = 220 } = $props(); // punkte: [[jahr, wert, blass?]]

  let breite = $state(600);
  let maus = $state(null);
  const rand = { l: 34, r: 8, o: 8, u: 20 };

  const werte = $derived(punkte.filter((p) => p[1] != null));
  const j0 = $derived(werte.length ? werte[0][0] : 0);
  const j1 = $derived(werte.length ? werte[werte.length - 1][0] : 1);
  const hi = $derived(Math.max(1, normal ?? 0, ...werte.map((p) => p[1])));
  const lo = $derived(Math.min(0, ...werte.map((p) => p[1])));
  const bw = $derived(Math.max(1, ((breite - rand.l - rand.r) / Math.max(1, j1 - j0 + 1)) * 0.8));
  const xs = (j) => rand.l + ((j - j0 + 0.5) / Math.max(1, j1 - j0 + 1)) * (breite - rand.l - rand.r);
  const ys = (v) => rand.o + (1 - (v - lo) / (hi - lo || 1)) * (hoehe - rand.o - rand.u);

  function bewegen(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const j = Math.round(j0 - 0.5 + ((e.clientX - r.left - rand.l) / (breite - rand.l - rand.r)) * (j1 - j0 + 1));
    maus = werte.find((p) => p[0] === j) ?? null;
  }
</script>

<div class="rahmen" bind:clientWidth={breite}>
  <div class="ablesen num">
    {#if maus}{maus[0]}: <b>{de(maus[1], Number.isInteger(maus[1]) ? 0 : 1)}</b> {einheit}{:else}&nbsp;{/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg width={breite} height={hoehe} onmousemove={bewegen} onmouseleave={() => (maus = null)}>
    {#each schritte(lo, hi, 4) as v}
      <line x1={rand.l} x2={breite - rand.r} y1={ys(v)} y2={ys(v)} class="gitter" />
      <text x={rand.l - 5} y={ys(v) + 4} text-anchor="end">{v}</text>
    {/each}
    {#each werte as [j, v, blass]}
      <rect x={xs(j) - bw / 2} y={Math.min(ys(v), ys(0))} width={bw} height={Math.abs(ys(v) - ys(0))} fill={farbe} opacity={blass ? 0.3 : maus?.[0] === j ? 1 : 0.8} />
    {/each}
    {#if normal != null}
      <line x1={rand.l} x2={breite - rand.r} y1={ys(normal)} y2={ys(normal)} class="normal" />
    {/if}
    {#each schritte(j0, j1, 6) as j}
      {#if Number.isInteger(j)}<text x={xs(j)} y={hoehe - 5} text-anchor="middle">{j}</text>{/if}
    {/each}
  </svg>
  {#if normal != null}<div class="leise">Linie: Mittel {normalText()} ({de(normal)} {einheit}) · blass: Jahr nicht vollständig gemessen</div>{/if}
</div>

<style>
  .rahmen {
    min-width: 0;
  }
  svg {
    display: block;
  }
  svg text {
    font: 10px var(--mono);
    fill: var(--text-3);
  }
  .gitter {
    stroke: var(--rand);
  }
  .normal {
    stroke: var(--text);
    stroke-dasharray: 4 3;
  }
  .ablesen {
    font-size: 12px;
    color: var(--text-2);
    text-align: right;
    height: 16px;
  }
</style>
