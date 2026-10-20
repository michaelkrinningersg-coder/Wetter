<script>
  // Die Auswertungen über die ganze Reihe einer Station - eine Ansicht je
  // `art`. Die Zahlen kommen fertig aus auswertung.py bzw. lokal/auswertung.js.
  import { normalText } from "./zeitraum.svelte.js";
  import Balken from "./Balken.svelte";
  import Tabelle from "./Tabelle.svelte";
  import { TITEL } from "./ansichten.js";
  import { MONATE, MONATSANFANG, abweichungsfarbe, datum, de, mitVorzeichen, schritte, tagText } from "./format.js";

  let { art, d, name, optionen, setze } = $props();


  const tm = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "–");
  const kurz = (iso) => (iso ? datum(iso) : "–");

  // ------------------------------------------------ Kurve über das Jahr (SVG)
  let kb = $state(700);
  const KH = 300;
  const kr = { l: 44, r: 10, o: 10, u: 22 };
  function kurve(linien, band, xMax, einheit) {
    // linien: [[[x, y], ...], farbe, gestrichelt]; band: [[x, lo, hi]]
    let lo = Infinity, hi = -Infinity;
    for (const [pts] of linien) for (const [, y] of pts) if (y != null) ((lo = Math.min(lo, y)), (hi = Math.max(hi, y)));
    for (const [, a, b] of band) if (a != null) ((lo = Math.min(lo, a)), (hi = Math.max(hi, b)));
    if (!Number.isFinite(lo)) ((lo = 0), (hi = 1));
    const pad = (hi - lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
    const xs = (x) => kr.l + (x / xMax) * (kb - kr.l - kr.r);
    const ys = (y) => kr.o + (1 - (y - lo) / (hi - lo)) * (KH - kr.o - kr.u);
    const pfad = (pts) => pts.filter(([, y]) => y != null).map(([x, y], i) => `${i ? "L" : "M"}${xs(x).toFixed(1)},${ys(y).toFixed(1)}`).join("");
    const b = band.filter(([, a]) => a != null);
    const flaeche = b.length ? b.map(([x, a], i) => `${i ? "L" : "M"}${xs(x).toFixed(1)},${ys(a).toFixed(1)}`).join("") + b.slice().reverse().map(([x, , c]) => `L${xs(x).toFixed(1)},${ys(c).toFixed(1)}`).join("") + "Z" : "";
    return { xs, ys, pfad, flaeche, gitter: schritte(lo, hi, 5), einheit };
  }

  // ------------------------------------------------------------- Rekorde
  const tiefe = $derived(Math.min(optionen.tiefe ?? 1, d?.erlaubt ?? 10));

  // ------------------------------------------------------------ Kenntage
  const kenn = $derived(optionen.kenntag ?? "heiss");

  // --------------------------------------------------------- Summenkurve
  const summeKurve = $derived.by(() => {
    if (!(art === "niederschlag" || art === "sonne") || !d?.band) return null;
    return kurve(
      [[d.kumuliert, "var(--akzent)", false], [d.band.map(([k, , m]) => [k, m]), "var(--text-2)", true]],
      d.band.map(([k, a, , c]) => [k, a, c]),
      365,
      art === "niederschlag" ? "mm" : "h",
    );
  });

  // ------------------------------------------------------ Prognose-Verlauf
  const verlaufKurve = $derived.by(() => {
    if (art !== "verlauf" || !d?.verlauf) return null;
    const x = (iso) => (Date.parse(iso) - Date.UTC(d.jahr, 0, 1)) / 86400000;
    return {
      ...kurve(
        [[d.verlauf.map((v) => [x(v[0]), v[2]]), "var(--akzent)", false]],
        d.verlauf.map((v) => [x(v[0]), v[1], v[3]]),
        365,
        "°C",
      ),
      x,
    };
  });

  const letzterVerlauf = $derived(d?.verlauf?.at(-1));
</script>

<div class="auswertung">
  <div class="kopf">
    <b>{name}: {TITEL[art]}</b>
    {#if art === "rekorde"}
      <span class="leise">Reihe {de(d.jahre)} Jahre – gezeigt werden bis Platz {d.erlaubt} (unter 10 Jahren nur Platz 1, unter 20 bis 3, unter 50 bis 5)</span>
    {:else if art === "geschichte"}
      <span class="leise">{datum(d.datum)} in allen Jahren der Reihe · Platz 1 = am wärmsten</span>
    {:else if art === "kenntage"}
      <span class="leise">Sommertag ≥ 25 °C · heißer Tag ≥ 30 °C · Tropennacht Tiefstwert ≥ 20 °C · Frosttag Tiefstwert &lt; 0 °C · Eistag Höchstwert &lt; 0 °C · Bodenfrost 5 cm &lt; 0 °C</span>
    {:else if art === "wellen"}
      <span class="leise">
        {#if d.art === "normal"}mind. 5 Tage Tagesmittel über dem 90-%- bzw. unter dem 10-%-Wert des Normals {normalText()}
        {:else}mind. {d.min_tage} Tage Höchstwert ≥ {de(d.heiss)} °C bzw. &lt; {de(d.kalt)} °C{/if}
      </span>
    {:else if art === "streifen"}
      <span class="leise">Jahresmittel gegen das Mittel {normalText()} ({de(d.bezug, 2)} °C) · nur Jahre mit mind. 330 Tagen</span>
    {:else if art === "niederschlag" || art === "sonne"}
      <span class="leise">{d.jahr} aufsummiert (orange) gegen {normalText()}: Median gestrichelt, grau 10–90 %</span>
    {:else if art === "schnee"}
      <span class="leise">Winter 1. Okt. – 30. Apr. · Schneetag ≥ 1 cm Schneehöhe</span>
    {:else if art === "wind"}
      <span class="leise">Sturmtag: Böe ≥ 75 km/h · Orkanböe ≥ 118 km/h</span>
    {:else if art === "frost"}
      <span class="leise">Luft: Tiefstwert 2 m &lt; 0 °C · Boden: 5 cm &lt; 0 °C · letzter Frost vor, erster ab dem 1. Juli</span>
    {:else if art === "verlauf"}
      <span class="leise">Was die Prognose fürs Jahresende an jedem Tag gesagt hätte – Linie Median, grau 10–90 %</span>
    {/if}
  </div>

  <div class="inhalt">
    {#if d.leer}
      <div class="leise">Für diese Auswertung gibt es keine Werte{art === "verlauf" ? " – nur für das laufende Jahr" : ""}.</div>

    <!-- ============================================================ Rekorde -->
    {:else if art === "rekorde"}
      <div class="kacheln">
        {#each d.groessen as g}
          <div class="karte kachel">
            <div class="lbl">{g.titel}</div>
            {#each g.liste.filter((z) => z[0] <= tiefe) as [platz, wert, tag], i}
              <div class="zeile" class:erster={platz === 1}>
                <span class="platz num">{platz}.</span>
                <span class="num wert">{de(wert)} {g.einheit}</span>
                <span class="num leise">{kurz(tag)}</span>
              </div>
            {:else}
              <div class="leise">keine Werte</div>
            {/each}
          </div>
        {/each}
      </div>

    <!-- ========================================================= Geschichte -->
    {:else if art === "geschichte"}
      <div class="kacheln drei">
        {#each d.groessen as g}
          <div class="karte kachel">
            <div class="lbl">{g.titel} am {tm(d.datum)}</div>
            <div class="gross num">{de(g.wert)} °C</div>
            {#if g.wert != null}
              <div>Platz <b>{g.platz_warm}</b> von {g.von} (wärmste) · normal {de(g.normal)} °C</div>
            {/if}
            <div class="zwei">
              <div>
                <div class="leise">am wärmsten</div>
                {#each g.warm as [w, j]}<div class="num">{de(w)} °C <span class="leise">{j}</span></div>{/each}
              </div>
              <div>
                <div class="leise">am kältesten</div>
                {#each g.kalt as [w, j]}<div class="num">{de(w)} °C <span class="leise">{j}</span></div>{/each}
              </div>
            </div>
          </div>
        {/each}
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="420px"
          start="jahr"
          spalten={[
            { key: "j", titel: "Jahr", wert: (z) => z[0] },
            { key: "m", titel: "Mittel", einheit: "°C", wert: (z) => z[1], text: (z) => de(z[1]) },
            { key: "x", titel: "Max", einheit: "°C", wert: (z) => z[2], text: (z) => de(z[2]) },
            { key: "n", titel: "Min", einheit: "°C", wert: (z) => z[3], text: (z) => de(z[3]) },
          ]}
          zeilen={d.jahre}
          markiert={(z) => String(z[0]) === d.datum.slice(0, 4)}
        />
      </div>

    <!-- =========================================================== Kenntage -->
    {:else if art === "kenntage"}
      <div class="karte breit">
        <div class="gruppe">
          {#each d.arten as [k, t]}
            <button class="chip" class:an={kenn === k} onclick={() => setze("kenntag", k)}>{t}</button>
          {/each}
        </div>
        {#key kenn}
          <Balken
            punkte={d.jahre.map((z) => [z.jahr, z[kenn], (kenn === "bodenfrost" ? z.tage_g : kenn === "tropen" || kenn === "frost" ? z.tage_n : z.tage_x) < d.min_tage])}
            normal={d.normal[kenn]}
            farbe={["frost", "eis", "bodenfrost"].includes(kenn) ? "var(--blau)" : "var(--rot)"}
            einheit="Tage"
          />
        {/key}
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="360px"
          start="jahr"
          spalten={[{ key: "jahr", titel: "Jahr" }, ...d.arten.map(([k, t]) => ({ key: k, titel: t }))]}
          zeilen={d.jahre.map((z) => ({ ...z, _blass: z.tage_x < d.min_tage && z.tage_n < d.min_tage }))}
        />
        <div class="leise">Mittel {normalText()}: {d.arten.map(([k, t]) => `${t} ${de(d.normal[k])}`).join(" · ")}</div>
      </div>

    <!-- ============================================================= Wellen -->
    {:else if art === "wellen"}
      <div class="karte breit">
        <Balken punkte={d.jahre.map((z) => [z.jahr, z.hitze_tage])} farbe="var(--rot)" einheit="Hitzewellen-Tage" hoehe={160} />
        <Balken punkte={d.jahre.map((z) => [z.jahr, z.kaelte_tage])} farbe="var(--blau)" einheit="Kältewellen-Tage" hoehe={160} />
      </div>
      <div class="kacheln zwei-spalten">
        {#each [["hitze", "Längste Hitzewellen", "höchster"], ["kaelte", "Längste Kältewellen", "tiefster"]] as [typ, titel, ext]}
          <div class="karte kachel">
            <div class="lbl">{titel}</div>
            <Tabelle
              start="tage"
              spalten={[
                { key: "von", titel: "von", links: true, text: (w) => kurz(w.von) },
                { key: "bis", titel: "bis", links: true, text: (w) => kurz(w.bis) },
                { key: "tage", titel: "Tage" },
                { key: "extrem", titel: ext, einheit: "°C", text: (w) => de(w.extrem) },
                { key: "mittel", titel: "Mittel", einheit: "°C", text: (w) => de(w.mittel) },
              ]}
              zeilen={d[typ]}
            />
          </div>
        {/each}
      </div>

    <!-- ====================================================== Klimastreifen -->
    {:else if art === "streifen"}
      {@const n = d.jahre.length}
      <div class="karte breit streifen">
        <svg viewBox="0 0 {n} 100" preserveAspectRatio="none" class="streifen-svg">
          {#each d.jahre as [j, m, a], i}
            <rect x={i} y="0" width="1.05" height="100" fill={abweichungsfarbe(a ?? 0, 2.2)}><title>{j}: {de(m, 2)} °C ({mitVorzeichen(a, 2)} K)</title></rect>
          {/each}
        </svg>
        <div class="achse num leise">
          <span>{d.jahre[0]?.[0]}</span>
          <span>{d.jahre[Math.floor(n / 2)]?.[0]}</span>
          <span>{d.jahre[n - 1]?.[0]}</span>
        </div>
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="320px"
          start="a"
          spalten={[
            { key: "j", titel: "Jahr", wert: (z) => z[0] },
            { key: "m", titel: "Mittel", einheit: "°C", wert: (z) => z[1], text: (z) => de(z[1], 2) },
            { key: "a", titel: "Abweichung", einheit: "K", wert: (z) => z[2], text: (z) => mitVorzeichen(z[2], 2), farbe: (z) => (z[2] > 0 ? "var(--rot)" : "var(--blau)") },
          ]}
          zeilen={d.jahre}
        />
      </div>

    <!-- ================================================= Niederschlag, Sonne -->
    {:else if art === "niederschlag" || art === "sonne"}
      {@const K = summeKurve}
      {@const einheit = art === "niederschlag" ? "mm" : "h"}
      <div class="raster">
        <div class="karte breit" bind:clientWidth={kb}>
          <svg width={kb - 2} height={KH} class="kurve">
            {#each K.gitter as v}
              <line x1={kr.l} x2={kb - kr.r} y1={K.ys(v)} y2={K.ys(v)} class="gitter" />
              <text x={kr.l - 5} y={K.ys(v) + 4} text-anchor="end">{v}</text>
            {/each}
            {#each MONATSANFANG as a, m}<text x={K.xs(a + 15)} y={KH - 6} text-anchor="middle">{MONATE[m]}</text>{/each}
            <path d={K.flaeche} class="band" />
            <path d={K.pfad(d.band.map(([k, , m]) => [k, m]))} class="median" />
            <path d={K.pfad(d.kumuliert)} class="eigen" />
          </svg>
        </div>
        <div class="karte kachel">
          <div class="lbl">{d.jahr} bis {datum(d.letzter)}</div>
          <div class="gross num">{de(d.kumuliert.at(-1)?.[1])} {einheit}</div>
          {#if d.kumuliert.length}
            {@const k = d.kumuliert.at(-1)[0]}
            <div>normal bis {tagText(k)}: {de(d.band[k][2])} {einheit} (Median)</div>
          {/if}
          <div class="leise">Jahressumme normal {normalText()}: {de(d.normal)} {einheit}</div>
          <table class="klein">
            <tbody>
              {#each d.monate as mo}
                {@const a = mo.normal != null ? mo.summe - mo.normal : null}
                <tr>
                  <td class="l">{MONATE[mo.mo - 1]}</td>
                  <td class="num">{de(mo.summe)}</td>
                  <td class="num leise">{de(mo.normal)}</td>
                  <td class="num" style:color={a > 0 ? (art === "niederschlag" ? "var(--blau)" : "var(--akzent)") : "var(--text-2)"}>{mitVorzeichen(a)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="340px"
          start="summe"
          spalten={[
            { key: "platz", titel: "Platz", wert: (z) => z.platz ?? null, absteigend: false },
            { key: "jahr", titel: "Jahr" },
            { key: "summe", titel: "Summe", einheit, text: (z) => de(z.summe) },
            ...(art === "niederschlag"
              ? [
                  { key: "nass", titel: "Regentage" },
                  { key: "trocken", titel: "längste Trockenzeit", einheit: "Tage" },
                  { key: "trocken_von", titel: "ab", links: true, text: (z) => kurz(z.trocken_von) },
                ]
              : []),
            { key: "max", titel: "größter Tag", einheit, text: (z) => de(z.max) },
            { key: "max_datum", titel: "am", links: true, text: (z) => kurz(z.max_datum) },
            { key: "tage", titel: "Tage gemessen" },
          ]}
          zeilen={d.jahre.map((z) => ({ ...z, _blass: z.tage < 330 }))}
          markiert={(z) => z.jahr === d.jahr}
        />
        <div class="leise">Platz nur für Jahre mit mind. 330 gemessenen Tagen{art === "niederschlag" ? " · Trockentag < 0,1 mm, die Trockenzeit zählt im Jahr, in dem sie endet" : ""}</div>
      </div>

    <!-- ============================================================= Schnee -->
    {:else if art === "schnee"}
      <div class="karte breit">
        <Balken punkte={d.winter.map((w) => [w.winter, w.schneetage, w.tage < d.min_tage])} normal={d.normal} farbe="var(--blau)" einheit="Schneetage" />
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="360px"
          start="winter"
          spalten={[
            { key: "winter", titel: "Winter", text: (w) => `${w.winter - 1}/${String(w.winter).slice(2)}` },
            { key: "schneetage", titel: "Schneetage" },
            { key: "max", titel: "größte Höhe", einheit: "cm", text: (w) => de(w.max, 0) },
            { key: "max_datum", titel: "am", links: true, text: (w) => (w.max ? kurz(w.max_datum) : "–") },
            { key: "erster", titel: "erster", links: true, text: (w) => kurz(w.erster) },
            { key: "letzter", titel: "letzter", links: true, text: (w) => kurz(w.letzter) },
          ]}
          zeilen={d.winter.map((w) => ({ ...w, _blass: w.tage < d.min_tage }))}
        />
      </div>

    <!-- =============================================================== Wind -->
    {:else if art === "wind"}
      <div class="karte breit">
        <Balken punkte={d.jahre.filter((j) => j.tage).map((j) => [j.jahr, j.sturm, j.tage < 330])} normal={d.normal} farbe="var(--text-2)" einheit="Sturmtage" />
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="360px"
          start="jahr"
          spalten={[
            { key: "jahr", titel: "Jahr" },
            { key: "sturm", titel: "Sturmtage" },
            { key: "orkan", titel: "Orkanböen" },
            { key: "max", titel: "stärkste Böe", einheit: "km/h", text: (j) => de(j.max) },
            { key: "max_datum", titel: "am", links: true, text: (j) => kurz(j.max_datum) },
            { key: "tage", titel: "Tage gemessen" },
          ]}
          zeilen={d.jahre.filter((j) => j.tage).map((j) => ({ ...j, _blass: j.tage < 330 }))}
        />
      </div>

    <!-- ============================================================== Frost -->
    {:else if art === "frost"}
      <div class="karte breit">
        <Balken punkte={d.jahre.filter((z) => z.luft_frei != null).map((z) => [z.jahr, z.luft_frei, z.luft_tage < 330])} normal={d.normal.luft_frei} farbe="var(--akzent)" einheit="frostfreie Tage (Luft)" />
      </div>
      <div class="karte breit">
        <Tabelle
          hoehe="360px"
          start="jahr"
          spalten={[
            { key: "jahr", titel: "Jahr" },
            { key: "luft_letzter", titel: "Luft letzter", links: true, text: (z) => tm(z.luft_letzter) },
            { key: "luft_erster", titel: "Luft erster", links: true, text: (z) => tm(z.luft_erster) },
            { key: "luft_frei", titel: "frostfrei", einheit: "Tage" },
            { key: "boden_letzter", titel: "Boden letzter", links: true, text: (z) => tm(z.boden_letzter) },
            { key: "boden_erster", titel: "Boden erster", links: true, text: (z) => tm(z.boden_erster) },
            { key: "boden_frei", titel: "frostfrei", einheit: "Tage" },
          ]}
          zeilen={d.jahre.filter((z) => z.luft_tage || z.boden_tage)}
        />
        <div class="leise">Mittel {normalText()} frostfrei: Luft {de(d.normal.luft_frei)} Tage · Boden {de(d.normal.boden_frei)} Tage</div>
      </div>

    <!-- ===================================================== Prognose-Verlauf -->
    {:else if art === "verlauf"}
      {@const K = verlaufKurve}
      <div class="raster">
        <div class="karte breit" bind:clientWidth={kb}>
          <svg width={kb - 2} height={KH} class="kurve">
            {#each K.gitter as v}
              <line x1={kr.l} x2={kb - kr.r} y1={K.ys(v)} y2={K.ys(v)} class="gitter" />
              <text x={kr.l - 5} y={K.ys(v) + 4} text-anchor="end">{de(v)}</text>
            {/each}
            {#each MONATSANFANG as a, m}<text x={K.xs(a + 15)} y={KH - 6} text-anchor="middle">{MONATE[m]}</text>{/each}
            <path d={K.flaeche} class="band" />
            <path d={K.pfad(d.verlauf.map((v) => [K.x(v[0]), v[2]]))} class="eigen" />
          </svg>
        </div>
        <div class="karte kachel">
          <div class="lbl">Heute</div>
          {#if letzterVerlauf}
            <div class="gross num">{de(letzterVerlauf[2])} °C</div>
            <div class="num">Band {de(letzterVerlauf[1], 2)} – {de(letzterVerlauf[3], 2)} °C</div>
            <div class="leise">Stand {datum(letzterVerlauf[0])} · Vergleichsjahre {d.jahre[0]}–{d.jahre[1]}</div>
            <div class="lbl" style="margin-top:10px">1. des Monats</div>
            {#each d.verlauf.filter((v) => v[0].endsWith("-01")) as v}
              <div class="num">{MONATE[Number(v[0].slice(5, 7)) - 1]}: {de(v[2], 2)} <span class="leise">({de(v[1], 2)}–{de(v[3], 2)})</span></div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .auswertung {
    height: 100%;
    overflow: auto;
    display: grid;
    align-content: start;
    gap: 12px;
  }
  .kopf {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .kopf b {
    font-size: 15px;
  }
  .inhalt {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .kacheln {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .kacheln.drei {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  .kacheln.zwei-spalten {
    grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  }
  .kachel {
    padding: 12px 14px;
    display: grid;
    gap: 4px;
    align-content: start;
    min-width: 0;
  }
  .breit {
    padding: 10px 12px;
    min-width: 0;
    display: grid;
    gap: 8px;
  }
  .raster {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 12px;
  }
  .zeile {
    display: grid;
    grid-template-columns: 26px 1fr auto;
    gap: 6px;
    align-items: baseline;
    font-size: 13px;
  }
  .zeile.erster .wert {
    font-weight: 700;
  }
  .platz {
    color: var(--text-3);
  }
  .gross {
    font-size: 28px;
    font-weight: 300;
  }
  .zwei {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 6px;
    font-size: 13px;
  }
  .streifen {
    padding: 0;
    overflow: hidden;
  }
  .streifen-svg {
    display: block;
    width: 100%;
    height: 180px;
  }
  .achse {
    display: flex;
    justify-content: space-between;
    padding: 4px 10px 6px;
  }
  .kurve {
    display: block;
  }
  .kurve text {
    font: 10px var(--mono);
    fill: var(--text-3);
  }
  .gitter {
    stroke: var(--rand);
  }
  .band {
    fill: var(--rand-stark);
    opacity: 0.5;
  }
  .median {
    fill: none;
    stroke: var(--text-2);
    stroke-dasharray: 5 4;
    stroke-width: 1.5;
  }
  .eigen {
    fill: none;
    stroke: var(--akzent);
    stroke-width: 2.5;
  }
  table.klein {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
    margin-top: 6px;
  }
  table.klein td {
    padding: 3px 4px;
    text-align: right;
    border-bottom: 1px solid var(--rand);
  }
  table.klein td.l {
    text-align: left;
  }
  @media (max-width: 700px) {
    .raster {
      grid-template-columns: minmax(0, 1fr);
    }
    .kacheln.zwei-spalten {
      grid-template-columns: minmax(0, 1fr);
    }
    .auswertung {
      height: auto;
      overflow: visible;
    }
  }
</style>
