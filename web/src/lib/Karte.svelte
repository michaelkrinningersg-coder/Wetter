<script>
  // Die eigene Karte (karte.json, Natural Earth) im Raster des DWD-Radars:
  // stufenlos zoomen (zwei Finger, Mausrad, doppelt tippen), ziehen, tippen
  // und lange drücken. Gemeinsam für Regenradar und Ortswahl - das Radar
  // zeichnet seinen Regen über `unten` zwischen Wasser und Grenzen.
  // Mit `orte` (Ortsliste, orte.js) kommen je nach Zoom mehr Ortsnamen und
  // die Gipfel dazu.
  import { onDestroy } from "svelte";
  import karte from "./karte.json";
  import { ansichtKlemmen, massstab, raster, unterPunkt, zoomUm } from "./raster.js";

  let {
    ansicht = $bindable({ x: 550, y: 600, km: 100 }), // Mitte im Raster, km über die kürzere Seite
    breite = $bindable(0),
    hoehe = $bindable(0),
    unten = null, // (ctx, {x, y, s, w, h}) - wird vor den Grenzen gezeichnet
    punkt = null, // [Spalte, Zeile] - der orange Punkt
    punktName = "", // Beschriftung am Punkt
    pins = [], // [{gx, gy, name}] - Favoriten
    stationsPunkte = [], // [[name, gx, gy]] - im nahen Zoom
    orte = null, // vorbereitete Ortsliste oder null
    ontipp = null, // (gx, gy)
    onlang = null, // (gx, gy) - lange gedrückt
    titel = "Ziehen verschiebt · zwei Finger oder Mausrad zoomen · doppelt tippen vergrößert · tippen setzt den Punkt",
  } = $props();

  let leinwand = $state();

  // Rasterlage der Ortsliste einmal ausrechnen
  const orteXY = $derived.by(() => {
    if (!orte) return null;
    const gx = new Float32Array(orte.n.length);
    const gy = new Float32Array(orte.n.length);
    for (let i = 0; i < orte.n.length; i++) [gx[i], gy[i]] = raster(orte.l[i] / 1000, orte.b[i] / 1000);
    return { gx, gy };
  });

  // ab wie vielen Einwohnern ein Ort aus der Ortsliste beschriftet wird
  const mindestens = (km) => (km > 600 ? Infinity : km > 250 ? 50000 : km > 120 ? 10000 : km > 60 ? 2000 : km > 25 ? 300 : 0);

  const farbeVon = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  $effect(() => {
    if (!leinwand || !breite || !hoehe) return;
    const w = breite;
    const h = hoehe;
    const dpr = window.devicePixelRatio || 1;
    leinwand.width = Math.round(w * dpr);
    leinwand.height = Math.round(h * dpr);
    const ctx = leinwand.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = farbeVon("--flaeche-2");
    ctx.fillRect(0, 0, w, h);

    const km = ansicht.km;
    const s = massstab(ansicht, w, h);
    const x = (gx) => (gx - ansicht.x) * s + w / 2;
    const y = (gy) => (gy - ansicht.y) * s + h / 2;
    const nah = km <= 130;
    const zoomt = km <= 400;

    // Wasser
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
    linien(karte.fluesse, blau, nah ? 1.3 : 0.9);
    ctx.globalAlpha = 1;

    unten?.(ctx, { x, y, s, w, h });

    // Grenzen - im Zoom kräftig und über dem Regen: heller Rand, dann die Linie
    const text = farbeVon("--text");
    const leise = farbeVon("--text-3");
    const hell = farbeVon("--flaeche");
    if (zoomt) {
      ctx.globalAlpha = 0.85;
      linien(karte.laender, hell, 3.6);
      ctx.globalAlpha = 1;
      linien(karte.laender, farbeVon("--text-2"), 1.5);
    } else {
      linien(karte.laender, leise, 0.8, [4, 3]);
    }
    linien(karte.grenzen, leise, 1);
    if (zoomt) {
      ctx.globalAlpha = 0.85;
      linien(karte.deutschland, hell, 4.4);
      ctx.globalAlpha = 1;
    }
    linien(karte.deutschland, text, zoomt ? 2 : 1.2);

    // Beschriftungen überdecken sich nicht; wer zuerst kommt, steht
    const belegt = [[0, h - 34, 110, h]]; // Maßstab unten links bleibt frei
    const frei = (bx) => !belegt.some((a) => bx[0] < a[2] && bx[2] > a[0] && bx[1] < a[3] && bx[3] > a[1]);
    const schrift = farbeVon("--schrift") || "sans-serif";
    ctx.textBaseline = "middle";
    const marke = (name, gx, gy, gross, farbeText, r, form = "punkt") => {
      const px = x(gx);
      const py = y(gy);
      if (px < 0 || py < 0 || px > w || py > h) return;
      ctx.font = `${gross}px ${schrift}`;
      const bx = [px - r, py - gross / 2 - 1, px + 6 + ctx.measureText(name).width, py + gross / 2 + 1];
      if (!frei(bx)) return;
      belegt.push(bx);
      ctx.fillStyle = farbeText;
      ctx.beginPath();
      if (form === "gipfel") {
        ctx.moveTo(px, py - r - 1);
        ctx.lineTo(px + r + 1, py + r);
        ctx.lineTo(px - r - 1, py + r);
        ctx.closePath();
      } else ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hell;
      ctx.strokeText(name, px + 5, py);
      ctx.fillText(name, px + 5, py);
    };

    // der gewählte Punkt und die Favoriten zuerst - sie sollen immer zu sehen sein
    const akzent = farbeVon("--akzent");
    if (punkt && punktName) marke(punktName, punkt[0], punkt[1], 13, akzent, 0.1);
    for (const p of pins) marke(p.name, p.gx, p.gy, 12, akzent, 3.4);

    const rangBis = nah ? 3 : km <= 320 ? 2 : 1;
    for (const [name, gx, gy, rang] of karte.orte) if (rang <= rangBis) marke(name, gx, gy, zoomt ? 12 : 11, text, 2.4);

    // mehr Orte aus der Ortsliste (nach Einwohnern sortiert) und Gipfel
    if (orteXY) {
      const ab = mindestens(km);
      const [gl, go] = unterPunkt(ansicht, 0, 0, w, h);
      const gr = gl + w / s;
      const gu = go + h / s;
      let gesetzt = 0;
      for (let i = 0; i < orte.n.length && gesetzt < 120; i++) {
        const gipfel = orte.g[i] === 1;
        if (gipfel ? km > 60 : orte.e[i] < ab) continue;
        const gx = orteXY.gx[i];
        const gy = orteXY.gy[i];
        if (gx < gl || gx > gr || gy < go || gy > gu) continue;
        const vorher = belegt.length;
        if (gipfel) marke(`${orte.n[i]}${orte.h[i] != null ? ` ${orte.h[i]}` : ""}`, gx, gy, 10.5, farbeVon("--text-2"), 2.6, "gipfel");
        else marke(orte.n[i], gx, gy, orte.e[i] >= 10000 ? 12 : 11, text, orte.e[i] >= 10000 ? 2.4 : 1.8);
        if (belegt.length > vorher) gesetzt++;
      }
    }
    if (nah) for (const [name, gx, gy] of stationsPunkte) marke(name, gx, gy, 10.5, leise, 1.6);

    // der Punkt
    if (punkt) {
      const mx = x(punkt[0]);
      const my = y(punkt[1]);
      ctx.strokeStyle = akzent;
      ctx.fillStyle = akzent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    // Maßstab: runde Länge um ein Achtel der Ansicht
    const skala = [1, 2, 5, 10, 20, 50, 100, 200].findLast((v) => v <= km / 8) ?? 1;
    ctx.fillStyle = text;
    ctx.fillRect(10, h - 14, skala * s, 3);
    ctx.font = `11px ${schrift}`;
    ctx.fillText(`${skala} km`, 10, h - 24);
  });

  // ---------------------------------------------------------------- Bedienung
  // Ein Finger/Maus zieht, zwei Finger zoomen, doppelt tippen vergrößert,
  // einfach tippen meldet den Punkt, lange drücken (0,6 s) ebenso über onlang;
  // Mausrad zoomt um den Mauszeiger.
  const zeiger = new Map(); // pointerId -> [x, y]
  let geste = null;
  let bewegt = false;
  let lang = null; // Zeitgeber fürs lange Drücken
  let langErledigt = false;
  const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function inLeinwand(e) {
    const r = leinwand.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  const rasterPunkt = (p) => unterPunkt(ansicht, p[0], p[1], breite, hoehe);
  function gesteBeginnen() {
    const p = [...zeiger.values()];
    if (p.length === 1) geste = { art: "ziehen", start: p[0], a: ansicht };
    else if (p.length >= 2) {
      geste = { art: "zwicken", abstand: Math.max(1, abstand(p[0], p[1])), mitte: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], a: ansicht };
      bewegt = true;
      clearTimeout(lang);
    }
  }
  function runter(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    leinwand.setPointerCapture(e.pointerId);
    if (!zeiger.size) ((bewegt = false), (langErledigt = false));
    zeiger.set(e.pointerId, inLeinwand(e));
    gesteBeginnen();
    clearTimeout(lang);
    if (onlang && zeiger.size === 1) {
      const p = inLeinwand(e);
      lang = setTimeout(() => {
        if (bewegt) return;
        langErledigt = true;
        const [gx, gy] = rasterPunkt(p);
        onlang(gx, gy);
      }, 600);
    }
  }
  function ziehen(e) {
    if (!zeiger.has(e.pointerId) || !geste) return;
    zeiger.set(e.pointerId, inLeinwand(e));
    const p = [...zeiger.values()];
    if (geste.art === "ziehen") {
      const dx = p[0][0] - geste.start[0];
      const dy = p[0][1] - geste.start[1];
      if (!bewegt && Math.hypot(dx, dy) < 6) return;
      bewegt = true;
      clearTimeout(lang);
      const s = massstab(geste.a, breite, hoehe);
      ansicht = ansichtKlemmen({ ...geste.a, x: geste.a.x - dx / s, y: geste.a.y - dy / s });
    } else if (p.length >= 2) {
      const m = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      const a = zoomUm(geste.a, abstand(p[0], p[1]) / geste.abstand, geste.mitte[0], geste.mitte[1], breite, hoehe);
      const s = massstab(a, breite, hoehe);
      ansicht = ansichtKlemmen({ ...a, x: a.x - (m[0] - geste.mitte[0]) / s, y: a.y - (m[1] - geste.mitte[1]) / s });
    }
  }
  function hoch(e, abgebrochen = false) {
    if (!zeiger.has(e.pointerId)) return;
    const p = inLeinwand(e);
    zeiger.delete(e.pointerId);
    clearTimeout(lang);
    if (zeiger.size) return gesteBeginnen();
    geste = null;
    if (!bewegt && !abgebrochen && !langErledigt) tippen(p);
  }

  let letzterTipp = null;
  let tippTakt = null;
  function tippen(p) {
    const jetzt = Date.now();
    if (letzterTipp && jetzt - letzterTipp.zeit < 300 && abstand(p, letzterTipp.p) < 30) {
      clearTimeout(tippTakt);
      letzterTipp = null;
      ansicht = zoomUm(ansicht, 2, p[0], p[1], breite, hoehe);
      return;
    }
    letzterTipp = { zeit: jetzt, p };
    clearTimeout(tippTakt);
    tippTakt = setTimeout(() => {
      letzterTipp = null;
      const [gx, gy] = rasterPunkt(p);
      ontipp?.(gx, gy);
    }, 300);
  }
  onDestroy(() => {
    clearTimeout(tippTakt);
    clearTimeout(lang);
  });

  // Mausrad: nicht passiv, sonst scrollt die Seite mit
  $effect(() => {
    if (!leinwand) return;
    const rad = (e) => {
      e.preventDefault();
      const [px, py] = inLeinwand(e);
      const schritte = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
      ansicht = zoomUm(ansicht, Math.pow(1.25, -schritte), px, py, breite, hoehe);
    };
    leinwand.addEventListener("wheel", rad, { passive: false });
    return () => leinwand.removeEventListener("wheel", rad);
  });
</script>

<div class="karte-flaeche" bind:clientWidth={breite} bind:clientHeight={hoehe}>
  <canvas
    bind:this={leinwand}
    style:width="{breite}px"
    style:height="{hoehe}px"
    onpointerdown={runter}
    onpointermove={ziehen}
    onpointerup={(e) => hoch(e)}
    onpointercancel={(e) => hoch(e, true)}
    oncontextmenu={(e) => e.preventDefault()}
    {titel}
  ></canvas>
</div>

<style>
  .karte-flaeche {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  canvas {
    position: absolute;
    left: 0;
    top: 0;
    cursor: grab;
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  canvas:active {
    cursor: grabbing;
  }
</style>
