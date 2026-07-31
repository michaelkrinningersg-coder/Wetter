# Analyse der AI-Studio-App — Bugs, Schwachstellen, Verbesserungen

Grundlage dieser Analyse ist die produktiv ausgelieferte App unter
`remix-wetterstation-g-ttingen-6309.ai.studio`: das JavaScript-Bundle
(dekompiliert, ca. 3.900 Zeilen App-Code) sowie die Live-Antworten aller
13 `/api`-Endpunkte.

Jeder Befund ist entweder **im Bundle nachlesbar** oder **an einer
API-Antwort überprüfbar**. Für die Serverlogik lag kein Quellcode vor —
Aussagen dazu beschränken sich deshalb strikt auf das, was die Antworten
selbst zeigen. Wo ich etwas nicht belegen konnte, steht es nicht drin.

Legende: **[K]** kritisch · **[H]** hoch · **[M]** mittel · **[N]** niedrig

---

## 1. Fachliche Fehler (falsche Zahlen)

### 1.1 [K] Die Jahresprognose rechnet mit falschen Ist-Werten — das Vorzeichen der Kernaussage kippt

`/api/weather/forecast` widerspricht den beiden anderen Endpunkten derselben
App für exakt denselben Zeitraum und dieselben Rohdaten:

| Größe (Göttingen, 01.01.–30.07.2026) | Wert |
|---|---|
| `/api/weather/ytd-temp` → 2026 | **9,59 °C** |
| `/api/weather/annual-overview` → 2026 `avg_temp` | **9,59 °C** |
| DWD-Rohdaten, direkt nachgerechnet | **9,59 °C** |
| `/api/weather/forecast` → `observedTempAvg` | **8,36 °C** ❌ |

Der Fehler ist systematisch und zieht sich durch das ganze Modul —
`monthlyData[0]` (Januar 2026) meldet **−1,8 °C**, gemessen sind
**−0,2 °C**; der YTD-Startpunkt der Verlaufskurve meldet **−2,698 °C** statt
**−1,15 °C**.

**Auswirkung:** Die Kernaussage des Prognose-Tabs dreht sich um.

- Original: `9,12 °C`, Abweichung **−0,56 °C** → „2026 wird kälter als das Klimamittel."
- Korrekt: `10,02 °C`, Abweichung **+0,33 °C** → 2026 liegt **über** dem Mittel.

Der Niederschlagsteil desselben Endpunkts (`observedPrecipSum` 314,8 mm,
`forecastPrecipSum` 595,8 mm) stimmt dagegen exakt — der Fehler sitzt allein
in der Temperatur-Aggregation der beobachteten Tage.

*Hier behoben:* `server/queries.js` → `buildForecast()` bildet die
beobachteten Werte direkt aus den Tagesmitteln; die Werte stimmen jetzt mit
`ytd-temp` und `annual-overview` überein.

### 1.2 [H] „Humide Einordnung" im Klimadiagramm ist ein konstanter String

In der Klimatabelle stand in **jeder** Monatszeile wörtlich
`"Humid (Niederschlag > 2 * Temp)"` — als fest verdrahteter Text. Die
Bedingung wurde nie ausgewertet. Für Göttingen fällt das nicht auf (dort
sind tatsächlich alle Monate humid), für eine aride Station wäre die Tabelle
schlicht falsch.

*Behoben:* `humid` wird pro Monat aus `avg_precipitation > 2 × avg_temp`
berechnet, aride Monate werden als solche ausgewiesen, und der Einleitungstext
formuliert das Ergebnis dynamisch statt es zu behaupten.

### 1.3 [H] Referenzperioden umfassen 31 statt 30 Jahre

Der Erklärtext nennt „30-jährige Zeiträume (Klimanormalperioden)", die
Kacheln zeigen „(31 von 31 Jahren)" — die Perioden sind beidseitig
einschließend (1960…1990 = 31 Jahre). Zusätzlich ist die Basisperiode
`1960–1990`; die WMO-Normalperiode ist `1961–1990`.

Die Abweichung ist klein, aber sie macht aus einem zitierfähigen Standardwert
eine Hausnummer. *Der Datenvertrag wurde beibehalten* (sonst ändern sich alle
Zahlen), der Text weist die Abweichung jetzt aber explizit aus.

### 1.4 [M] Trendfenster hängen an der Systemuhr, nicht an den Daten

`TempTrend` und `PrecipTrend` berechneten die Filtergrenze aus
`new Date().getFullYear()`. Steht der Datenbestand still (kein Import), zeigt
„Letzte 30 Jahre" nach zwei Jahren nur noch 28 Jahre — ohne Hinweis.

*Behoben:* Das Fenster wird vom jüngsten Jahr **im Datensatz** aus gezählt.

### 1.5 [M] Lineare Regression ohne Nulldivisions-Schutz

Die Kleinste-Quadrate-Rechnung war in beiden Trend-Tabs dupliziert und in
beiden Fällen ungesichert:

```js
const C = (w*E - O*_) / (w*M - O*O)   // Nenner kann 0 sein
```

Bleibt nach dem Filtern genau ein vollständiges Jahr übrig, ist der Nenner 0
→ die Trendlinie wird `NaN`, die Kacheln zeigen `NaN °C`.

*Behoben:* eine gemeinsame `linearFit()` in `src/lib/stats.ts` mit
Nennerprüfung; `null` statt `NaN`.

### 1.6 [M] Sortierung „Max Abweichung" mischt warm und kalt

```js
m === "anomaly-desc" ? Math.abs(w.anomaly) - Math.abs(A.anomaly) : 0
```

Durch den Absolutbetrag stehen das wärmste und das kälteste Jahr direkt
nebeneinander — die Spalte sieht unsortiert aus.

*Behoben:* echte Sortierung nach vorzeichenbehafteter Anomalie, in beide
Richtungen umschaltbar.

### 1.7 [M] Fehlende Werte sortieren sich in der Jahresübersicht als Rekord

Der Sortier-Switch ersetzte `null` durch `±999`:

```js
case "min_temp-asc":  return (C ? E.forecast_min_temp : E.min_temp) ?? 999
case "min_temp-desc": return -((C ? E.forecast_min_temp : E.min_temp) ?? -999)
```

Ein Jahr ohne Messwert rangiert damit als kältestes bzw. wärmstes der
Messgeschichte — genau in den Jahren des 19. Jahrhunderts, wo Lücken häufig
sind.

*Behoben:* `null`-Werte sortieren in beiden Richtungen ans Ende.

### 1.8 [N] Höhenangabe für den Brocken widersprüchlich

Die Fallback-Liste im Frontend führt den Brocken mit **1125 m**,
`/api/stations` liefert **1141 m**. Vor dem Laden der Stationsliste zeigt der
Footer also einen anderen Wert als danach. (Korrekt ist 1141 m.)

---

## 2. Robustheit und Datenintegrität

### 2.1 [H] Kein Request-Abbruch — Race Condition beim Stationswechsel

Alle 13 Datenkomponenten benutzten dasselbe Muster **ohne** `AbortController`:

```js
useEffect(() => {
  async function b() { const j = await fetch(...); n(await j.json()) }
  b()
}, [e])
```

Beim schnellen Wechsel Göttingen → Zugspitze gewinnt die **zuletzt
eintreffende** Antwort, nicht die zuletzt angeforderte. Da die Heatmap
172 kB und die Jahresübersicht 91 kB liefern, ist das Zeitfenster real: Es
werden Zugspitzen-Kacheln unter der Überschrift „Göttingen" angezeigt.
Zusätzlich setzt jeder Handler State nach dem Unmount.

*Behoben:* ein zentraler `useApi()`-Hook (`src/lib/api.ts`) mit
`AbortController`, Abbruch im Cleanup und Ignorieren abgebrochener Antworten.

### 2.2 [H] `localStorage`-Zugriff ohne Absicherung

```js
const [p, y] = useState(() => localStorage.getItem("selected_station_id") || "01691")
```

In Safari-Privatmodus und in sandboxed iframes wirft `localStorage` — im
State-Initializer bedeutet das einen Fehler beim allerersten Render, also eine
**weiße Seite** ohne Fehlermeldung.

*Behoben:* gekapselt in `try/catch`, Fallback auf die Standardstation.

### 2.3 [H] Historische DWD-Archiv-URL ist fest verdrahtet

`/api/stations` liefert:

```
tageswerte_KL_01691_18580101_20251231_hist.zip
```

Der Dateiname enthält Anfangs- **und Enddatum** des Archivs. Sobald der DWD
das nächste Jahresarchiv veröffentlicht, ändert sich der Name und die URL
liefert 404 — der Erstimport einer Station schlägt dann stumm fehl.

*Behoben:* `server/dwd.js` liest das DWD-Verzeichnis und löst den aktuellen
Archivnamen zur Laufzeit auf.

### 2.4 [M] Kein Timeout beim DWD-Download

Hängt die Verbindung zu `opendata.dwd.de`, bleibt `importInProgress` dauerhaft
`true`. Das Frontend pollt daraufhin **endlos alle 3 Sekunden**
`/api/status`, und der Synchronisieren-Button bleibt gesperrt, bis der Prozess
neu startet.

*Behoben:* `AbortController` mit 120-s-Timeout; Fehler landen in `lastError`.

### 2.5 [M] Ungültige Kategorien liefern `[]` statt eines Fehlers

```
GET /api/weather/extremes?category=temp_max   →  200  []
```

`temp_max` existiert nicht (richtig wäre `temp_max_max`). Die App zeigt
„Keine Messdaten verfügbar. Bitte synchronisiere die Daten." — eine
irreführende Diagnose, die Nutzer zu einem sinnlosen Reimport schickt. Gleiches
gilt für unbekannte `stationId`-Werte.

*Behoben:* Whitelist-Prüfung im Server, `400` mit klarer Meldung; unbekannte
Stationen ebenso.

### 2.6 [M] Serverfehlertext wird als Datum gerendert

```js
d({ success: !1, previousMaxDate: b.error || "Fehler" })
```

Die Fehlermeldung des Servers wird in das Feld `previousMaxDate` geschrieben
und im UI unter der Beschriftung „Grund:" ausgegeben — ein Feld, das sonst ein
Datum enthält. Es gab kein reguläres `error`-Feld im Ergebnisobjekt.

*Behoben:* eigenes `error`-Feld, getrennte Darstellung.

### 2.7 [M] Kein Schutz gegen parallele Importe

Zwei Klicks auf „Synchronisieren" starteten zwei gleichzeitige Importe auf
dieselben Zeilen.

*Behoben:* `409 Conflict`, solange ein Import derselben Station läuft.

### 2.8 [N] `newRecordsCount` zählte verarbeitete statt neue Zeilen

Das „recent"-Archiv enthält immer die letzten ~500 Tage. Ohne Differenzbildung
meldet jeder Reimport „500 neue Datensätze", obwohl nichts hinzukam.

*Behoben:* Differenz aus Zeilenzahl vor/nach dem Import; die Rohzahl steht
zusätzlich als `processedRecordsCount` bereit.

### 2.9 [N] Source Map in Produktion

`/assets/index-*.js.map` war zwar nicht abrufbar, aber `sourceMappingURL` stand
im Bundle. Für ein öffentliches Klima-Dashboard unkritisch — trotzdem ist der
Build jetzt explizit auf `sourcemap: false` gesetzt.

---

## 3. Barrierefreiheit

| # | Befund | Auswirkung |
|---|---|---|
| 3.1 **[H]** | Rekord-Einträge sind `<div onClick=…>` | Per Tastatur nicht erreichbar — die Navigation von Spitzenwerten in die Monatsansicht ist für Tastaturnutzer komplett unerreichbar |
| 3.2 **[H]** | Kein `:focus-visible`-Stil | Der Browser-Standardring ist auf `#0A0A0A` praktisch unsichtbar |
| 3.3 **[M]** | ~40 Filter-/Sortier-Buttons ohne `aria-pressed`/`role="radio"` | Screenreader sagen nicht, welcher Filter aktiv ist |
| 3.4 **[M]** | Sortierbare Spalten ohne `aria-sort`, `<th>` ohne `scope` | Tabellenstruktur nicht navigierbar |
| 3.5 **[M]** | Import-Statusmeldungen ohne `aria-live` | Erfolg/Fehler der Synchronisierung wird nicht angesagt |
| 3.6 **[M]** | Heatmap-Info nur im `title`-Attribut | Auf Touch-Geräten gar nicht erreichbar |
| 3.7 **[M]** | Keine Legende für die Heatmap-Farbskala | Die Farbcodierung ist ohne den Fließtext nicht interpretierbar |
| 3.8 **[N]** | Keine `prefers-reduced-motion`-Behandlung | Dauerhafte `animate-pulse`/`animate-ping`-Elemente |
| 3.9 **[N]** | `lang="en"` im HTML bei durchgängig deutschem Inhalt | Falsche Sprachausgabe |

Alle Punkte sind in der neuen Fassung umgesetzt.

---

## 4. Code-Qualität

- **[H] Keine Wiederverwendung.** Lade-, Fehler- und Leer-Zustände waren in
  jeder der 13 Komponenten separat ausgeschrieben — mit abweichenden Texten und
  Abständen. Ebenso die Kacheln, die Filterbuttons und die Chart-Tooltips.
  Jetzt: `src/components/ui.tsx`.
- **[H] 28-armiger `switch` in der Jahresübersicht.** Der Sortier-Comparator
  wiederholte die Beobachtet/Prognose-Paarung für jede Spalte einzeln — die
  fehleranfälligste Stelle der App (siehe 1.7). Ersetzt durch eine
  Spaltendefinition (`COLUMNS`), die Label, Feldpaar und Formatierung an einer
  Stelle hält.
- **[M] Keine Typen.** Das Bundle enthält keinerlei Typinformation; API-Felder
  wurden ungeprüft mit `.toFixed()` weiterverarbeitet. Ein `null` in einem
  Zahlenfeld ließ den kompletten Tab abstürzen. Jetzt: `src/types.ts` plus
  `null`-sichere Formatierer in `src/lib/format.ts`.
- **[M] Hardcodierte Stationsbezüge.** Obwohl drei Stationen wählbar sind,
  stand „Göttingen" fest in Ladetexten („Berechne Temperaturtrends für
  Göttingen…"), in Überschriften und in Erklärtexten; die Spitzenwerte-Ansicht
  zeigte auch für Brocken und Zugspitze „Göttingen (ID 01691)".
- **[M] Zahlenformatierung ohne Locale.** `toFixed()` erzeugt `9.59`; in
  deutschsprachiger Oberfläche gehört dort `9,59` hin. Jetzt durchgängig
  `Intl.NumberFormat('de-DE')`.
- **[N] Monatsnamen viermal dupliziert** (`lW`, `cW`/`fW`, `mW`, `vW`, `ms`/`qC`).

---

## 5. UI und Gestaltung

### 5.1 Typografie: Großbuchstaben als Grundschrift

Nahezu jeder Text lief über `uppercase tracking-widest` bei 9–10 px. Das
betraf nicht nur Labels, sondern auch Fließtext — etwa den Erklärabsatz der
Heatmap mit über 60 Wörtern, komplett in gesperrten Versalien. Versalien
entfernen die Wortsilhouette und sind bei langen Zeilen deutlich langsamer
lesbar; bei 9 px und `tracking-widest` ist der Text faktisch nur noch
Textur.

**Neu:** Versalien nur noch für kurze Labels (`.label`-Utility). Fließtext in
Gemischtschrift ab 12 px mit `leading-relaxed`.

### 5.2 Navigation: zwölf Buttons in einer umbrechenden Reihe

Die zwölf Analysebereiche lagen als gleichrangige Pill-Buttons in einem
`flex-wrap`-Container — auf üblichen Breiten drei ausgefranste Zeilen, ohne
Gruppierung, und bei jedem Breitenwechsel springen die Positionen.

**Neu:** feste Seitennavigation ab `lg`, gegliedert in *Messwerte · Trends ·
Rekorde · Klimatologie*; darunter eine horizontal scrollende Leiste statt
eines Blocks, der ein Drittel des Viewports frisst.

### 5.3 Farben ohne System

Die Oberfläche mischte `#0A0A0A`, `#111111`, `#151515`, `#181818`, `#1A1A1A`,
`#222222` — teils für dieselbe Ebene (`#151515` und `#181818` bezeichneten
beide „erhöhte Fläche"). Datenfarben kamen aus der Tailwind-Palette in
wechselnden Abstufungen: `sky-400`, `blue-400`, `blue-500`, `cyan-400` standen
nebeneinander für „kalt/nass", ohne dass die Unterscheidung etwas bedeutete.

**Neu:** ein Token-Satz in `src/index.css` (`@theme`) mit vier Flächenebenen
und benannten Datenfarben (`warm`, `hot`, `cool`, `cold`, `wet`, `dry`).
Semantisch statt visuell benannt — `text-warm` statt `text-red-400`.

### 5.4 Diagrammfarben in OKLCH

Die Farbwerte sind in OKLCH definiert und in Helligkeit aufeinander abgestimmt.
Für die Heatmap heißt das konkret: statt einer RGB-Interpolation von Blau nach
Bernstein (die im mittleren Bereich durch trübe Olivtöne läuft und „nahe am
Mittel" wie eine eigene Kategorie aussehen lässt) läuft die Skala jetzt sauber
divergierend Blau → neutral → Rot, mit fixiertem Farbton je Hälfte.

### 5.5 Feste Achsengrenzen brechen bei anderen Stationen

Das Klimadiagramm hatte `domain={[-5, 25]}` und `domain={[0, 120]}` fest
gesetzt. Für die Zugspitze (Jahresmittel unter −4 °C, Monatsmittel bis −11 °C)
wird die Temperaturkurve dadurch am unteren Rand abgeschnitten — bei einer App
mit Stationsauswahl ein sichtbarer Fehler.

**Neu:** berechnete Domains. Zusätzlich steht die Niederschlagsachse jetzt
exakt im Verhältnis **1 °C : 2 mm** zur Temperaturachse — erst dadurch ist die
Walter-&-Lieth-Leseregel („Niederschlag über der Temperaturkurve = humid")
überhaupt gültig. Vorher (25 °C zu 120 mm) stimmte das Verhältnis nicht.

### 5.6 Weitere Änderungen

- Kacheln, Karten und Tabellen mit einheitlichen Radien, Abständen und
  Rasterabständen; die `hover:border-r`-Konstruktion (die beim Überfahren einen
  Rahmen *hinzufügt* und damit den Inhalt um 1 px verschiebt) ist ersetzt.
- Der Tagesverlauf verwendet `type="linear"` statt `monotone` — Spline-Glättung
  erfindet zwischen Messtagen Maxima, die es nicht gab.
- Neue Ansicht „Jahresverlauf" in der Monatsübersicht: die vom Server ohnehin
  gelieferten `monthlyStats` wurden bisher gar nicht dargestellt.
- Jahres-Schnellauswahl leitet sich aus dem Datenbestand ab statt aus einer
  fest eingetragenen Liste `[2026 … 2021]`, die jeden Januar veraltet.
- Tabellen mit `tabular-nums`, damit Ziffernspalten ausgerichtet stehen.

---

## 6. Was bewusst offen blieb

- **Die Datenverträge sind unverändert.** Alle Endpunkte liefern dieselben
  Felder wie vorher — mit Ausnahme der in 1.1 korrigierten Prognosewerte und
  zweier ergänzter Felder (`error` beim Import, `cutOffMonth`/`cutOffDay` bei
  `ytd-temp`).
- **Kein Light-Mode.** Die App ist bewusst auf Dark committet; ein zweites
  Theme wäre eine eigene Entscheidung, keine Reparatur.
- **Bundle-Größe.** 657 kB (190 kB gzip), im Wesentlichen Recharts.
  Code-Splitting je Tab wäre der nächste sinnvolle Schritt, ändert aber nichts
  an der Korrektheit.
- **Keine Tests.** Die Parser- und Aggregationslogik in `server/` ist gut
  testbar (reine Funktionen auf SQLite); das wäre der lohnendste nächste
  Ausbau.

---

## 7. Verifikation der Rekonstruktion

Die neue Fassung wurde gegen die Live-App gegengeprüft — gleiche Station,
gleicher Importstand (59.901 Zeilen, 01.01.1858 – 30.07.2026):

| Endpunkt | Ergebnis |
|---|---|
| `/api/status` | identisch |
| `/api/weather/annual-means` | identisch (inkl. `overallAvg` auf 15 Stellen) |
| `/api/weather/climate-diagram` | identisch |
| `/api/weather/comparisons` | identisch |
| `/api/weather/heatmap` | identisch (1.874 Einträge, Ränge gleich) |
| `/api/weather/monthly` | identisch |
| `/api/weather/trends/temp`, `…/precip` | identisch |
| `/api/weather/extremes`, `…/extreme-months` | identisch |
| `/api/weather/annual-overview` | identisch (Prognosespalten auf 0,1 genau) |
| `/api/weather/ytd-temp` | Werte identisch; 145 statt 139 Jahre (strengere Abdeckungsprüfung, siehe unten) |
| `/api/weather/forecast` | Niederschlag identisch, Temperatur **korrigiert** (1.1) |

Zur Abweichung bei `ytd-temp`: Der Abdeckungsgrad wird hier gegen die
**Kalenderlänge** des YTD-Fensters geprüft, nicht gegen die Zahl der
gespeicherten Zeilen. Sonst gilt ein Jahr, von dem nur 40 Tage in der
Datenbank liegen, als „100 % abgedeckt". Welche Regel das Original verwendet,
ist von außen nicht feststellbar — die hier gewählte ist die strengere.
