<script>
  // Wetter - die Seite. Zustand, Abrufe und Ansichten sind gemeinsam; darum
  // liegen zwei Hüllen:
  //
  //   PC (Layout D): Menüleiste Datei · Station · Ansicht · Daten · Hilfe,
  //   darunter das Menüband mit den Gruppen Station, Ansicht, Zeitraum,
  //   Qualität und Daten. Graphit mit orangem Akzent.
  //   Handy: Kopfzeile mit Station, darunter die Schalter der Ansicht, unten
  //   die Navigation; QN und Bereinigung unter "Mehr".
  //
  // Alles kommt über `rufe()` - am PC aus Python, auf Android aus dem
  // Rechenkern im Handy. Beim Start zeigt die Seite sofort den gespeicherten
  // Stand; was im Hintergrund vom DWD kommt, meldet `status()` mit einem
  // Zähler - steigt er, wird die Ansicht neu geladen.
  import { onMount } from "svelte";
  import { aufDemHandy, rufe } from "./lib/api.js";
  import { MONATE, datum, tausend } from "./lib/format.js";
  import Symbol from "./lib/Symbol.svelte";
  import { NORMALE, normalText, vergleich } from "./lib/zeitraum.svelte.js";
  import { letzterStandort, meinStandort, naechsteStation } from "./lib/standort.js";
  import { meldungenErlauben, nativ, widgetJetzt, widgetSetzen, widgetStatus } from "./lib/nativ.js";
  import { MODELLE } from "./lokal/vorhersage.js";
  import { AUFRUF, AUSWERTUNGEN, DATEN_OPTIONEN, DEUTSCHLAND, HANDY_NAV, HAUPT, IST_AUSWERTUNG, OPTIONEN, TITEL } from "./lib/ansichten.js";
  import Uebersicht from "./lib/Uebersicht.svelte";
  import Vorhersage from "./lib/Vorhersage.svelte";
  import Radar from "./lib/Radar.svelte";
  import RekordeDE from "./lib/RekordeDE.svelte";
  import DeutschlandTop from "./lib/DeutschlandTop.svelte";
  import Auswertung from "./lib/Auswertung.svelte";
  import Jahresband from "./lib/Jahresband.svelte";
  import Monat from "./lib/Monat.svelte";
  import Rangliste from "./lib/Rangliste.svelte";
  import Stationswahl from "./lib/Stationswahl.svelte";
  import Zeitreihe from "./lib/Zeitreihe.svelte";
  import symbolRoh from "./lib/icon.svg?raw";
  const symbol = "data:image/svg+xml," + encodeURIComponent(symbolRoh);

  let stationen = $state([]);
  let station = $state(null); // {station, zeitraum, abruf}
  let favoriten = $state([]);
  let ansicht = $state("band");
  let qn = $state("alle");
  let jahr = $state(null);
  let groesse = $state("m");
  let aufloesung = $state("jahr");
  let monatWahl = $state(null); // [jahr, monat] oder null = letzter
  let rangModus = $state("heute");
  let rangPrognose = $state(true);

  let band = $state(null);
  let monat = $state(null);
  let liste = $state(null);
  let reihe = $state(null);
  let auswertung = $state(null); // Ergebnis der gerade gezeigten Auswertung
  let vorhersage = $state(null);
  let rekordeDe = $state(null); // Rekorde Deutschland (für Seite und Laufband)
  let deutschlandDaten = $state(null); // Top 50: letzte 7 Tage aller aktiven Stationen
  let ort = $state("station"); // Vorhersage für die Station oder "gps" = Standort des Geräts
  let ortHinweis = $state("");
  // Widget und Meldungen am Handy (WetterNativ.java)
  let widget = $state({ ort: "station", modell: "icon_d2", unwetter: true, rekorde: true, gps: null });
  let widgetInfo = $state({ erlaubt: true, fehler: "" });
  let geschichteKurz = $state(null); // für die Übersicht
  let vmodell = $state("icon_d2");
  let thema = $state("system"); // system, hell, dunkel
  const THEMEN = [
    ["system", "Wie das System"],
    ["hell", "Hell"],
    ["dunkel", "Dunkel"],
  ];
  $effect(() => {
    if (thema === "system") delete document.documentElement.dataset.thema;
    else document.documentElement.dataset.thema = thema;
  });
  function themaSetzen(t) {
    thema = t;
    rufe("einstellung", "thema", t);
  }
  let optionen = $state(structuredClone(OPTIONEN));
  let laedt = $state("");
  let fehler = $state("");
  let hintergrund = $state({ laeuft: "", meldung: "", stand: 0 });
  let version = $state("");
  let datenordner = $state("");

  let handy = $state(false);
  let menue = $state(""); // offenes Menü der Menüleiste
  let hilfe = $state(false);
  let mehr = $state(false); // Handy: Blatt mit QN und Bereinigung
  let wahl = $state(); // Stationswahl, zum Öffnen aus dem Menü

  const QN = [
    ["alle", "alle"],
    ["ab5", "ab 5"],
    ["nur10", "nur 10"],
  ];
  const ANSICHTEN = HAUPT.map(([k, t, kurz, s]) => [k, t, s, kurz]);
  const ALLE = [...ANSICHTEN, ...AUSWERTUNGEN.map(([k, t, , s]) => [k, t, s]), ...DEUTSCHLAND.map(([k, t, , s]) => [k, t, s])];

  async function sicher(arbeit) {
    try {
      const r = await arbeit();
      if (r?.fehler) fehler = r.fehler;
      return r;
    } catch (e) {
      fehler = String(e?.message ?? e);
      return { fehler };
    }
  }

  async function stationLaden(id, mitMeldung = true) {
    const name = stationen.find((s) => s[0] === id)?.[1] ?? id;
    const hatTage = stationen.find((s) => s[0] === id)?.[6];
    if (mitMeldung && !hatTage) laedt = `${name}: erster Abruf beim DWD …`;
    const r = await sicher(() => rufe("station", id));
    laedt = "";
    if (r.fehler) return false;
    station = r;
    jahr = null;
    monatWahl = null;
    vorhersage = null;
    geschichteKurz = null;
    rufe("einstellung", "station", id);
    widgetAbgleichen();
    if (r.geladen) await listeNeu();
    await ansichtLaden();
    return true;
  }

  async function listeNeu() {
    const r = await rufe("stationen");
    if (r.stationen) stationen = r.stationen;
  }

  async function ansichtLaden() {
    if (!station) return;
    const id = station.station.id;
    if (ansicht === "uebersicht") {
      // alles gleichzeitig; die Vorhersage braucht das Netz und kommt zuletzt
      const [b, m, g] = await Promise.all([
        rufe("jahresband", id, null, qn, vergleich.von),
        rufe("monat", id, null, null, qn, vergleich.von),
        rufe("auswertung", id, "geschichte", qn, {}, vergleich.von),
      ]);
      if (!b.fehler) band = b;
      if (!m.fehler) monat = m;
      if (!g.fehler) geschichteKurz = g;
      vorhersageLaden();
      if (!rekordeDe) rekordeLaden();
    } else if (ansicht === "vorhersage") {
      await vorhersageLaden();
    } else if (ansicht === "radar") {
      // lädt selbst (Radar.svelte)
    } else if (ansicht === "rekorde_de") {
      await rekordeLaden();
    } else if (ansicht === "top50") {
      const r = await rufe("deutschland", false);
      if (!r.fehler) deutschlandDaten = r;
    } else if (ansicht === "band") {
      const r = await sicher(() => rufe("jahresband", id, jahr, qn, vergleich.von));
      if (!r.fehler) band = r;
    } else if (ansicht === "monat") {
      const r = await sicher(() => rufe("monat", id, monatWahl?.[0] ?? null, monatWahl?.[1] ?? null, qn, vergleich.von));
      if (!r.fehler) monat = r;
    } else if (IST_AUSWERTUNG.has(ansicht)) {
      const art = ansicht;
      const o = Object.fromEntries((DATEN_OPTIONEN[art] ?? []).map((k) => [k, optionen[art][k]]));
      const r = await sicher(() => rufe("auswertung", id, AUFRUF[art], qn, o, vergleich.von));
      if (!r.fehler && ansicht === art) auswertung = r;
    } else if (ansicht === "rang") {
      const r = await sicher(() => rufe("rangliste", id, rangModus, rangPrognose, qn, vergleich.von));
      if (!r.fehler) liste = r;
    } else {
      const r = await sicher(() => rufe("zeitreihe", id, groesse, aufloesung, qn));
      if (!r.fehler) reihe = r;
    }
    // die Bilanz der Bereinigung steht im Jahresband - auch für die Fußzeile
    if (ansicht !== "band" && !band) {
      const r = await rufe("jahresband", id, null, qn, vergleich.von);
      if (!r.fehler) band = r;
    }
  }

  function setze(was, wert) {
    menue = "";
    if (was === "ansicht") ((ansicht = wert), (auswertung = null), (mehr = false), rufe("einstellung", "ansicht", wert));
    // QN gilt nur bis zum nächsten Start - jeder Start beginnt mit "alle"
    if (was === "qn") ((qn = wert), (band = null));
    if (was === "normal") ((vergleich.von = wert), (band = null), (geschichteKurz = null), rufe("einstellung", "normal", wert));
    if (was === "jahr") jahr = wert;
    if (was === "groesse") groesse = wert;
    if (was === "aufloesung") aufloesung = wert;
    if (was === "monat") monatWahl = wert;
    if (was === "rangModus") ((rangModus = wert), rufe("einstellung", "rang_modus", wert));
    if (was === "rangPrognose") ((rangPrognose = wert), rufe("einstellung", "rang_prognose", wert));
    ansichtLaden();
  }

  function ortSetzen(o) {
    ort = o;
    ortHinweis = "";
    rufe("einstellung", "ort", o);
    vorhersageLaden();
  }

  async function rekordeLaden(neu = false) {
    const r = await rufe("rekorde_de", neu);
    if (!r.fehler) rekordeDe = r;
  }

  async function stationOeffnen(id) {
    if (await stationLaden(id)) setze("ansicht", "rekorde");
  }

  let vorhersageNr = 0; // nur die jüngste Anfrage zählt (Station oder Standort)
  async function vorhersageLaden(neu = false) {
    if (!station) return;
    const id = station.station.id;
    const nr = ++vorhersageNr;
    let r = null;
    if (ort === "gps") {
      // Standort des Geräts; klappt das nicht, die Station und ein Hinweis
      try {
        const p = await meinStandort();
        r = await rufe("vorhersage_ort", p.lat, p.lon, neu);
        if (!r.fehler) {
          const n = naechsteStation(stationen, p.lat, p.lon);
          r.station = { ...r.station, name: n ? `Mein Standort · bei ${n[0][1]}` : "Mein Standort", genau: p.genau };
          ortHinweis = "";
          if (nativ()) {
            widget = { ...widget, gps: { lat: p.lat, lon: p.lon } };
            rufe("einstellung", "widget", $state.snapshot(widget));
            if (widget.ort === "gps") widgetAbgleichen(false);
          }
        }
      } catch (e) {
        ortHinweis = `${e.message} – gezeigt wird ${station.station.name}`;
        r = null;
      }
      if (nr !== vorhersageNr) return;
    }
    r ??= await rufe("vorhersage", id, neu);
    if (nr !== vorhersageNr || station?.station.id !== id) return;
    if (r.fehler) {
      if (ansicht === "vorhersage") fehler = r.fehler;
      return;
    }
    vorhersage = r;
  }

  /** Option der gerade gezeigten Auswertung; rechnet neu, wenn sie die Zahlen ändert. */
  function setzeOption(name, wert) {
    optionen[ansicht][name] = wert;
    if (ansicht === "wellen") rufe("einstellung", "wellen", $state.snapshot(optionen.wellen));
    if ((DATEN_OPTIONEN[ansicht] ?? []).includes(name)) ansichtLaden();
  }

  // PC: die Auswertungen klappen unter ihrem Knopf auf (das Band selbst
  // schneidet Aufklappendes ab, daher fest positioniert)
  let auswPos = $state({ x: 0, y: 0 });
  const aktiveAuswertung = $derived([...AUSWERTUNGEN, ...DEUTSCHLAND].find((a) => a[0] === ansicht));
  function auswertungenAuf(e) {
    const r = e.currentTarget.getBoundingClientRect();
    auswPos = { x: r.left, y: r.bottom + 4 };
    menue = menue === "auswertungen" ? "" : "auswertungen";
  }

  function favoritUmschalten() {
    menue = "";
    if (!station) return;
    const id = station.station.id;
    favoriten = favoriten.includes(id) ? favoriten.filter((f) => f !== id) : [...favoriten, id];
    rufe("einstellung", "favoriten", favoriten);
    widgetAbgleichen();
  }

  // ------------------------------------------- Widget und Meldungen (Handy)
  async function widgetAbgleichen(neu = true) {
    if (!nativ() || !station) return;
    let ziel = { lat: station.station.lat, lon: station.station.lon, name: station.station.name };
    if (widget.ort === "gps" && widget.gps) {
      const n = naechsteStation(stationen, widget.gps.lat, widget.gps.lon);
      ziel = { ...widget.gps, name: n ? `Mein Standort · bei ${n[0][1]}` : "Mein Standort" };
    }
    const m = MODELLE.find((x) => x[0] === widget.modell) ?? MODELLE[0];
    await widgetSetzen({
      ...ziel,
      modell: m[3] === "met-norway" ? "metno" : m[4],
      modellName: m[1],
      favoriten: JSON.stringify(favoriten),
      unwetter: widget.unwetter,
      rekorde: widget.rekorde,
      neu,
    });
    widgetInfo = await widgetStatus();
    // einmal nach dem ersten Start fragen; später über "Meldungen erlauben"
    if (!widgetInfo.erlaubt && (widget.unwetter || widget.rekorde) && !widget.gefragt) {
      widget = { ...widget, gefragt: true };
      rufe("einstellung", "widget", $state.snapshot(widget));
      widgetInfo = { ...widgetInfo, ...(await meldungenErlauben()) };
    }
  }

  async function widgetSetze(name, wert) {
    widget = { ...widget, [name]: wert };
    if (name === "ort" && wert === "gps") {
      try {
        const p = await meinStandort();
        widget = { ...widget, gps: { lat: p.lat, lon: p.lon } };
      } catch (e) {
        ortHinweis = `Widget: ${e.message}`;
      }
    }
    if ((name === "unwetter" || name === "rekorde") && wert && !widgetInfo.erlaubt) widgetInfo = { ...widgetInfo, ...(await meldungenErlauben()) };
    rufe("einstellung", "widget", $state.snapshot(widget));
    widgetAbgleichen();
  }

  async function aktualisieren() {
    menue = "";
    if (!station) return;
    laedt = `${station.station.name}: Abruf beim DWD …`;
    const r = await sicher(() => rufe("aktualisieren", station.station.id));
    laedt = "";
    if (!r.fehler) {
      station = { ...station, zeitraum: r.zeitraum };
      if (ansicht === "uebersicht" || ansicht === "vorhersage") await vorhersageLaden(true);
      await ansichtLaden();
    }
  }

  let letzterStand = 0;
  async function horchen() {
    const s = await rufe("status").catch(() => null);
    if (s && !s.fehler) {
      hintergrund = s;
      if (s.stand !== letzterStand) {
        letzterStand = s.stand;
        await listeNeu();
        if (station) {
          const r = await rufe("station", station.station.id);
          if (!r.fehler) station = r;
          await ansichtLaden();
        }
      }
    }
    setTimeout(horchen, hintergrund.laeuft ? 700 : 3000);
  }

  onMount(async () => {
    handy = (await aufDemHandy()) || matchMedia("(max-width: 700px)").matches;
    const r = await sicher(() => rufe("start"));
    if (r.fehler) return;
    version = r.version;
    datenordner = r.datenordner ?? "";
    stationen = r.stationen;
    favoriten = Array.isArray(r.einstellungen.favoriten) ? r.einstellungen.favoriten : [];
    ansicht = ALLE.some(([k]) => k === r.einstellungen.ansicht) ? r.einstellungen.ansicht : "band";
    if (r.einstellungen.wellen) optionen.wellen = { ...optionen.wellen, ...r.einstellungen.wellen };
    if (r.einstellungen.vmodell) vmodell = r.einstellungen.vmodell;
    if (r.einstellungen.thema) thema = r.einstellungen.thema;
    if (NORMALE.includes(r.einstellungen.normal)) vergleich.von = r.einstellungen.normal;
    if (r.einstellungen.ort === "gps") ort = "gps";
    if (r.einstellungen.widget) widget = { ...widget, ...r.einstellungen.widget };
    rangModus = r.einstellungen.rang_modus === "jahr" ? "jahr" : "heute";
    rangPrognose = r.einstellungen.rang_prognose !== false;
    qn = "alle"; // so entschieden: immer mit allen Qualitätsstufen beginnen
    await stationLaden(r.einstellungen.station);
    horchen();
  });

  const jahreAuswahl = $derived(band?.jahre ?? []);
  const kopfStation = $derived(
    station ? { id: station.station.id, name: station.station.name, hoehe: station.station.hoehe } : null,
  );
  const weitere = $derived(!HANDY_NAV.includes(ansicht));
  const istFavorit = $derived(!!station && favoriten.includes(station.station.id));
</script>

<!-- Schalter der gerade gezeigten Ansicht: im Menüband wie auf dem Handy -->
{#snippet steuerung()}
  {#if (ansicht === "uebersicht" || ansicht === "vorhersage") && station}
    <div class="gruppe" title="Vorhersage und aktuelles Wetter für">
      <button class="chip" class:an={ort === "station"} onclick={() => ortSetzen("station")}>{station.station.name}</button>
      <button class="chip ort" class:an={ort === "gps"} onclick={() => ortSetzen("gps")}><Symbol name="standort" /> Mein Standort</button>
    </div>
  {/if}
  {#if ansicht === "band" && band && !band.leer}
    <div class="gruppe">
      {#each jahreAuswahl.slice(0, 2) as j}
        <button class="chip" class:an={band.jahr === j} onclick={() => setze("jahr", j)}>{j}</button>
      {/each}
      <select
        class="chip"
        class:an={jahreAuswahl.indexOf(band.jahr) > 1}
        value={jahreAuswahl.indexOf(band.jahr) > 1 ? band.jahr : ""}
        onchange={(e) => setze("jahr", Number(e.currentTarget.value))}
        title="Anderes Jahr"
      >
        <option value="" disabled>…</option>
        {#each jahreAuswahl.slice(2) as j}
          <option value={j}>{j}</option>
        {/each}
      </select>
    </div>
  {:else if ansicht === "monat" && monat && !monat.leer}
    {@const [j, m] = [monat.jahr, monat.monat]}
    {@const vor = m === 1 ? [j - 1, 12] : [j, m - 1]}
    {@const nach = m === 12 ? [j + 1, 1] : [j, m + 1]}
    {@const ab = monat.erster.slice(0, 7)}
    {@const bis = monat.letzter.slice(0, 7)}
    {@const schluessel = (x) => `${x[0]}-${String(x[1]).padStart(2, "0")}`}
    <div class="gruppe">
      <button class="chip" disabled={schluessel(vor) < ab} onclick={() => setze("monat", vor)} title="Monat davor">‹</button>
      <span class="chip an monat-name">{MONATE[m - 1]} {j}</span>
      <button class="chip" disabled={schluessel(nach) > bis} onclick={() => setze("monat", nach)} title="Monat danach">›</button>
    </div>
    <div class="gruppe">
      <select class="chip" value={j} onchange={(e) => setze("monat", [Number(e.currentTarget.value), m])} title="Jahr">
        {#each Array.from({ length: Number(bis.slice(0, 4)) - Number(ab.slice(0, 4)) + 1 }, (_, i) => Number(bis.slice(0, 4)) - i) as y}
          <option value={y}>{y}</option>
        {/each}
      </select>
      <button class="chip" onclick={() => setze("monat", null)} title="Zum letzten Monat mit Daten">aktuell</button>
    </div>
    {#if handy}<div class="gruppe" title="Vergleichszeitraum">{@render normalWahl()}</div>{/if}
  {:else if ansicht === "rang"}
    <div class="gruppe">
      <button class="chip" class:an={rangModus === "heute"} onclick={() => setze("rangModus", "heute")}>bis heute</button>
      <button class="chip" class:an={rangModus === "jahr"} onclick={() => setze("rangModus", "jahr")}>bis Jahresende</button>
    </div>
    {#if rangModus === "jahr"}
      <div class="gruppe">
        <button class="chip" class:an={rangPrognose} onclick={() => setze("rangPrognose", true)}>mit Prognose</button>
        <button class="chip" class:an={!rangPrognose} onclick={() => setze("rangPrognose", false)}>ohne</button>
      </div>
    {/if}
  {:else if ansicht === "rekorde"}
    <div class="gruppe">
      {#each [1, 3, 5, 10] as t}
        <button class="chip" class:an={optionen.rekorde.tiefe === t} disabled={auswertung && t > auswertung.erlaubt} onclick={() => setzeOption("tiefe", t)}>
          {t === 1 ? "Rekord" : `Top ${t}`}
        </button>
      {/each}
    </div>
  {:else if ansicht === "geschichte" && auswertung && !auswertung.leer}
    <div class="gruppe">
      <input class="chip datum" type="date" value={auswertung.datum} onchange={(e) => setzeOption("datum", e.currentTarget.value || null)} />
      <button class="chip" onclick={() => setzeOption("datum", null)}>letzter Tag</button>
    </div>
  {:else if ansicht === "wellen"}
    {@const w = optionen.wellen}
    <div class="gruppe">
      <button class="chip" class:an={w.art === "normal"} onclick={() => setzeOption("art", "normal")}>gegen Normal</button>
      <button class="chip" class:an={w.art === "fest"} onclick={() => setzeOption("art", "fest")}>≥ 30 / &lt; 0 °C, 3 Tage</button>
      <button class="chip" class:an={w.art === "eigen"} onclick={() => setzeOption("art", "eigen")}>eigene</button>
    </div>
    {#if w.art === "eigen"}
      <div class="gruppe eingaben">
        <label>Hitze ≥ <input type="number" step="0.5" value={w.heiss} onchange={(e) => setzeOption("heiss", Number(e.currentTarget.value))} /> °C</label>
        <label>Kälte &lt; <input type="number" step="0.5" value={w.kalt} onchange={(e) => setzeOption("kalt", Number(e.currentTarget.value))} /> °C</label>
        <label>ab <input type="number" min="1" max="30" value={w.min_tage} onchange={(e) => setzeOption("min_tage", Number(e.currentTarget.value))} /> Tagen</label>
      </div>
    {/if}
  {:else if (ansicht === "niederschlag" || ansicht === "sonne") && auswertung && !auswertung.leer}
    <div class="gruppe">
      <select class="chip an" value={auswertung.jahr} onchange={(e) => setzeOption("jahr", Number(e.currentTarget.value))} title="Jahr">
        {#each auswertung.jahre.map((z) => z.jahr).reverse() as y}<option value={y}>{y}</option>{/each}
      </select>
      <button class="chip" onclick={() => setzeOption("jahr", null)}>aktuell</button>
    </div>
  {:else if ansicht === "reihe"}
    <div class="gruppe">
      {#each [["m", "Mittel"], ["x", "Max"], ["n", "Min"]] as [k, t]}
        <button class="chip" class:an={groesse === k} onclick={() => setze("groesse", k)}>{t}</button>
      {/each}
    </div>
    <div class="gruppe">
      {#each [["tag", "Tag"], ["monat", "Monat"], ["jahr", "Jahr"]] as [k, t]}
        <button class="chip" class:an={aufloesung === k} onclick={() => setze("aufloesung", k)}>{t}</button>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet normalWahl()}
  <select
    class="chip"
    class:an={vergleich.von !== NORMALE[0]}
    value={vergleich.von}
    onchange={(e) => setze("normal", Number(e.currentTarget.value))}
    title="Vergleichszeitraum (Normal): immer 30 Jahre"
  >
    {#each NORMALE as n}<option value={n}>{normalText(n)}</option>{/each}
  </select>
{/snippet}

{#snippet qnSchalter()}
  <div class="gruppe" title="Qualitätsniveau des DWD: welche Tage zählen">
    {#each QN as [k, t]}
      <button class="chip" class:an={qn === k} onclick={() => setze("qn", k)}>{t}</button>
    {/each}
  </div>
{/snippet}

{#snippet bilanzText()}
  {#if band?.bilanz}
    {@const b = band.bilanz}
    Bereinigt: {tausend(b.grenze_weg)} Werte außerhalb der Grenzen · {tausend(b.max_unter_min)} Tage Max unter Min ·
    {tausend(b.mittel_ausserhalb)} Mittel außerhalb Min…Max · {tausend(b.spruenge)} Sprünge &gt; 15 K markiert
    {#if b.qn_weg}· {tausend(b.qn_weg)} von {tausend(b.tage)} Tagen durch QN-Filter ausgeblendet{/if}
  {/if}
{/snippet}

{#snippet inhalt()}
  {#if ortHinweis && (ansicht === "uebersicht" || ansicht === "vorhersage")}
    <div class="meldung">{ortHinweis}</div>
  {/if}
  {#if fehler}
    <div class="meldung fehler">
      <span>{fehler}</span>
      <button class="knopf" onclick={() => (fehler = "")}>OK</button>
    </div>
  {/if}
  {#if ansicht === "uebersicht" && station}
    <Uebersicht name={vorhersage?.station?.ort ? vorhersage.station.name : station.station.name} {band} {monat} geschichte={geschichteKurz} {vorhersage} rekorde={rekordeDe} gehe={(a) => setze("ansicht", a)} />
  {:else if ansicht === "top50"}
    <DeutschlandTop daten={deutschlandDaten} oeffnen={(id) => stationLaden(id).then((ok) => ok && setze("ansicht", "monat"))} neu={async () => { const r = await rufe("deutschland", true); if (!r.fehler) deutschlandDaten = r; }} />
  {:else if ansicht === "rekorde_de"}
    <RekordeDE daten={rekordeDe} oeffnen={stationOeffnen} neu={() => rekordeLaden(true)} rechnen={async () => { await rufe("rekorde_de_rechnen"); rekordeLaden(); }} />
  {:else if ansicht === "radar" && station}
    <Radar station={station.station} {stationen} {meinStandort} />
  {:else if ansicht === "vorhersage" && vorhersage}
    <Vorhersage v={vorhersage} modell={vmodell} waehle={(m) => ((vmodell = m), rufe("einstellung", "vmodell", m))} />
  {:else if ansicht === "band" && band && !band.leer}
    <Jahresband {band} name={station.station.name} />
  {:else if ansicht === "monat" && monat && !monat.leer}
    <Monat {monat} />
  {:else if ansicht === "rang" && liste}
    <Rangliste {liste} name={station.station.name} />
  {:else if IST_AUSWERTUNG.has(ansicht) && auswertung}
    <Auswertung art={ansicht} d={auswertung} name={station.station.name} optionen={optionen[ansicht] ?? {}} setze={setzeOption} />
  {:else if ansicht === "reihe" && reihe}
    <Zeitreihe {reihe} name={station.station.name} {groesse} {aufloesung} {handy} />
  {:else if band?.leer && !IST_AUSWERTUNG.has(ansicht)}
    <div class="mitte leise">Für diese Station gibt es keine Temperaturwerte.</div>
  {:else if !fehler}
    <div class="mitte leise">Lade …</div>
  {/if}
{/snippet}

{#snippet hilfeText()}
  <h3>Wetter {version}</h3>
  <p>Tageswerte der DWD-Klimastationen (opendata.dwd.de, daily/kl), historisch und recent. Historisch gewinnt; recent zählt erst nach dem letzten geprüften Tag.</p>
  <h4>Bereinigung</h4>
  <p>Rohwerte bleiben gespeichert, bereinigt wird beim Anzeigen:</p>
  <ul>
    <li>Temperatur außerhalb −45 … +50 °C: dieser Wert fällt weg.</li>
    <li>Höchstwert unter Tiefstwert: alle drei Temperaturen des Tages fallen weg.</li>
    <li>Mittel außerhalb Tiefst- bis Höchstwert: nur das Mittel fällt weg.</li>
    <li>Sprung über 15 K zum Vortag: wird markiert, nie entfernt.</li>
    <li>Wind 0–250 km/h (Mittel nicht über der Böe), Niederschlag 0–300 mm, Sonne 0–16,5 h, Schnee 0–800 cm, Bedeckung 0–8, Feuchte 0–100 %, Luftdruck 500–1100 hPa, Dampfdruck 0–125 hPa, Erdboden −50 … +50 °C.</li>
    <li>QN (Qualitätsniveau des DWD) umschaltbar: alle, ab 5, nur 10.</li>
  </ul>
  <h4>Prognose</h4>
  <p>Jahresmittel am 31.12. = bisher gemessen plus der Rest des Jahres, wie er in den letzten 30 Jahren war: 10 %, Median, 90 %.</p>
  {#if datenordner}<p class="leise">Daten: {datenordner}</p>{/if}
{/snippet}

{#if handy}
  <!-- ================================================================ Handy -->
  <div class="handy">
    <header class="h-kopf">
      <img class="logo" src={symbol} alt="" />
      <Stationswahl bind:this={wahl} {stationen} {favoriten} aktuell={kopfStation} wahl={(id) => stationLaden(id)} vollbild />
      <button class="h-knopf" onclick={aktualisieren} disabled={!!laedt || !station} title="Aktualisieren"><Symbol name="aktualisieren" /></button>
    </header>
    <div class="h-steuer">{@render steuerung()}</div>
    <main class="h-inhalt">{@render inhalt()}</main>
    {#if hintergrund.laeuft}<div class="h-laeuft">{hintergrund.laeuft}</div>{/if}
    <nav class="h-nav">
      {#each HANDY_NAV as k}
        {@const h = HAUPT.find((x) => x[0] === k)}
        <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><span><Symbol name={h[3]} /></span>{h[2]}</button>
      {/each}
      <button class:an={mehr || weitere} onclick={() => (mehr = !mehr)}>
        <span><Symbol name={weitere ? ([...HAUPT, ...DEUTSCHLAND].find((a) => a[0] === ansicht)?.[3] ?? ansicht) : "mehr"} /></span>{weitere ? ([...AUSWERTUNGEN, ...DEUTSCHLAND].find((a) => a[0] === ansicht)?.[4] ?? HAUPT.find((a) => a[0] === ansicht)?.[2]) : "Mehr"}
      </button>
    </nav>
    {#if mehr}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="h-schleier" onclick={() => (mehr = false)}></div>
      <div class="h-blatt">
        <div class="lbl">Ansichten</div>
        <div class="h-raster">
          {#each HAUPT.filter(([k]) => !HANDY_NAV.includes(k)) as [k, t, , s]}
            <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><span><Symbol name={s} /></span>{t}</button>
          {/each}
        </div>
        <div class="lbl">Auswertungen</div>
        <div class="h-raster">
          {#each AUSWERTUNGEN as [k, t, , s]}
            <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><span><Symbol name={s} /></span>{t}</button>
          {/each}
        </div>
        <div class="lbl">Deutschland</div>
        <div class="h-raster">
          {#each DEUTSCHLAND as [k, t, , s]}
            <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><span><Symbol name={s} /></span>{t}</button>
          {/each}
        </div>
        <div class="lbl">Qualitätsniveau (QN)</div>
        {@render qnSchalter()}
        <div class="lbl">Vergleichszeitraum (Normal)</div>
        <div class="gruppe">{@render normalWahl()}</div>
        {#if nativ()}
          <div class="lbl">Widget und Meldungen</div>
          <div class="widget-wahl">
            <div class="gruppe">
              <button class="chip" class:an={widget.ort === "station"} onclick={() => widgetSetze("ort", "station")}>{station?.station.name ?? "Station"}</button>
              <button class="chip" class:an={widget.ort === "gps"} onclick={() => widgetSetze("ort", "gps")}><Symbol name="standort" /> Mein Standort</button>
            </div>
            <select class="chip" value={widget.modell} onchange={(e) => widgetSetze("modell", e.currentTarget.value)} title="Modell im Widget">
              {#each MODELLE as [k, t]}<option value={k}>{t}</option>{/each}
            </select>
            <label class="haken"><input type="checkbox" checked={widget.unwetter} onchange={(e) => widgetSetze("unwetter", e.currentTarget.checked)} /> Unwetter melden (Böen ab 75 km/h, Starkregen ab 15 mm/h, Gewitter – nächste 24 h)</label>
            <label class="haken"><input type="checkbox" checked={widget.rekorde} onchange={(e) => widgetSetze("rekorde", e.currentTarget.checked)} /> Rekorde der Favoriten melden (Rekord, Top 3, Kalendertag – einmal am Tag mittags)</label>
            {#if !widgetInfo.erlaubt && (widget.unwetter || widget.rekorde)}
              <button class="knopf" onclick={async () => (widgetInfo = { ...widgetInfo, ...(await meldungenErlauben()) })}>Meldungen erlauben</button>
            {/if}
            <button class="knopf" onclick={() => (widgetAbgleichen(), widgetJetzt())}>Widget jetzt aktualisieren</button>
            {#if widgetInfo.fehler}<div class="leise">Letzter Fehler: {widgetInfo.fehler}</div>{/if}
            <div class="leise">Widget hinzufügen: lange auf den Startbildschirm drücken → Widgets → Wetter. {widget.ort === "gps" ? (widget.gps ? "Ort: zuletzt bestimmter Standort der App." : "Noch kein Standort bestimmt – einmal „Mein Standort“ antippen.") : ""}</div>
          </div>
        {/if}
        <div class="lbl">Farben</div>
        <div class="gruppe">
          {#each THEMEN as [t, t2]}
            <button class="chip" class:an={thema === t} onclick={() => themaSetzen(t)}>{t2}</button>
          {/each}
        </div>
        <button class="knopf" onclick={favoritUmschalten} disabled={!station}><Symbol name={istFavorit ? "favorit_an" : "favorit"} /> {istFavorit ? "Favorit entfernen" : "Als Favorit merken"}</button>
        {#if station?.zeitraum?.bis}<div class="leise">Stand {datum(station.zeitraum.bis)} · {tausend(station.zeitraum.tage)} Tage</div>{/if}
        <div class="leise">{@render bilanzText()}</div>
        {#if hintergrund.meldung}<div class="leise">{hintergrund.meldung}</div>{/if}
        <details>
          <summary>Hilfe und Regeln</summary>
          <div class="hilfe-text">{@render hilfeText()}</div>
        </details>
        <div class="leise">Daten: Deutscher Wetterdienst · {version}</div>
      </div>
    {/if}
  </div>
{:else}
  <!-- =================================================== PC: Layout D Menüband -->
  <div class="seite">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    {#if menue}<div class="menue-schleier" onclick={() => (menue = "")}></div>{/if}
    <div class="menueleiste">
      <img class="logo-klein" src={symbol} alt="" />
      {#each [["datei", "Datei"], ["station", "Station"], ["ansicht", "Ansicht"], ["daten", "Daten"], ["hilfe", "Hilfe"]] as [k, t]}
        <div class="menue">
          <button class:offen={menue === k} onclick={() => (menue = menue === k ? "" : k)}>{t}</button>
          {#if menue === k}
            <div class="aufklapp">
              {#if k === "datei"}
                {#if datenordner}<button onclick={() => ((menue = ""), rufe("ordner_oeffnen"))}>Datenordner öffnen</button>{/if}
                <div class="eintrag-leise">{datenordner || "Daten im Programm"}</div>
              {:else if k === "station"}
                <button onclick={() => ((menue = ""), wahl?.oeffnen())}>Station wählen …</button>
                <button onclick={() => ((menue = ""), wahl?.oeffnen(), wahl?.inDerNaeheWaehlen())}>Station in meiner Nähe</button>
                <button onclick={favoritUmschalten} disabled={!station}>{istFavorit ? "Favorit entfernen" : "Als Favorit merken"}</button>
                {#each favoriten as f}
                  {@const s = stationen.find((x) => x[0] === f)}
                  {#if s}<button onclick={() => ((menue = ""), stationLaden(f))}><Symbol name="favorit_an" /> {s[1]}</button>{/if}
                {/each}
              {:else if k === "ansicht"}
                {#each ANSICHTEN as [a, t2]}
                  <button class:an={ansicht === a} onclick={() => setze("ansicht", a)}>{t2}</button>
                {/each}
                <div class="eintrag-leise">Auswertungen</div>
                {#each AUSWERTUNGEN as [a, t2]}
                  <button class:an={ansicht === a} onclick={() => setze("ansicht", a)}>{t2}</button>
                {/each}
                <div class="eintrag-leise">Deutschland</div>
                {#each DEUTSCHLAND as [a, t2]}
                  <button class:an={ansicht === a} onclick={() => setze("ansicht", a)}>{t2}</button>
                {/each}
                <div class="eintrag-leise">Farben</div>
                {#each THEMEN as [t, t2]}
                  <button class:an={thema === t} onclick={() => themaSetzen(t)}>{t2}</button>
                {/each}
              {:else if k === "daten"}
                <button onclick={aktualisieren} disabled={!!laedt || !station}>Aktualisieren</button>
                {#each QN as [q, t2]}
                  <button class:an={qn === q} onclick={() => setze("qn", q)}>QN {t2}</button>
                {/each}
                <div class="eintrag-leise">Vergleichszeitraum</div>
                {#each NORMALE as n}
                  <button class:an={vergleich.von === n} onclick={() => setze("normal", n)}>Normal {normalText(n)}</button>
                {/each}
              {:else}
                <button onclick={() => ((menue = ""), (hilfe = true))}>Regeln und Daten …</button>
                <div class="eintrag-leise">Wetter {version}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
      <span class="raum"></span>
      {#if hintergrund.laeuft}<span class="laeuft">{hintergrund.laeuft}</span>{/if}
      {#if station}
        <span class="num stand">{station.station.name} · Stand {datum(station.zeitraum?.bis)}</span>
      {/if}
    </div>

    <div class="band">
      <div class="b-gruppe">
        <div class="b-inhalt">
          <Stationswahl bind:this={wahl} {stationen} {favoriten} aktuell={kopfStation} wahl={(id) => stationLaden(id)} />
          <button class="b-knopf" class:an={istFavorit} onclick={favoritUmschalten} disabled={!station} title="Favorit">
            <span><Symbol name={istFavorit ? "favorit_an" : "favorit"} /></span>Favorit
          </button>
        </div>
        <div class="b-titel">Station</div>
      </div>
      <div class="b-gruppe">
        <div class="b-inhalt">
          {#each ANSICHTEN as [k, t, s, kurz]}
            <button class="b-knopf" class:an={ansicht === k} onclick={() => setze("ansicht", k)} title={t}><span><Symbol name={s} /></span><i class="lang">{t}</i><i class="kurz">{kurz}</i></button>
          {/each}
        </div>
        <div class="b-titel">Ansicht</div>
      </div>
      <div class="b-gruppe">
        <div class="b-inhalt">
          <button class="b-knopf" class:an={!!aktiveAuswertung} onclick={auswertungenAuf} title="Auswertung wählen">
            <span><Symbol name={aktiveAuswertung?.[3] ?? "rekorde"} /></span>{aktiveAuswertung?.[4] ?? "Auswertungen"} ▾
          </button>
        </div>
        <div class="b-titel">Auswertung</div>
      </div>
      <div class="b-gruppe">
        <div class="b-inhalt b-stapel">{@render steuerung()}</div>
        <div class="b-titel">{ansicht === "monat" ? "Zeitraum" : ansicht === "band" ? "Jahr" : ansicht === "rang" ? "Vergleich" : ansicht === "reihe" ? "Größe" : "Optionen"}</div>
      </div>
      <div class="b-gruppe">
        <div class="b-inhalt b-stapel">{@render qnSchalter()}{@render normalWahl()}</div>
        <div class="b-titel">QN · Normal</div>
      </div>
      <div class="b-gruppe">
        <div class="b-inhalt">
          <button class="b-knopf" onclick={aktualisieren} disabled={!!laedt || !station}><span><Symbol name="aktualisieren" /></span>Aktualisieren</button>
        </div>
        <div class="b-titel">Daten</div>
      </div>
    </div>

    {#if menue === "auswertungen"}
      <div class="aufklapp ausw-liste" style:left="{auswPos.x}px" style:top="{auswPos.y}px">
        {#each AUSWERTUNGEN as [k, t, , s]}
          <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><Symbol name={s} /> {t}</button>
        {/each}
        <div class="eintrag-leise">Deutschland</div>
        {#each DEUTSCHLAND as [k, t, , s]}
          <button class:an={ansicht === k} onclick={() => setze("ansicht", k)}><Symbol name={s} /> {t}</button>
        {/each}
      </div>
    {/if}

    <main>{@render inhalt()}</main>

    <footer class="leise">
      <span class="bilanz" title="Rohwerte bleiben gespeichert; bereinigt wird beim Anzeigen">{@render bilanzText()}</span>
      <span class="raum"></span>
      {#if hintergrund.meldung && !hintergrund.laeuft}<span>{hintergrund.meldung}</span>{/if}
      <span>Daten: Deutscher Wetterdienst · {version}</span>
    </footer>

    {#if hilfe}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="schleier" onclick={() => (hilfe = false)}>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="karte dialog" onclick={(e) => e.stopPropagation()}>
          {@render hilfeText()}
          <button class="knopf primaer" onclick={() => (hilfe = false)}>Schließen</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if laedt}
  <div class="schleier"><div class="karte hinweis">{laedt}</div></div>
{/if}

<style>
  /* ------------------------------------------------------------------ PC */
  .seite {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
  }
  .menueleiste {
    --symbol-akzent: var(--graphit-akzent);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 12px;
    background: var(--graphit);
    color: var(--graphit-text);
    font-size: 13px;
    position: relative;
    z-index: 30;
  }
  .logo-klein {
    width: 20px;
    height: 20px;
    margin-right: 8px;
  }
  .menue {
    position: relative;
  }
  .menue > button {
    background: none;
    border: 0;
    color: inherit;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .menue > button:hover,
  .menue > button.offen {
    background: var(--graphit-2);
    color: var(--graphit-akzent);
  }
  .aufklapp {
    position: absolute;
    top: 30px;
    left: 0;
    min-width: 220px;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--rand);
    border-radius: 8px;
    box-shadow: var(--schatten-hoch);
    padding: 4px;
    display: grid;
  }
  .ausw-liste {
    position: fixed;
    z-index: 30;
    --symbol-akzent: var(--akzent);
  }
  .ausw-liste button {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .aufklapp button {
    text-align: left;
    background: none;
    border: 0;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .aufklapp button:hover:not(:disabled) {
    background: var(--akzent-zart);
  }
  .aufklapp button.an {
    color: var(--akzent);
    font-weight: 600;
  }
  .aufklapp button:disabled {
    opacity: 0.4;
  }
  .eintrag-leise {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-3);
    border-top: 1px solid var(--rand);
    margin-top: 4px;
    white-space: nowrap;
  }
  .menue-schleier {
    position: fixed;
    inset: 0;
    z-index: 25;
  }
  .stand {
    font-size: 12px;
    color: var(--graphit-leise);
    margin-left: 12px;
  }
  .laeuft {
    color: var(--graphit-akzent);
    font-size: 12px;
  }

  .band {
    --symbol-akzent: var(--graphit-akzent);
    display: flex;
    align-items: stretch;
    padding: 6px 6px 4px;
    background: var(--graphit-2);
    color: var(--graphit-text);
    border-bottom: 1px solid #111317;
    white-space: nowrap;
    overflow-x: auto;
  }
  .b-gruppe {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 0 9px;
    border-right: 1px solid rgb(255 255 255 / 10%);
  }
  .b-inhalt {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .b-titel {
    font-size: 11px;
    color: var(--graphit-leise);
  }
  .b-knopf {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 4px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--graphit-text);
    font-size: 12px;
    cursor: pointer;
  }
  .b-knopf span {
    display: flex;
    font-size: 17px;
    line-height: 1.1;
  }
  .b-knopf:hover:not(:disabled) {
    background: rgb(255 255 255 / 8%);
  }
  .b-knopf.an {
    background: var(--akzent-hell);
    color: var(--akzent);
    font-weight: 600;
  }
  .b-knopf:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .b-raster {
    display: grid;
    grid-template-columns: repeat(6, auto);
    gap: 1px 2px;
  }
  .b-klein {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--graphit-text);
    font-size: 12px;
    cursor: pointer;
  }
  .b-knopf i {
    font-style: normal;
  }
  .b-knopf .kurz {
    display: none;
  }
  /* bis 1.600 px: Ansichten mit Kurznamen */
  @media (max-width: 1600px) {
    .b-knopf .lang {
      display: none;
    }
    .b-knopf .kurz {
      display: inline;
    }
  }
  /* schmalere Bildschirme: Station ohne Nummer und Höhe, Knöpfe enger */
  @media (max-width: 1400px) {
    .band :global(.wahl small) {
      display: none;
    }
    .b-gruppe {
      padding: 0 6px;
    }
    .b-knopf {
      padding: 4px 4px;
    }
  }
  .b-stapel {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 4px;
  }
  .b-stapel > :global(.gruppe) {
    justify-content: center;
  }
  .b-stapel select {
    font-size: 12px;
  }
  .b-klein span {
    display: flex;
    width: 16px;
    justify-content: center;
  }
  .b-klein:hover {
    background: rgb(255 255 255 / 8%);
  }
  .b-klein.an {
    background: var(--akzent-hell);
    color: var(--akzent);
    font-weight: 600;
  }
  .eingaben label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 0 6px;
  }
  .eingaben input {
    width: 52px;
    border: 1px solid var(--rand-stark);
    border-radius: 6px;
    padding: 2px 4px;
    background: var(--flaeche);
    color: var(--text);
  }
  input.datum {
    color: inherit;
  }
  /* Schalter im dunklen Band */
  .band :global(.gruppe) {
    background: transparent;
    border-color: rgb(255 255 255 / 18%);
  }
  .band :global(.chip:not(.an)) {
    background: transparent;
    color: var(--graphit-text);
  }

  main {
    padding: 14px 16px 6px;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
  footer {
    display: flex;
    gap: 14px;
    padding: 4px 16px 8px;
    white-space: nowrap;
    overflow: hidden;
  }
  .bilanz {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dialog {
    max-width: 640px;
    max-height: 80vh;
    overflow: auto;
    padding: 18px 22px;
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .dialog :global(h3),
  .hilfe-text :global(h3) {
    margin: 0;
  }
  .dialog :global(h4),
  .hilfe-text :global(h4) {
    margin: 8px 0 0;
  }
  .dialog :global(p),
  .dialog :global(ul),
  .hilfe-text :global(p),
  .hilfe-text :global(ul) {
    margin: 2px 0;
    font-size: 13px;
    color: var(--text-2);
  }

  /* ---------------------------------------------------------------- Handy */
  /* Spalte statt Raster: fehlt die Schalterzeile, rutscht sonst die
     Navigation in die dehnbare Zeile und wird riesig */
  .handy {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .handy > * {
    flex: none;
  }
  .handy > .h-inhalt {
    flex: 1;
    min-height: 0;
  }
  .h-kopf {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: calc(8px + env(safe-area-inset-top)) 10px 8px;
    background: var(--graphit);
    color: var(--graphit-text);
  }
  .h-kopf :global(.wahl-rahmen) {
    flex: 1;
    min-width: 0;
  }
  .h-kopf .logo {
    width: 28px;
    height: 28px;
  }
  .h-knopf {
    width: 38px;
    height: 34px;
    border: 0;
    border-radius: 8px;
    background: var(--akzent);
    color: #fff;
    font-size: 17px;
    --symbol-akzent: #fff;
  }
  .h-knopf:disabled {
    opacity: 0.5;
  }
  .h-steuer {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    overflow-x: auto;
    background: var(--graphit-2);
    white-space: nowrap;
  }
  .h-steuer:empty {
    display: none;
  }
  .h-steuer :global(.gruppe) {
    background: transparent;
    border-color: rgb(255 255 255 / 18%);
    flex: none;
  }
  .h-steuer :global(.chip:not(.an)) {
    background: transparent;
    color: var(--graphit-text);
  }
  .h-inhalt {
    overflow: auto;
    padding: 10px;
    -webkit-overflow-scrolling: touch;
  }
  .h-laeuft {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--akzent);
    background: var(--akzent-zart);
  }
  .h-nav {
    --symbol-akzent: var(--graphit-akzent);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: var(--graphit);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .h-nav button {
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 6px 0 8px;
    border: 0;
    background: none;
    color: var(--graphit-leise);
    font-size: 11px;
  }
  .h-nav button span {
    display: flex;
    font-size: 18px;
    line-height: 1.2;
  }
  .h-nav button.an {
    color: var(--graphit-akzent);
    font-weight: 600;
  }
  .h-schleier {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 30%);
    z-index: 15;
  }
  .h-blatt {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 16;
    max-height: 80vh;
    overflow: auto;
    background: var(--flaeche);
    border-radius: 14px 14px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .h-blatt > * {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .h-raster {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    width: 100%;
  }
  .h-raster button {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 8px 4px;
    border: 1px solid var(--rand);
    border-radius: 10px;
    background: var(--flaeche-2);
    font-size: 11px;
    text-align: center;
  }
  .h-raster button span {
    display: flex;
    font-size: 20px;
  }
  .h-raster button.an {
    border-color: var(--akzent);
    color: var(--akzent);
    font-weight: 600;
  }
  details summary {
    cursor: pointer;
    color: var(--akzent);
  }

  /* ------------------------------------------------------------ gemeinsam */
  .logo {
    width: 30px;
    height: 30px;
  }
  .raum {
    flex: 1;
  }
  :global(.chip:disabled) {
    opacity: 0.35;
    cursor: default;
  }
  .monat-name {
    min-width: 76px;
    text-align: center;
    cursor: default;
  }
  select.chip {
    appearance: none;
    padding-right: 11px;
  }
  .mitte {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 14px;
  }
  .widget-wahl {
    display: grid;
    gap: 8px;
    justify-items: start;
  }
  .haken {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 14px;
  }
  .haken input {
    margin-top: 3px;
    accent-color: var(--akzent);
  }
  .meldung {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 12px;
    border-radius: 8px;
  }
  .meldung.fehler {
    background: var(--rot-hell);
    color: var(--rot-dunkel);
  }
  .schleier {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    display: grid;
    place-items: center;
    z-index: 40;
  }
  .hinweis {
    padding: 16px 22px;
    font-size: 15px;
  }
</style>
