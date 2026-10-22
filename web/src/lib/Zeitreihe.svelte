<script>
  // Eine Größe über die ganze Reihe, als Tag, Monat oder Jahr - mit uPlot,
  // das 60.000 Tageswerte ohne Zögern zeichnet. Ziehen wählt einen
  // Ausschnitt, das Rad zoomt, Doppelklick zeigt alles. Darunter die
  // Übersicht: der blaue Rahmen ist der sichtbare Ausschnitt.
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";
  import { de } from "./format.js";

  let { reihe, name, groesse, aufloesung, handy = false } = $props();

  let behaelter = $state();
  let uebersichtBreite = $state(800);
  let ausschnitt = $state(null); // [min, max] in Sekunden
  let zeiger = $state(null);
  let plot = null;

  // Farben des Themas für die Zeichenfläche (uPlot zeichnet ohne CSS)
  const farbe = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const FARBE = { m: "--akzent", x: "--rot", n: "--blau" };
  const GROESSE = { m: "Mittel", x: "Höchstwert", n: "Tiefstwert" };
  const AUFLOESUNG = { jahr: "Jahresmittel", monat: "Monatsmittel", tag: "Tageswerte" };

  const jahrVon = (t) => new Date(t * 1000).getUTCFullYear();
  function zeitText(t) {
    const d = new Date(t * 1000);
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    if (aufloesung === "jahr") return String(d.getUTCFullYear());
    if (aufloesung === "monat") return `${mo}.${d.getUTCFullYear()}`;
    return `${String(d.getUTCDate()).padStart(2, "0")}.${mo}.${d.getUTCFullYear()}`;
  }

  const titel = $derived(
    reihe.t.length
      ? `${GROESSE[groesse]}, ${AUFLOESUNG[aufloesung]} ${jahrVon(reihe.t[0])}–${jahrVon(reihe.t.at(-1))}`
      : `${name}: keine Werte`,
  );

  function daten() {
    if (aufloesung === "jahr") return [reihe.t, reihe.v, reihe.glatt];
    if (aufloesung === "tag") {
      const spruenge = new Array(reihe.t.length).fill(null);
      const stelle = new Map(reihe.t.map((t, i) => [t, i]));
      for (const [t, v] of reihe.spruenge) spruenge[stelle.get(t)] = v;
      return [reihe.t, reihe.v, spruenge];
    }
    return [reihe.t, reihe.v];
  }

  function serien() {
    const linie = farbe(FARBE[groesse]);
    const s = [{}];
    if (aufloesung === "jahr") {
      s.push({ stroke: "#9aa1ad", width: 0, points: { show: true, size: 5, fill: "#b8bec8", stroke: "#b8bec8" } });
      s.push({ stroke: linie, width: 2.2, points: { show: false } });
    } else if (aufloesung === "monat") {
      s.push({ stroke: linie, width: 1, points: { show: false } });
    } else {
      s.push({ stroke: linie, width: 1, points: { show: false } });
      s.push({ stroke: "#dc2626", width: 0, points: { show: true, size: 8, fill: farbe("--flaeche"), stroke: "#dc2626", width: 2 } });
    }
    return s;
  }

  // Mausrad: um die Mausposition zoomen, nie über die Reihe hinaus.
  function radZoom() {
    return {
      hooks: {
        ready: (u) => {
          u.over.addEventListener(
            "wheel",
            (e) => {
              e.preventDefault();
              const { min, max } = u.scales.x;
              const alles = [u.data[0][0], u.data[0].at(-1)];
              const mitte = u.posToVal(e.offsetX, "x");
              const faktor = e.deltaY < 0 ? 0.8 : 1.25;
              let neuMin = mitte - (mitte - min) * faktor;
              let neuMax = mitte + (max - mitte) * faktor;
              if (neuMax - neuMin >= alles[1] - alles[0]) [neuMin, neuMax] = alles;
              else if (neuMin < alles[0]) ((neuMax += alles[0] - neuMin), (neuMin = alles[0]));
              else if (neuMax > alles[1]) ((neuMin -= neuMax - alles[1]), (neuMax = alles[1]));
              u.setScale("x", { min: neuMin, max: neuMax });
            },
            { passive: false },
          );
        },
      },
    };
  }

  function bauen() {
    plot?.destroy();
    plot = null;
    if (!behaelter || !reihe.t.length) return;
    const r = behaelter.getBoundingClientRect();
    const opts = {
      width: Math.max(300, r.width),
      height: Math.max(200, r.height),
      legend: { show: false },
      cursor: { y: false, points: { show: false }, drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: farbe("--text-3"), grid: { stroke: farbe("--gitter") }, ticks: { stroke: farbe("--rand") }, font: "11px Cascadia Mono, Consolas, monospace" },
        {
          stroke: farbe("--text-3"),
          grid: { stroke: farbe("--gitter") },
          ticks: { stroke: farbe("--rand") },
          font: "11px Cascadia Mono, Consolas, monospace",
          values: (u, v) => v.map((x) => de(x, Number.isInteger(x) ? 0 : 1)),
          size: 44,
        },
      ],
      series: serien(),
      plugins: [radZoom()],
      hooks: {
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            zeiger = i == null ? null : i;
          },
        ],
        setScale: [
          (u, key) => {
            if (key === "x") ausschnitt = [u.scales.x.min, u.scales.x.max];
          },
        ],
      },
    };
    plot = new uPlot(opts, daten(), behaelter);
    ausschnitt = [plot.scales.x.min, plot.scales.x.max];
  }

  $effect(() => {
    reihe;
    aufloesung;
    groesse;
    bauen();
    return () => {
      plot?.destroy();
      plot = null;
    };
  });

  $effect(() => {
    if (!behaelter) return;
    const beobachter = new ResizeObserver(() => {
      if (!plot) return;
      const r = behaelter.getBoundingClientRect();
      plot.setSize({ width: Math.max(300, r.width), height: Math.max(200, r.height) });
    });
    beobachter.observe(behaelter);
    return () => beobachter.disconnect();
  });

  // ---------------------------------------------------------- Übersicht
  const UH = 54;
  const uebersicht = $derived.by(() => {
    const { t, v } = reihe;
    if (!t.length) return { pfad: "", t0: 0, t1: 1 };
    const t0 = t[0];
    const t1 = t.at(-1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of v) if (x != null) ((lo = Math.min(lo, x)), (hi = Math.max(hi, x)));
    // höchstens ein Punkt je Pixel: je Spalte Min und Max
    const spalten = Math.max(50, Math.round(uebersichtBreite));
    const mins = new Array(spalten).fill(Infinity);
    const maxs = new Array(spalten).fill(-Infinity);
    for (let i = 0; i < t.length; i++) {
      if (v[i] == null) continue;
      const s = Math.min(spalten - 1, Math.floor(((t[i] - t0) / (t1 - t0 || 1)) * spalten));
      mins[s] = Math.min(mins[s], v[i]);
      maxs[s] = Math.max(maxs[s], v[i]);
    }
    const y = (x) => 4 + (1 - (x - lo) / (hi - lo || 1)) * (UH - 8);
    let pfad = "";
    for (let s = 0; s < spalten; s++) {
      if (mins[s] === Infinity) continue;
      const x = (s / spalten) * uebersichtBreite;
      pfad += `M${x.toFixed(1)},${y(maxs[s]).toFixed(1)}V${(y(mins[s]) + 2).toFixed(1)}`;
    }
    return { pfad, t0, t1 };
  });

  const xu = (t) => ((t - uebersicht.t0) / (uebersicht.t1 - uebersicht.t0 || 1)) * uebersichtBreite;

  // Handy: kein Mausrad - Knöpfe zoomen um die Mitte des Ausschnitts
  function zoomen(faktor) {
    if (!plot || !ausschnitt) return;
    const [lo, hi] = [uebersicht.t0, uebersicht.t1];
    const mitte = (ausschnitt[0] + ausschnitt[1]) / 2;
    const halb = Math.min((hi - lo) / 2, ((ausschnitt[1] - ausschnitt[0]) / 2) * faktor);
    let min = mitte - halb, max = mitte + halb;
    if (min < lo) ((max += lo - min), (min = lo));
    if (max > hi) ((min -= max - hi), (max = hi));
    plot.setScale("x", { min, max });
  }

  let ziehen = false;
  function uebersichtZeigen(e) {
    if (!plot || !ausschnitt) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = uebersicht.t0 + ((e.clientX - r.left) / r.width) * (uebersicht.t1 - uebersicht.t0);
    const halb = (ausschnitt[1] - ausschnitt[0]) / 2;
    let min = t - halb;
    let max = t + halb;
    if (min < uebersicht.t0) ((max += uebersicht.t0 - min), (min = uebersicht.t0));
    if (max > uebersicht.t1) ((min -= max - uebersicht.t1), (max = uebersicht.t1));
    plot.setScale("x", { min, max });
  }

  const ablesen = $derived.by(() => {
    if (zeiger == null || !reihe.t[zeiger]) return "";
    const t = reihe.t[zeiger];
    let text = `${zeitText(t)}: ${de(reihe.v[zeiger], aufloesung === "tag" ? 1 : 2)} °C`;
    if (aufloesung === "jahr" && reihe.glatt) text += ` · 31-Jahre-Mittel ${de(reihe.glatt[zeiger], 2)} °C`;
    if (aufloesung === "tag") {
      const sprung = reihe.spruenge.find((s) => s[0] === t);
      if (sprung) text += ` · Sprung vom Vortag ${de(sprung[2])} °C`;
    }
    return text;
  });
</script>

<div class="stapel">
  <div class="karte grafik">
    <div class="kopf">
      <b><span class="name">{name}: </span>{titel}</b>
      {#if handy}
        <span class="zoom">
          <button class="chip" onclick={() => zoomen(0.5)}>＋</button>
          <button class="chip" onclick={() => zoomen(2)}>－</button>
          <button class="chip" onclick={() => plot?.setScale("x", { min: uebersicht.t0, max: uebersicht.t1 })}>alles</button>
        </span>
      {:else}
        <span class="leise">ziehen = Ausschnitt · Rad = zoomen · Doppelklick = alles</span>
      {/if}
      <span class="raum"></span>
      <span class="num ablesen">{ablesen}</span>
    </div>
    <div class="plot" bind:this={behaelter}></div>
    <div class="leise fuss">
      {#if aufloesung === "jahr"}
        Punkte: Jahre mit mind. 330 Tagen · Linie: Mittel über 31 Jahre
      {:else if aufloesung === "monat"}
        Nur Monate mit mindestens 90 % gemessener Tage
      {:else}
        Rote Ringe: Sprung von mehr als 15 K zum Vortag ({reihe.spruenge.length}) - markiert, nicht entfernt
      {/if}
    </div>
  </div>
  <div class="karte unten">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="uebersicht"
      bind:clientWidth={uebersichtBreite}
      onpointerdown={(e) => ((ziehen = true), e.currentTarget.setPointerCapture(e.pointerId), uebersichtZeigen(e))}
      onpointermove={(e) => ziehen && uebersichtZeigen(e)}
      onpointerup={() => (ziehen = false)}
      onpointercancel={() => (ziehen = false)}
    >
      <svg width={uebersichtBreite} height={UH}>
        <path d={uebersicht.pfad} style:stroke="var(--rand-stark)" stroke-width="1.2" />
        {#if ausschnitt}
          {@const x0 = Math.max(1, xu(ausschnitt[0]))}
          {@const x1 = Math.min(uebersichtBreite - 1, xu(ausschnitt[1]))}
          <rect
            x={x0}
            y="1"
            width={Math.max(3, x1 - x0)}
            height={UH - 2}
            rx="4"
            class="rahmen"
          />
        {/if}
      </svg>
    </div>
    <div class="leise">Übersicht: Rahmen = Ausschnitt, tippen oder ziehen</div>
  </div>
</div>

<style>
  .stapel {
    display: grid;
    grid-template-rows: 1fr auto;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
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
  }
  .raum {
    flex: 1;
  }
  .ablesen {
    font-size: 12px;
    color: var(--text-2);
  }
  .plot {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .fuss {
    padding-top: 4px;
  }
  .unten {
    padding: 10px 14px 8px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .uebersicht {
    min-width: 0;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .zoom {
    display: inline-flex;
    gap: 4px;
  }

  /* Handy: feste Höhe, Kopf darf umbrechen */
  @media (max-width: 700px) {
    .stapel {
      height: auto;
      grid-template-rows: auto auto;
    }
    .grafik {
      height: 380px;
      padding: 10px 6px 6px;
    }
    .kopf {
      flex-wrap: wrap;
      row-gap: 4px;
    }
    .kopf b {
      white-space: normal;
    }
    .name {
      display: none;
    }
    .grafik,
    .unten {
      min-width: 0;
    }
  }
  svg {
    display: block;
  }
  .rahmen {
    fill: rgb(234 88 12 / 8%);
    stroke: var(--akzent);
    stroke-width: 1.5;
  }
  :global(.u-select) {
    background: rgb(234 88 12 / 10%);
  }
</style>
