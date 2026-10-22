<script>
  // Regenradar des DWD (RV-Komposit, 1 km, alle 5 Minuten, über Bright
  // Sky): 1 bis 6 Stunden zurück und 2 Stunden Vorhersage als Film, Tempo
  // und Selbststart einstellbar. Geladen wird immer ganz Deutschland; die
  // Karte zoomt stufenlos (zwei Finger, Mausrad, doppelt tippen) und lässt
  // sich ziehen, die Knöpfe 50/100/250 km/Deutschland bleiben als Schnellwahl.
  // Der Punkt ist die Station, der eigene Standort oder ein angetippter
  // Punkt. Darunter die eigene einfache Karte (Karte.svelte) - beides im
  // selben Raster, ohne Umrechnung.
  import { onDestroy, untrack } from "svelte";
  import { rufe } from "./api.js";
  import { entpacken } from "./radardaten.js";
  import { RADAR_ZURUECK, SPALTEN, STUFEN, ZEILEN, ansichtKlemmen, farbe, ganzDeutschland, mmProStunde, raster, unterPunkt } from "./raster.js";
  import Karte from "./Karte.svelte";
  import Symbol from "./Symbol.svelte";

  // station {name, lat, lon}; stationen: Zeilen der Suche; meinStandort: () => Promise {lat, lon}
  // einstellungen {zurueck, tempo (s je Bild), selbst (Autoplay)}; merken: speichert sie
  let { station, stationen = [], meinStandort = null, einstellungen = {}, merken = () => {} } = $props();

  let zurueck = $state(RADAR_ZURUECK.includes(einstellungen.zurueck) ? einstellungen.zurueck : 1);
  let tempo = $state(Math.min(1.5, Math.max(0.05, Number(einstellungen.tempo) || 0.45)));
  let selbst = $state(einstellungen.selbst !== false);
  const sichern = () => merken({ zurueck, tempo, selbst });

  const ZOOMS = [
    ["50", 50, "50 km"],
    ["100", 100, "100 km"],
    ["250", 250, "250 km"],
    ["de", null, "Deutschland"],
  ];
  const GANZ = [0, 0, ZEILEN - 1, SPALTEN - 1];
  let mitte = $state(null); // [Spalte, Zeile] oder null = Station
  let mitteArt = $state("station"); // station, tipp, gps
  let ortFehler = $state("");

  let daten = $state(null);
  let fehler = $state("");
  let laedt = $state(false);
  let bild = $state(0);
  let laeuft = $state(false);
  let breite = $state(0);
  let hoehe = $state(0);

  const stationsPunkt = $derived(raster(station.lon, station.lat));
  const punkt = $derived(mitte ?? stationsPunkt);

  // sichtbarer Ausschnitt: Mitte im Raster und km über die kürzere Seite
  let ansicht = $state({ x: 0, y: 0, km: 100 });
  untrack(() => (ansicht = ansichtKlemmen({ x: stationsPunkt[0], y: stationsPunkt[1], km: 100 })));
  const zentrieren = (p, km = ansicht.km) => (ansicht = ansichtKlemmen({ x: p[0], y: p[1], km }));
  function schnellwahl(km) {
    if (km) zentrieren(punkt, km);
    else if (breite && hoehe) ansicht = ganzDeutschland(breite, hoehe);
  }
  // welcher Knopf passt gerade (auf 3 % genau)
  const zoomKnopf = $derived.by(() => {
    const de = breite && hoehe ? ganzDeutschland(breite, hoehe).km : 1100;
    return ZOOMS.find(([, km]) => Math.abs(ansicht.km / (km ?? de) - 1) < 0.03)?.[0] ?? null;
  });

  // andere Station: Karte dorthin
  $effect(() => {
    const p = stationsPunkt;
    untrack(() => {
      if (!mitte) zentrieren(p);
    });
  });

  async function zumStandort() {
    ortFehler = "";
    try {
      const p = await meinStandort(true);
      const [x, y] = raster(p.lon, p.lat);
      if (x < 0 || y < 0 || x > 1099 || y > 1199) throw new Error("Standort liegt außerhalb des Radargebiets");
      mitte = [x, y];
      mitteArt = "gps";
      zentrieren(mitte);
    } catch (e) {
      ortFehler = e.message;
    }
  }

  // aktive Stationen als Orientierung im nahen Zoom
  const jahrHeute = new Date().getFullYear();
  const stationsPunkte = $derived(
    stationen
      .filter((z) => z[7] != null && z[5] && Number(z[5].slice(0, 4)) >= jahrHeute - 1)
      .map((z) => [z[1], ...raster(z[8], z[7])]),
  );

  const UHR = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  const uhr = (iso) => UHR.format(new Date(iso));

  let ladeNr = 0;
  async function laden(neu = false) {
    const nr = ++ladeNr;
    laedt = true;
    fehler = "";
    const r = await rufe("radar", GANZ, neu, zurueck);
    if (nr !== ladeNr) return; // inzwischen andere Filmlänge
    laedt = false;
    if (r.fehler) {
      fehler = r.fehler;
      return;
    }
    const d = entpacken(r, r.bbox);
    // Start beim neuesten gemessenen Bild, nicht in der Vorhersage
    const jetzt = Date.now();
    let start = 0;
    d.bilder.forEach((x, i) => {
      if (Date.parse(x.zeit) <= jetzt) start = i;
    });
    bildCache.clear();
    daten = d;
    bild = selbst ? 0 : start;
    if (selbst && !laeuft) abspielen();
  }

  $effect(() => {
    zurueck;
    untrack(() => laden());
  });

  // Film: je Bild `tempo` Sekunden, am Ende kurz stehen bleiben (4 Takte)
  let takt = null;
  let pause = 0;
  function weiter() {
    if (!daten?.bilder.length) return;
    if (bild >= daten.bilder.length - 1) {
      if (++pause < 4) return planen();
      pause = 0;
      bild = 0;
    } else bild += 1;
    planen();
  }
  function planen() {
    clearTimeout(takt);
    if (laeuft) takt = setTimeout(weiter, tempo * 1000);
  }
  function abspielen() {
    if (laeuft) {
      laeuft = false;
      clearTimeout(takt);
      return;
    }
    if (!daten?.bilder.length) return;
    laeuft = true;
    if (bild >= daten.bilder.length - 1) bild = 0;
    pause = 0;
    planen();
  }
  onDestroy(() => clearTimeout(takt));

  // Farbe je Rohwert einmal vorrechnen (RGBA als eine Zahl, little endian)
  const TAFEL = new Uint32Array(65536);
  for (let v = 1; v < 65536; v++) {
    const f = farbe(mmProStunde(v));
    if (f) TAFEL[v] = (215 << 24) | (f[2] << 16) | (f[1] << 8) | f[0];
  }

  // Radarbild je Film-Bild als kleine Leinwand (1 Pixel = 1 km); nur die
  // letzten paar bleiben, ganz Deutschland braucht je Bild rund 5 MB
  const bildCache = new Map();
  function radarBild(d, i) {
    const schluessel = d.bilder[i].zeit;
    const da = bildCache.get(schluessel);
    if (da) return da;
    const c = document.createElement("canvas");
    c.width = d.spalten;
    c.height = d.zeilen;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(d.spalten, d.zeilen);
    const ziel = new Uint32Array(img.data.buffer);
    const w = d.bilder[i].werte;
    for (let p = 0; p < w.length; p++) ziel[p] = TAFEL[w[p]];
    ctx.putImageData(img, 0, 0);
    if (bildCache.size >= 12) bildCache.delete(bildCache.keys().next().value);
    bildCache.set(schluessel, c);
    return c;
  }

  // Regen auf die Karte: nur der sichtbare Teil des Rasters (Karte.svelte ruft das
  // zwischen Wasser und Grenzen auf; liest daten und bild, zeichnet also mit)
  function regen(ctx, { x, y, s, w, h }) {
    if (!daten?.bilder.length) return;
    const [gl, go] = unterPunkt(ansicht, 0, 0, w, h);
    const sx0 = Math.max(0, Math.floor(gl));
    const sy0 = Math.max(0, Math.floor(go));
    const sx1 = Math.min(daten.spalten, Math.ceil(gl + w / s));
    const sy1 = Math.min(daten.zeilen, Math.ceil(go + h / s));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    ctx.imageSmoothingEnabled = false;
    const quelle = radarBild(daten, Math.min(bild, daten.bilder.length - 1));
    ctx.drawImage(quelle, sx0, sy0, sx1 - sx0, sy1 - sy0, x(sx0), y(sy0), (sx1 - sx0) * s, (sy1 - sy0) * s);
  }

  const aktuell = $derived(daten?.bilder[Math.min(bild, daten.bilder.length - 1)]);
  const vorhersage = $derived(aktuell ? Date.parse(aktuell.zeit) > Date.now() : false);
</script>

<div class="radar">
  <div class="leiste">
    <div class="gruppe">
      {#each ZOOMS as [k, km, t]}
        <button class="chip" class:an={zoomKnopf === k} onclick={() => schnellwahl(km)}>{t}</button>
      {/each}
    </div>
    <div class="gruppe">
      <button class="chip" class:an={!mitte} onclick={() => ((mitte = null), (mitteArt = "station"), zentrieren(stationsPunkt))} title="Mittelpunkt auf die Station">{station.name}</button>
      {#if meinStandort}
        <button class="chip" class:an={mitte && mitteArt === "gps"} onclick={zumStandort} title="Mittelpunkt auf den Standort dieses Geräts"><Symbol name="standort" /> Mein Standort</button>
      {/if}
      {#if mitte && mitteArt === "tipp"}<span class="chip an">angetippter Punkt</span>{/if}
    </div>
    <button class="chip" onclick={() => laden(true)} disabled={laedt} title="Neu laden"><Symbol name="aktualisieren" /></button>
    {#if laedt}<span class="leise">lädt …</span>{/if}
    {#if ortFehler}<span class="leise">{ortFehler}</span>{/if}
  </div>

  <div class="flaeche">
    <Karte
      bind:ansicht
      bind:breite
      bind:hoehe
      unten={regen}
      {punkt}
      {stationsPunkte}
      ontipp={(gx, gy) => ((mitte = [gx, gy]), (mitteArt = "tipp"))}
    />
    {#if fehler}
      <div class="leise mitte">{fehler}</div>
    {:else if !daten}
      <div class="leise mitte">Radar lädt …</div>
    {/if}
  </div>

  {#if daten?.bilder.length}
    <div class="zeit">
      <button class="chip abspielen" onclick={abspielen} title={laeuft ? "Anhalten" : "Abspielen"}>{laeuft ? "❚❚" : "▶"}</button>
      <input type="range" min="0" max={daten.bilder.length - 1} bind:value={bild} />
      <span class="num uhr">{uhr(aktuell.zeit)}</span>
      <span class="marke" class:vorhersage>{vorhersage ? "Vorhersage" : "gemessen"}</span>
    </div>
    <div class="film">
      <label title="Wie weit zurück; Vorhersage immer 2 Stunden">
        Film
        <select class="chip" value={zurueck} onchange={(e) => ((zurueck = Number(e.currentTarget.value)), sichern())}>
          {#each RADAR_ZURUECK as h}<option value={h}>{h} h zurück + 2 h{h >= 6 ? " (alle 15 Min)" : h >= 3 ? " (alle 10 Min)" : ""}</option>{/each}
        </select>
      </label>
      <label class="tempo" title="Sekunden je Bild - rechts schneller">
        Tempo
        <input type="range" min="0.05" max="1.5" step="0.05" bind:value={tempo} onchange={sichern} />
        <span class="num">{tempo.toFixed(2).replace(".", ",")} s</span>
      </label>
      <label class="haken"><input type="checkbox" bind:checked={selbst} onchange={sichern} /> selbst starten</label>
    </div>
    <div class="legende">
      {#each STUFEN as [ab, [r, g, b]]}
        <span><i style:background="rgb({r} {g} {b})"></i>{String(ab).replace(".", ",")}</span>
      {/each}
      <span class="leise">mm/h · DWD-Radar über Bright Sky · Karte: Natural Earth</span>
    </div>
  {/if}
</div>

<style>
  .radar {
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto auto;
    gap: 8px;
  }
  .leiste {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .flaeche {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid var(--rand);
    background: var(--flaeche-2);
  }
  .mitte {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--flaeche);
  }
  .zeit {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .zeit input {
    flex: 1;
    accent-color: var(--akzent);
  }
  .abspielen {
    width: 44px;
  }
  .film {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    font-size: 13px;
    color: var(--text-2);
  }
  .film label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tempo input {
    direction: rtl;
    width: 120px;
    accent-color: var(--akzent);
  }
  .haken input {
    accent-color: var(--akzent);
  }
  .uhr {
    font-size: 15px;
    font-weight: 600;
  }
  .marke {
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 9px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
  }
  .marke.vorhersage {
    background: var(--akzent-hell);
    border-color: var(--akzent);
    color: var(--akzent);
  }
  .legende {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    align-items: center;
  }
  .legende i {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 2px;
    margin-right: 4px;
    vertical-align: middle;
  }
  @media (max-width: 700px) {
    .radar {
      height: calc(100dvh - 190px);
    }
  }
</style>
