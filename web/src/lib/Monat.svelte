<script>
  // Ein Monat Tag für Tag mit allem, was der DWD je Tag liefert. Das
  // Tagesmittel ist gefärbt nach der Abweichung vom Normal (wie im
  // Jahresband). Unten: der Monat (Mittel bzw. Summe), dasselbe Stück des
  // Monats im Normal 1991-2020 und die Abweichung.
  import { MONATE, abweichungsfarbe, de, mitVorzeichen } from "./format.js";

  let { monat } = $props();

  // Spalte -> [Kopf, Einheit, Nachkommastellen]
  const KOPF = {
    tmk: ["Mittel", "°C", 1],
    txk: ["Max", "°C", 1],
    tnk: ["Min", "°C", 1],
    tgk: ["Erdboden", "°C, 5 cm", 1],
    fm: ["Wind", "km/h", 1],
    fx: ["Böe", "km/h", 1],
    rsk: ["Niederschl.", "mm", 1],
    rskf: ["Form", "", 0],
    sdk: ["Sonne", "h", 1],
    shk: ["Schnee", "cm", 0],
    nm: ["Bedeckung", "Achtel", 1],
    upm: ["Feuchte", "%", 0],
    vpm: ["Dampfdruck", "hPa", 1],
    pm: ["Luftdruck", "hPa", 1],
  };

  // Niederschlagsform, Codes des DWD
  const FORM = { 0: "kein", 1: "Regen", 4: "unbek.", 6: "Regen", 7: "Schnee", 8: "Regen/Schnee", 9: "?" };
  const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  const wochentag = (tag) => WOCHENTAG[new Date(Date.UTC(monat.jahr, monat.monat - 1, tag)).getUTCDay()];

  function zelle(spalte, wert) {
    if (spalte === "rskf") return wert == null ? "–" : (FORM[wert] ?? wert);
    return de(wert, KOPF[spalte][2]);
  }

  // Schrift weiß auf satter Farbe
  const textfarbe = (a) => (a != null && Math.abs(a) > 3.5 ? "#fff" : "inherit");

  const tageImMonat = $derived(new Date(Date.UTC(monat.jahr, monat.monat, 0)).getUTCDate());
  const teilweise = $derived(monat.bis_tag < tageImMonat);
</script>

<div class="karte rahmen">
  <div class="kopf">
    <b>{MONATE[monat.monat - 1]} {monat.jahr}, Tag für Tag</b>
    <span class="leise">
      Mittel gefärbt nach Abweichung vom Normal · Wind in km/h (DWD: m/s) · leer = fehlt oder unplausibel
    </span>
  </div>
  <div class="rollen">
    <table>
      <thead>
        <tr>
          <th class="l">Tag</th>
          {#each monat.spalten as s}
            <th>{KOPF[s][0]}<small>{KOPF[s][1]}</small></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each monat.zeilen as z (z.tag)}
          <tr>
            <td class="l num">{String(z.tag).padStart(2, "0")}. <span class="leise">{wochentag(z.tag)}</span></td>
            {#each monat.spalten as s}
              {#if s === "tmk"}
                <td
                  class="num"
                  style:background={z.abw != null ? abweichungsfarbe(z.abw) : null}
                  style:color={textfarbe(z.abw)}
                  title={z.abw != null ? `${mitVorzeichen(z.abw)} K gegen normal` : ""}
                >
                  <b>{zelle(s, z.werte[s])}</b>
                </td>
              {:else}
                <td class="num" class:form={s === "rskf"}>{zelle(s, z.werte[s])}</td>
              {/if}
            {/each}
          </tr>
        {:else}
          <tr><td class="l leise" colspan="15">Keine Werte in diesem Monat</td></tr>
        {/each}
      </tbody>
      {#if monat.zeilen.length}
        <tfoot>
          <tr class="summe">
            <td class="l">Monat</td>
            {#each monat.spalten as s}
              <td class="num" title={s === "rskf" ? "" : `${monat.anzahl[s]} Tage mit Wert`}>
                {s === "rskf" ? "" : de(monat.summe[s], KOPF[s][2])}
                {#if monat.summen.includes(s) && monat.anzahl[s] < monat.zeilen.length && monat.summe[s] != null}<sup
                    >*</sup
                  >{/if}
              </td>
            {/each}
          </tr>
          <tr class="normal">
            <td class="l">Normal{teilweise ? ` 1.–${monat.bis_tag}.` : ""}</td>
            {#each monat.spalten as s}
              <td class="num">{s === "rskf" ? "" : de(monat.normal[s], KOPF[s][2])}</td>
            {/each}
          </tr>
          <tr class="abw">
            <td class="l">Abweichung</td>
            {#each monat.spalten as s}
              {@const a =
                s !== "rskf" && monat.summe[s] != null && monat.normal[s] != null
                  ? monat.summe[s] - monat.normal[s]
                  : null}
              <td
                class="num"
                style:color={a == null || !["tmk", "txk", "tnk", "tgk"].includes(s)
                  ? null
                  : a > 0
                    ? "var(--rot)"
                    : "var(--blau)"}
              >
                {a == null ? "" : mitVorzeichen(a, KOPF[s][2])}
              </td>
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  <div class="leise fuss">
    Monat: Mittel der Tage, bei Niederschlag und Sonne die Summe{#if teilweise}&nbsp;bis zum {monat.bis_tag}.{/if}
    · Normal: dieselben Tage 1991–2020 ({monat.normal_jahre} Jahre){#if monat.zeilen.length}&nbsp;· * nicht an jedem Tag
      gemessen{/if}
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
    white-space: nowrap;
  }
  .rollen {
    flex: 1;
    overflow: auto;
    min-height: 0;
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
    font-weight: 600;
    font-size: 12px;
    color: var(--text-2);
    text-align: right;
    padding: 4px 6px 6px;
    border-bottom: 1px solid var(--rand);
    white-space: nowrap;
    z-index: 1;
  }
  th small {
    display: block;
    font-weight: 400;
    color: var(--text-3);
    font-size: 11px;
  }
  td {
    text-align: right;
    padding: 4px 6px;
    border-bottom: 1px solid #f1f5f9;
    white-space: nowrap;
  }
  .l {
    text-align: left;
  }
  td.form {
    font-family: var(--schrift);
    font-size: 12px;
    color: var(--text-2);
  }
  tbody tr:hover td {
    background-color: var(--akzent-zart);
  }
  tfoot td {
    position: sticky;
    background: var(--flaeche-2);
    font-weight: 600;
  }
  tfoot tr.summe td {
    bottom: 56px;
    border-top: 2px solid var(--rand-stark);
  }
  tfoot tr.normal td {
    bottom: 28px;
    color: var(--text-2);
    font-weight: 400;
  }
  tfoot tr.abw td {
    bottom: 0;
  }
  .fuss {
    padding-top: 6px;
  }

  /* Handy: die Tabelle rollt quer, der Tag bleibt stehen */
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
    td.l,
    th.l {
      position: sticky;
      left: 0;
      background: var(--flaeche);
      z-index: 2;
    }
  }
</style>
