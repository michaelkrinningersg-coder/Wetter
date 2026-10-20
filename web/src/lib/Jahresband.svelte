<script>
  // Ein Jahr Tag für Tag: je Tag ein Balken vom Tiefst- zum Höchstwert,
  // gefärbt nach der Abweichung des Mittels vom Normal; dahinter grau das
  // übliche Band 1991-2020. Rechts das Jahr bisher und die Monate.
  import {
    MONATE,
    MONATSANFANG,
    abweichungsfarbe,
    datum,
    de,
    mitVorzeichen,
    schritte,
    tagText,
  } from "./format.js";

  let { band, name } = $props();

  let breite = $state(900);
  let hoehe = $state(480);
  let maus = $state(null);

  const rand = { l: 40, r: 12, o: 10, u: 26 };

  const normal = $derived(new Map(band.normal.map((n) => [n[0], n])));

  const bereich = $derived.by(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, m, x, n] of band.tage) {
      for (const v of [m, x, n]) if (v != null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
    }
    for (const [, , x, n] of band.normal) ((lo = Math.min(lo, n)), (hi = Math.max(hi, x)));
    if (!Number.isFinite(lo)) return [-10, 30];
    return [Math.floor(lo - 1), Math.ceil(hi + 1)];
  });

  const xs = (i) => rand.l + ((i + 0.5) / 366) * (breite - rand.l - rand.r);
  const ys = (v) => rand.o + (1 - (v - bereich[0]) / (bereich[1] - bereich[0])) * (hoehe - rand.o - rand.u);

  function flaeche(oben, unten) {
    if (!band.normal.length) return "";
    const hin = band.normal.map((n, k) => `${k ? "L" : "M"}${xs(n[0]).toFixed(1)},${ys(n[oben]).toFixed(1)}`);
    const zurueck = band.normal
      .slice()
      .reverse()
      .map((n) => `L${xs(n[0]).toFixed(1)},${ys(n[unten]).toFixed(1)}`);
    return hin.join("") + zurueck.join("") + "Z";
  }

  const balkenbreite = $derived(Math.max(1, ((breite - rand.l - rand.r) / 366) * 0.72));

  function bewegen(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - rand.l) / (breite - rand.l - rand.r)) * 366 - 0.5);
    maus = i >= 0 && i <= 365 ? i : null;
  }

  const tagUnterMaus = $derived(maus == null ? null : band.tage.find((t) => t[0] === maus));
  const normalUnterMaus = $derived(maus == null ? null : normal.get(maus));

  const titel = $derived(band.laufend ? `${band.jahr} bis heute` : `Jahresmittel ${band.jahr}`);
</script>

<div class="raster">
  <div class="karte grafik">
    <div class="kopf">
      <b>{name} {band.jahr}, Tag für Tag</b>
      <span class="leise">
        Balken: Tiefst- bis Höchstwert, Farbe: Mittel gegen normal ·
        {#if band.normal_jahre}
          grau: übliches Band 1991–2020 ({band.normal_jahre} Jahre)
        {:else}
          kein Normal - die Reihe deckt 1991–2020 nicht ab
        {/if}
      </span>
      <span class="raum"></span>
      <span class="num maus">
        {#if maus != null}
          {tagText(maus)}
          {#if tagUnterMaus}
            Mittel <b>{de(tagUnterMaus[1])}</b> · Max <b>{de(tagUnterMaus[2])}</b> · Min <b>{de(tagUnterMaus[3])}</b>
          {:else}
            kein Wert
          {/if}
          {#if normalUnterMaus}
            · normal {de(normalUnterMaus[1])}
          {/if}
        {/if}
      </span>
    </div>
    <div class="flaeche" bind:clientWidth={breite} bind:clientHeight={hoehe}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg width={breite} height={hoehe} onmousemove={bewegen} onmouseleave={() => (maus = null)}>
        {#each schritte(bereich[0], bereich[1]) as v}
          <line x1={rand.l} x2={breite - rand.r} y1={ys(v)} y2={ys(v)} class={v === 0 ? "null" : "gitter"} />
          <text x={rand.l - 6} y={ys(v) + 4} text-anchor="end">{v}</text>
        {/each}
        {#each MONATSANFANG as anfang, m}
          <text x={xs(anfang + 15)} y={hoehe - 6} text-anchor="middle">{MONATE[m]}</text>
        {/each}
        <path d={flaeche(3, 2)} fill="#e2e8f0" opacity="0.85" />
        <path d={flaeche(4, 5)} fill="#cbd5e1" opacity="0.55" />
        {#each band.tage as [i, m, x, n] (i)}
          {#if x != null && n != null}
            {@const mitte = m ?? (x + n) / 2}
            {@const nm = normal.get(i)}
            <line
              x1={xs(i)}
              x2={xs(i)}
              y1={ys(n)}
              y2={ys(x)}
              stroke={nm ? abweichungsfarbe(mitte - nm[1]) : "#64748b"}
              stroke-width={balkenbreite}
            />
          {:else if m != null}
            <circle cx={xs(i)} cy={ys(m)} r="1.6" fill="#64748b" />
          {/if}
        {/each}
        {#if maus != null}
          <line x1={xs(maus)} x2={xs(maus)} y1={rand.o} y2={hoehe - rand.u} class="zeiger" />
        {/if}
      </svg>
    </div>
  </div>

  <div class="seite">
    <div class="karte kachel">
      <div class="lbl">{titel}</div>
      <div class="gross num">{de(band.bisher.m)} °C</div>
      {#if band.bisher.platz}
        <div class="text-2">Platz <b>{band.bisher.platz}</b> von {band.bisher.von} Jahren</div>
      {:else}
        <div class="leise">kein Platz - zu wenige Tage gemessen ({band.bisher.tage})</div>
      {/if}
      <div class="leise">1. Januar bis {datum(band.ende)} · Platz 1 = am wärmsten</div>
    </div>

    <div class="karte kachel">
      <div class="lbl">Monate gegen normal</div>
      <table>
        <thead>
          <tr><td></td><td class="r">{band.jahr}</td><td class="r">normal</td><td></td><td></td></tr>
        </thead>
        <tbody>
          {#each band.monate as mo}
            {@const a = mo.m != null && mo.norm != null ? mo.m - mo.norm : null}
            <tr>
              <td>{MONATE[mo.mo - 1]}</td>
              <td class="num r">{de(mo.m)}</td>
              <td class="num r leise-z">{de(mo.norm)}</td>
              <td class="balken">
                {#if a != null}
                  <span
                    style:width="{Math.min(70, Math.abs(a) * 22)}px"
                    style:background={a > 0 ? "var(--rot-hell)" : "var(--blau-hell)"}
                    style:margin-left={a > 0 ? "0" : "auto"}
                  ></span>
                {/if}
              </td>
              <td class="num r" style:color={a > 0 ? "var(--rot)" : "var(--blau)"}><b>{mitVorzeichen(a)}</b></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="leise">Monatsmittel; normal = derselbe Monat 1991–2020</div>
    </div>
  </div>
</div>

<style>
  .raster {
    display: grid;
    grid-template-columns: 1fr 346px;
    gap: 16px;
    height: 100%;
    min-height: 0;
  }
  .grafik {
    display: flex;
    flex-direction: column;
    padding: 12px 14px 8px;
    min-height: 0;
  }
  .kopf {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 6px;
  }
  .kopf b {
    font-size: 15px;
    white-space: nowrap;
  }
  .raum {
    flex: 1;
  }
  .maus {
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .flaeche {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  svg {
    display: block;
  }
  svg text {
    font: 11px var(--mono);
    fill: var(--text-3);
  }
  .gitter {
    stroke: #eef2f7;
  }
  .null {
    stroke: #cbd5e1;
  }
  .zeiger {
    stroke: var(--text);
    stroke-dasharray: 3 3;
  }
  .seite {
    display: grid;
    align-content: start;
    gap: 16px;
    overflow: auto;
  }
  .kachel {
    padding: 14px 16px;
    display: grid;
    gap: 4px;
  }
  .gross {
    font-size: 34px;
    font-weight: 300;
  }
  .text-2 {
    color: var(--text-2);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  thead td {
    color: var(--text-3);
    font-size: 11px;
  }
  td {
    padding: 5px 0;
  }
  .r {
    text-align: right;
  }
  .leise-z {
    color: var(--text-3);
  }
  .balken {
    width: 80px;
    padding: 0 8px;
  }
  .balken span {
    display: block;
    height: 8px;
    border-radius: 4px;
  }
</style>
