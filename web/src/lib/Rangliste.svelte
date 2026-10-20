<script>
  // Alle Jahre nach ihrem Mittel, wärmstes zuerst - sortierbar nach jeder
  // Spalte. "bis heute": jedes Jahr vom 1.1. bis zum selben Kalendertag.
  // "bis Jahresende": ganze Jahre, das laufende als Prognose mit Band.
  import { normalText } from "./zeitraum.svelte.js";
  import { tick } from "svelte";
  import { datum, de, mitVorzeichen } from "./format.js";

  let { liste, name } = $props();

  let nach = $state("platz");
  let absteigend = $state(false);
  let rollen = $state();

  const SPALTEN = [
    ["platz", "Platz"],
    ["jahr", "Jahr"],
    ["m", "Mittel °C"],
    ["abw", "Abweichung K"],
    ["tage", "Tage"],
  ];

  function sortieren(spalte) {
    if (nach === spalte) absteigend = !absteigend;
    else {
      nach = spalte;
      // Jahr: neuestes zuerst; Abweichung und Mittel: wärmstes zuerst
      absteigend = spalte === "jahr" || spalte === "m" || spalte === "abw";
    }
  }

  const zeilen = $derived.by(() => {
    const z = liste.zeilen.slice();
    const wert = (r) => r[nach] ?? -Infinity;
    z.sort((a, b) => (absteigend ? wert(b) - wert(a) : wert(a) - wert(b)) || a.platz - b.platz);
    return z;
  });

  const spanne = $derived(Math.max(0.5, ...liste.zeilen.map((z) => Math.abs(z.abw ?? 0))));

  // Das laufende Jahr in den sichtbaren Bereich
  $effect(() => {
    liste;
    nach;
    absteigend;
    // nur den Rollbereich bewegen - scrollIntoView schöbe auch die Seite
    tick().then(() => {
      const zeile = rollen?.querySelector(".aktuell");
      if (zeile) rollen.scrollTop = zeile.offsetTop - rollen.clientHeight / 2;
    });
  });
</script>

<div class="karte rahmen">
  <div class="kopf">
    <b>
      {name}: Rangliste der Jahresmittel
      {liste.modus === "heute" ? `– 1. Januar bis ${datum(liste.letzter).slice(0, 6)}` : "– ganze Jahre"}
    </b>
    <span class="leise">{liste.zeilen.length} Jahre · Spaltenkopf klicken = sortieren</span>
  </div>

  {#if liste.prognose}
    {@const p = liste.prognose}
    <div class="prognose">
      <b>Prognose {liste.jahr}:</b>
      <span class="num">{de(p.mitte, 2)} °C</span>
      <span class="leise-t">Band {de(p.tief, 2)} – {de(p.hoch, 2)} °C</span>
      <span>→ Platz <b>{p.platz}</b> <span class="leise-t">({p.platz_hoch}–{p.platz_tief})</span> von {p.von}</span>
      <span class="leise">
        Rest des Jahres ({p.rest_tage} Tage) aus {p.vergleichsjahre} Vergleichsjahren {p.jahre[0]}–{p.jahre[1]}: 10 %, Median, 90 %
      </span>
    </div>
  {/if}

  <div class="rollen" bind:this={rollen}>
    <table>
      <thead>
        <tr>
          {#each SPALTEN as [k, t]}
            <th class:an={nach === k} onclick={() => sortieren(k)}>
              {t}
              {#if nach === k}{absteigend ? "▾" : "▴"}{/if}
            </th>
          {/each}
          <th class="balken-k"></th>
        </tr>
      </thead>
      <tbody>
        {#each zeilen as z (z.jahr)}
          <tr class:aktuell={z.jahr === liste.jahr} class:prog={z.prognose}>
            <td class="num">{z.platz}</td>
            <td class="num">{z.jahr}{#if z.prognose}<span class="marke">Prognose</span>{/if}</td>
            <td class="num">
              {de(z.m, 2)}
              {#if z.prognose}<span class="leise-t">({de(z.tief, 2)}–{de(z.hoch, 2)})</span>{/if}
            </td>
            <td class="num" style:color={z.abw > 0 ? "var(--rot)" : "var(--blau)"}>{mitVorzeichen(z.abw, 2)}</td>
            <td class="num leise-t">{z.tage ?? "–"}</td>
            <td class="balken">
              {#if z.abw != null}
                <div class="achse">
                  <span
                    style:left={z.abw >= 0 ? "50%" : `${50 - (Math.abs(z.abw) / spanne) * 50}%`}
                    style:width="{(Math.abs(z.abw) / spanne) * 50}%"
                    style:background={z.abw > 0 ? "#fca5a5" : "#93c5fd"}
                  ></span>
                </div>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="leise fuss">
    Abweichung gegen das Mittel derselben Spanne {normalText()} ({de(liste.normal, 2)} °C, {liste.normal_jahre} Jahre) ·
    {liste.modus === "heute"
      ? "nur Jahre mit mindestens 90 % gemessener Tage"
      : "nur Jahre mit mindestens 330 gemessenen Tagen"}
  </div>
</div>

<style>
  .rahmen {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 12px 14px 8px;
    min-height: 0;
  }
  .kopf {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 8px;
  }
  .kopf b {
    font-size: 15px;
  }
  .prognose {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--akzent-zart);
    border-radius: 8px;
    flex-wrap: wrap;
  }
  .leise-t {
    color: var(--text-3);
  }
  .rollen {
    flex: 1;
    overflow: auto;
    min-height: 0;
    position: relative;
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
    font-weight: 600;
    color: var(--text-2);
    padding: 6px 10px;
    border-bottom: 1px solid var(--rand);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  th.an {
    color: var(--akzent);
  }
  th.balken-k {
    cursor: default;
    width: 50%;
  }
  td {
    text-align: right;
    padding: 4px 10px;
    border-bottom: 1px solid var(--rand-zart);
    white-space: nowrap;
  }
  tr.aktuell td {
    background: var(--akzent-hell);
    font-weight: 600;
  }
  .marke {
    margin-left: 6px;
    font-size: 11px;
    color: var(--akzent);
    font-family: var(--schrift);
  }
  .balken {
    padding: 0 10px;
  }
  .achse {
    position: relative;
    height: 10px;
    border-left: 1px solid transparent;
  }
  .achse::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -3px;
    bottom: -3px;
    border-left: 1px solid var(--rand-stark);
  }
  .achse span {
    position: absolute;
    top: 0;
    height: 10px;
    border-radius: 3px;
  }
  .fuss {
    padding-top: 6px;
  }

  /* Handy: Liste in voller Länge, der Balken schmaler */
  @media (max-width: 700px) {
    .rahmen {
      height: auto;
      padding: 10px 8px 6px;
    }
    .kopf {
      flex-wrap: wrap;
    }
    .rollen {
      max-height: 70vh;
    }
    th.balken-k {
      width: 25%;
    }
    td,
    th {
      padding: 4px 5px;
    }
  }
</style>
