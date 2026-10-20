<script>
  // Regenradar des DWD (RV-Komposit, 1 km, alle 5 Minuten, über Bright
  // Sky): die letzte Stunde und die Vorhersage der nächsten als Film. Drei
  // Ausschnitte (100 km, 250 km, Deutschland), Mittelpunkt ist die Station
  // oder ein angetippter Punkt. Darunter die eigene einfache Karte
  // (karte.json, Natural Earth) - beides im selben Raster, ohne Umrechnung.
  import { onDestroy, untrack } from "svelte";
  import { rufe } from "./api.js";
  import karte from "./karte.json";
  import { entpacken } from "./radardaten.js";
  import { STUFEN, ausschnitt, farbe, mmProStunde, raster } from "./raster.js";
  import Symbol from "./Symbol.svelte";

  // station {name, lat, lon}; stationen: Zeilen der Suche; meinStandort: () => Promise {lat, lon}
  let { station, stationen = [], meinStandort = null } = $props();

  const ZOOMS = [
    ["100", 100, "100 km"],
    ["250", 250, "250 km"],
    ["de", null, "Deutschland"],
  ];
  let zoom = $state("100");
  let mitte = $state(null); // [Spalte, Zeile] oder null = Station
  let mitteArt = $state("station"); // station, tipp, gps
  let ortFehler = $state("");

  async function zumStandort() {
    ortFehler = "";
    try {
      const p = await meinStandort(true);
      const [x, y] = raster(p.lon, p.lat);
      if (x < 0 || y < 0 || x > 1099 || y > 1199) throw new Error("Standort liegt außerhalb des Radargebiets");
      mitte = [x, y];
      mitteArt = "gps";
    } catch (e) {
      ortFehler = e.message;
    }
  }
  let daten = $state(null);
  let fehler = $state("");
  let laedt = $state(false);
  let bild = $state(0);
  let laeuft = $state(false);
  let breite = $state(0);
  let hoehe = $state(0);
  let leinwand = $state();

  const stationsPunkt = $derived(raster(station.lon, station.lat));
  const punkt = $derived(mitte ?? stationsPunkt);
  const km = $derived(ZOOMS.find((z) => z[0] === zoom)[1]);
  const bbox = $derived(ausschnitt(punkt, km));

  // aktive Stationen als Orientierung im 100-km-Ausschnitt
  const jahrHeute = new Date().getFullYear();
  const stationsPunkte = $derived(
    stationen
      .filter((z) => z[7] != null && z[5] && Number(z[5].slice(0, 4)) >= jahrHeute - 1)
      .map((z) => [z[1], ...raster(z[8], z[7])]),
  );

  const UHR = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  const uhr = (iso) => UHR.format(new Date(iso));

  async function laden(b, neu = false) {
    laedt = true;
    fehler = "";
    const r = await rufe("radar", b, neu);
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
    daten = d;
    bild = start;
  }

  $effect(() => {
    const b = bbox;
    untrack(() => laden(b));
  });

  // Film: alle 0,45 s ein Bild weiter, am Ende kurz stehen bleiben
  let takt = null;
  function abspielen() {
    if (laeuft) {
      laeuft = false;
      clearInterval(takt);
      return;
    }
    if (!daten?.bilder.length) return;
    laeuft = true;
    if (bild >= daten.bilder.length - 1) bild = 0;
    let pause = 0;
    takt = setInterval(() => {
      if (bild >= daten.bilder.length - 1) {
        if (++pause < 4) return;
        pause = 0;
        bild = 0;
      } else bild += 1;
    }, 450);
  }
  onDestroy(() => clearInterval(takt));

  // ---------------------------------------------------------------- Zeichnen
  const farbeVon = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Radarbild einmal je Bild in eine kleine Leinwand (1 Pixel = 1 km)
  const bildCache = new Map();
  function radarBild(d, i) {
    const schluessel = `${d.bbox.join(",")}|${d.bilder[i].zeit}`;
    if (bildCache.has(schluessel)) return bildCache.get(schluessel);
    const c = document.createElement("canvas");
    c.width = d.spalten;
    c.height = d.zeilen;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(d.spalten, d.zeilen);
    const w = d.bilder[i].werte;
    for (let p = 0; p < w.length; p++) {
      const f = w[p] ? farbe(mmProStunde(w[p])) : null;
      if (!f) continue;
      img.data[p * 4] = f[0];
      img.data[p * 4 + 1] = f[1];
      img.data[p * 4 + 2] = f[2];
      img.data[p * 4 + 3] = 215;
    }
    ctx.putImageData(img, 0, 0);
    if (bildCache.size > 60) bildCache.clear();
    bildCache.set(schluessel, c);
    return c;
  }

  // Größe der Zeichnung: so groß wie möglich, Seitenverhältnis des Ausschnitts
  const mass = $derived.by(() => {
    if (!daten || !breite || !hoehe) return null;
    const s = Math.min(breite / daten.spalten, hoehe / daten.zeilen);
    return { s, w: Math.floor(daten.spalten * s), h: Math.floor(daten.zeilen * s) };
  });

  $effect(() => {
    if (!leinwand || !mass || !daten) return;
    const { s, w, h } = mass;
    const dpr = window.devicePixelRatio || 1;
    leinwand.width = w * dpr;
    leinwand.height = h * dpr;
    const ctx = leinwand.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = farbeVon("--flaeche-2");
    ctx.fillRect(0, 0, w, h);

    const [o, l] = daten.bbox;
    const x = (gx) => (gx - l) * s;
    const y = (gy) => (gy - o) * s;

    // Karte unter dem Radar: Seen
    ctx.lineJoin = ctx.lineCap = "round";
    const linien = (teile, stil, breiteLinie, strich = []) => {
      ctx.strokeStyle = stil;
      ctx.lineWidth = breiteLinie;
      ctx.setLineDash(strich);
      ctx.beginPath();
      for (const t of teile) {
        ctx.moveTo(x(t[0]), y(t[1]));
        for (let i = 2; i < t.length; i += 2) ctx.lineTo(x(t[i]), y(t[i + 1]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const blau = farbeVon("--blau");
    ctx.globalAlpha = 0.35;
    linien(karte.seen, blau, 1);
    linien(karte.fluesse, blau, km === 100 ? 1.3 : 0.9);
    ctx.globalAlpha = 1;

    // Radar
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(radarBild(daten, Math.min(bild, daten.bilder.length - 1)), 0, 0, w, h);

    // Grenzen über dem Radar
    const text = farbeVon("--text");
    const leise = farbeVon("--text-3");
    linien(karte.laender, leise, 0.8, [4, 3]);
    linien(karte.grenzen, leise, 1);
    linien(karte.deutschland, text, km ? 1.6 : 1.2);

    // Orte: je Ausschnitt weniger oder mehr; Beschriftungen überdecken sich nicht
    const belegt = [[0, h - 34, 110, h]]; // Maßstab unten links bleibt frei
    const frei = (bx) => !belegt.some((a) => bx[0] < a[2] && bx[2] > a[0] && bx[1] < a[3] && bx[3] > a[1]);
    const schrift = farbeVon("--schrift") || "sans-serif";
    const hell = farbeVon("--flaeche");
    ctx.textBaseline = "middle";
    const ort = (name, gx, gy, gross, farbeText, r) => {
      const px = x(gx);
      const py = y(gy);
      if (px < 0 || py < 0 || px > w || py > h) return;
      ctx.font = `${gross}px ${schrift}`;
      const bx = [px - r, py - gross / 2 - 1, px + 6 + ctx.measureText(name).width, py + gross / 2 + 1];
      if (!frei(bx)) return;
      belegt.push(bx);
      ctx.fillStyle = farbeText;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hell;
      ctx.strokeText(name, px + 5, py);
      ctx.fillText(name, px + 5, py);
    };
    const rangBis = km === 100 ? 3 : km === 250 ? 2 : 1;
    for (const [name, gx, gy, rang] of karte.orte) if (rang <= rangBis) ort(name, gx, gy, km ? 12 : 11, text, 2.4);
    if (km === 100) for (const [name, gx, gy] of stationsPunkte) ort(name, gx, gy, 10.5, leise, 1.6);

    // Mittelpunkt
    const mx = x(punkt[0]);
    const my = y(punkt[1]);
    const akzent = farbeVon("--akzent");
    ctx.strokeStyle = akzent;
    ctx.fillStyle = akzent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 2, 0, 2 * Math.PI);
    ctx.fill();
    // Maßstab: 10 bzw. 50 bzw. 100 km
    const skala = km === 100 ? 10 : km === 250 ? 50 : 100;
    ctx.fillStyle = text;
    ctx.fillRect(10, h - 14, skala * s, 3);
    ctx.font = `11px ${farbeVon("--schrift") || "sans-serif"}`;
    ctx.fillText(`${skala} km`, 10, h - 24);
  });

  function tippen(e) {
    if (!mass || !daten) return;
    const r = leinwand.getBoundingClientRect();
    const gx = daten.bbox[1] + (e.clientX - r.left) / mass.s;
    const gy = daten.bbox[0] + (e.clientY - r.top) / mass.s;
    mitte = [gx, gy];
    mitteArt = "tipp";
  }

  const aktuell = $derived(daten?.bilder[Math.min(bild, daten.bilder.length - 1)]);
  const vorhersage = $derived(aktuell ? Date.parse(aktuell.zeit) > Date.now() : false);
</script>

<div class="radar">
  <div class="leiste">
    <div class="gruppe">
      {#each ZOOMS as [k, , t]}
        <button class="chip" class:an={zoom === k} onclick={() => (zoom = k)}>{t}</button>
      {/each}
    </div>
    <div class="gruppe">
      <button class="chip" class:an={!mitte} onclick={() => ((mitte = null), (mitteArt = "station"))} title="Mittelpunkt auf die Station">{station.name}</button>
      {#if meinStandort}
        <button class="chip" class:an={mitte && mitteArt === "gps"} onclick={zumStandort} title="Mittelpunkt auf den Standort dieses Geräts"><Symbol name="standort" /> Mein Standort</button>
      {/if}
      {#if mitte && mitteArt === "tipp"}<span class="chip an">angetippter Punkt</span>{/if}
    </div>
    <button class="chip" onclick={() => laden(bbox, true)} disabled={laedt} title="Neu laden"><Symbol name="aktualisieren" /></button>
    {#if laedt}<span class="leise">lädt …</span>{/if}
    {#if ortFehler}<span class="leise">{ortFehler}</span>{/if}
  </div>

  <div class="flaeche" bind:clientWidth={breite} bind:clientHeight={hoehe}>
    {#if fehler}
      <div class="leise mitte">{fehler}</div>
    {:else if !daten}
      <div class="leise mitte">Radar lädt …</div>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <canvas bind:this={leinwand} style:width="{mass?.w ?? 0}px" style:height="{mass?.h ?? 0}px" onclick={tippen} title="Tippen setzt den Mittelpunkt"></canvas>
  </div>

  {#if daten?.bilder.length}
    <div class="zeit">
      <button class="chip abspielen" onclick={abspielen} title={laeuft ? "Anhalten" : "Abspielen"}>{laeuft ? "❚❚" : "▶"}</button>
      <input type="range" min="0" max={daten.bilder.length - 1} bind:value={bild} />
      <span class="num uhr">{uhr(aktuell.zeit)}</span>
      <span class="marke" class:vorhersage>{vorhersage ? "Vorhersage" : "gemessen"}</span>
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
    grid-template-rows: auto minmax(0, 1fr) auto auto;
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
  }
  canvas {
    border-radius: 8px;
    border: 1px solid var(--rand);
    cursor: crosshair;
    touch-action: manipulation;
  }
  .mitte {
    position: absolute;
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
    .flaeche {
      place-items: start center;
    }
  }
</style>
