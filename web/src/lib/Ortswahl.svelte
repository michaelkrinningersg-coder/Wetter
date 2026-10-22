<script>
  // Fenster "Ort wählen": oben die Suche über die eigene Ortsliste, darunter
  // die Karte wie im Radar (zoomen, ziehen, tippen setzt den Punkt), unten
  // der Punkt mit Namensvorschlag (änderbar), Höhe und der Station für die
  // Klimadaten - die nächste, Höhe zählt mit (passendeStationen).
  import { onMount } from "svelte";
  import { rufe } from "./api.js";
  import { de } from "./format.js";
  import Karte from "./Karte.svelte";
  import { ladeOrte, ortSuchen, ortsname } from "./orte.js";
  import { ansichtKlemmen, lage, raster } from "./raster.js";
  import { passendeStationen } from "./standort.js";
  import Symbol from "./Symbol.svelte";

  // start: {lat, lon} - Mitte beim Öffnen; aktuell: der gerade gewählte Punkt oder null
  // onwahl(punkt): {art: "punkt", name, lat, lon, hoehe, station}; onschliessen()
  let { stationen = [], start, aktuell = null, onwahl, onschliessen } = $props();

  let orte = $state(null);
  let ladeFehler = $state("");
  onMount(async () => {
    try {
      orte = await ladeOrte();
    } catch (e) {
      ladeFehler = `Ortsliste nicht geladen (${e?.message ?? e})`;
    }
  });

  const [sx, sy] = raster((aktuell ?? start).lon, (aktuell ?? start).lat);
  let ansicht = $state(ansichtKlemmen({ x: sx, y: sy, km: aktuell ? 30 : 100 }));

  // der gewählte Punkt: {lat, lon, name, hoehe, hoeheCa, stationen: [...], stationNr}
  let punkt = $state(null);
  let nr = 0;
  async function setzen(lat, lon, vorschlag = null) {
    const meine = ++nr;
    const n = vorschlag ?? (orte ? ortsname(orte, lat, lon) : null);
    punkt = { lat, lon, name: n?.name ?? `${de(lat, 3)}° N, ${de(lon, 3)}° O`, hoehe: vorschlag?.hoehe ?? null, hoeheCa: false, stationen: [], stationNr: 0, laedt: true };
    // Höhe: aus der Ortsliste (Suche) oder genau übers Netz; sonst die des nächsten Orts
    let h = vorschlag?.hoehe ?? null;
    if (h == null) {
      const r = await rufe("hoehe", lat, lon).catch((e) => ({ fehler: e?.message ?? String(e) }));
      if (meine !== nr) return;
      if (!r.fehler && r.hoehe != null) h = r.hoehe;
      else if (n?.hoehe != null) {
        h = n.hoehe;
        punkt.hoeheCa = true;
      }
    }
    punkt.hoehe = h;
    punkt.stationen = passendeStationen(stationen, lat, lon, h);
    punkt.laedt = false;
  }

  function getippt(gx, gy) {
    const [lon, lat] = lage(gx, gy);
    setzen(lat, lon);
  }

  // Suche
  let text = $state("");
  let markiert = $state(0);
  const treffer = $derived(orte && text.trim() ? ortSuchen(orte, text, 40) : []);
  $effect(() => {
    text;
    markiert = 0;
  });
  function nehmen(o) {
    text = "";
    const [x, y] = raster(o.lon, o.lat);
    ansicht = ansichtKlemmen({ x, y, km: o.gipfel ? 20 : 30 });
    setzen(o.lat, o.lon, o);
  }
  function taste(e) {
    if (e.key === "Escape") text ? (text = "") : onschliessen();
    else if (e.key === "ArrowDown") ((markiert = Math.min(markiert + 1, treffer.length - 1)), e.preventDefault());
    else if (e.key === "ArrowUp") ((markiert = Math.max(markiert - 1, 0)), e.preventDefault());
    else if (e.key === "Enter" && treffer[markiert]) nehmen(treffer[markiert]);
  }

  const kartenPunkt = $derived(punkt ? raster(punkt.lon, punkt.lat) : null);
  const jahrHeute = new Date().getFullYear();
  const stationsPunkte = $derived(
    stationen.filter((z) => z[7] != null && z[5] && Number(String(z[5]).slice(0, 4)) >= jahrHeute - 1).map((z) => [z[1], ...raster(z[8], z[7])]),
  );
  const gewaehlt = $derived(punkt?.stationen[punkt.stationNr] ?? null);
  const hm = (dh) => (dh == null ? "" : `${dh > 0 ? "+" : dh < 0 ? "−" : "±"}${Math.abs(Math.round(dh))} m`);

  function uebernehmen() {
    if (!punkt || punkt.laedt) return;
    const s = gewaehlt?.zeile;
    onwahl({
      art: "punkt",
      name: punkt.name.trim() || "Punkt",
      lat: Math.round(punkt.lat * 10000) / 10000,
      lon: Math.round(punkt.lon * 10000) / 10000,
      hoehe: punkt.hoehe,
      station: s ? { id: s[0], name: s[1], hoehe: s[3] } : null,
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="schleier" onclick={onschliessen}></div>
<div class="fenster karte" role="dialog" aria-label="Ort wählen">
  <div class="kopf">
    <b>Ort für die Vorhersage wählen</b>
    <button class="knopf" onclick={onschliessen}>Schließen</button>
  </div>
  <div class="suche">
    <!-- svelte-ignore a11y_autofocus -->
    <input class="feld" bind:value={text} onkeydown={taste} placeholder={orte ? "Ort oder Berg suchen, z. B. Torfhaus" : "Ortsliste lädt …"} autofocus />
    {#if treffer.length}
      <div class="treffer">
        {#each treffer as o, i}
          <button class="zeile" class:markiert={i === markiert} onmouseenter={() => (markiert = i)} onclick={() => nehmen(o)}>
            <span>{o.gipfel ? "▲ " : ""}{o.name}</span>
            <span class="leise">{o.land}{o.hoehe != null ? ` · ${o.hoehe} m` : ""}{o.einwohner ? ` · ${o.einwohner.toLocaleString("de-DE")} Einw.` : ""}</span>
          </button>
        {/each}
      </div>
    {:else if text.trim() && orte}
      <div class="treffer leise leer">Kein Ort gefunden</div>
    {/if}
  </div>
  <div class="kartenfeld">
    <Karte bind:ansicht punkt={kartenPunkt} punktName={punkt?.name ?? ""} {stationsPunkte} {orte} ontipp={getippt} titel="Ziehen verschiebt · zwei Finger oder Mausrad zoomen · tippen wählt den Punkt" />
    {#if ladeFehler}<div class="hinweis">{ladeFehler}</div>{/if}
  </div>
  <div class="fuss">
    {#if punkt}
      <div class="angaben">
        <label class="name">Name <input class="feld" bind:value={punkt.name} maxlength="60" /></label>
        <div class="leise num">
          {de(punkt.lat, 3)}° N, {de(punkt.lon, 3)}° O ·
          {#if punkt.laedt}Höhe …{:else if punkt.hoehe != null}{punkt.hoeheCa ? "ca. " : ""}{punkt.hoehe} m{:else}Höhe unbekannt{/if}
        </div>
        {#if punkt.stationen.length}
          <label class="daten">
            Daten von
            <select class="chip" bind:value={punkt.stationNr}>
              {#each punkt.stationen as v, i}
                <option value={i}>{v.zeile[1]} ({de(v.km, 0)} km{v.dh != null ? `, ${hm(v.dh)}` : ""}){i === 0 ? " – passt am besten" : ""}</option>
              {/each}
            </select>
          </label>
        {:else if !punkt.laedt}
          <div class="leise">Keine aktive Station mit 30 Jahren in der Nähe</div>
        {/if}
      </div>
      <button class="knopf an" onclick={uebernehmen} disabled={punkt.laedt}><Symbol name="vorhersage" /> Vorhersage hier</button>
    {:else}
      <div class="leise">Tippe auf die Karte oder suche einen Ort. Jahr, Monat und Rekorde kommen dann von der passenden Station; dabei zählt die Höhe mit.</div>
    {/if}
  </div>
  <div class="leise quelle">Orte: GeoNames (CC BY 4.0) · Karte: Natural Earth · Höhe: Open-Meteo</div>
</div>

<style>
  .schleier {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 35%);
  }
  .fenster {
    position: fixed;
    z-index: 41;
    inset: 4vh 50% auto auto;
    transform: translateX(50%);
    width: min(960px, 94vw);
    height: 92vh;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    gap: 8px;
    padding: 12px;
    color: var(--text);
    white-space: normal;
    box-shadow: var(--schatten-hoch);
  }
  .kopf {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .suche {
    position: relative;
  }
  .suche .feld {
    width: 100%;
    color: var(--text);
    font-size: 15px;
  }
  .treffer {
    position: absolute;
    top: 38px;
    left: 0;
    right: 0;
    z-index: 2;
    max-height: 50vh;
    overflow: auto;
    background: var(--flaeche);
    border: 1px solid var(--rand);
    border-radius: 8px;
    box-shadow: var(--schatten-hoch);
  }
  .treffer.leer {
    padding: 10px;
  }
  .zeile {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .zeile.markiert {
    background: var(--akzent-zart);
  }
  .zeile .leise {
    font-size: 12px;
    text-align: right;
  }
  .kartenfeld {
    position: relative;
    border: 1px solid var(--rand);
    border-radius: 8px;
    overflow: hidden;
    background: var(--flaeche-2);
    min-height: 200px;
  }
  .hinweis {
    position: absolute;
    left: 10px;
    top: 10px;
    padding: 4px 8px;
    background: var(--flaeche);
    border-radius: 6px;
  }
  .fuss {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    justify-content: space-between;
  }
  .angaben {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .name .feld {
    color: var(--text);
    min-width: 0;
    width: 260px;
  }
  .daten {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .daten select {
    max-width: 100%;
  }
  .knopf.an {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .quelle {
    font-size: 11px;
  }
  @media (max-width: 700px) {
    .fenster {
      inset: 0;
      transform: none;
      width: auto;
      height: auto;
      border-radius: 0;
      padding: calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom));
    }
    .name .feld {
      width: 100%;
      flex: 1;
    }
    .fuss .knopf {
      width: 100%;
      justify-content: center;
      height: 42px;
    }
  }
</style>
