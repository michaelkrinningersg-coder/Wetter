# Wetterstation — DWD Klimadaten-Analyse

Klimadaten-Dashboard für Stationen des Deutschen Wetterdienstes. Importiert die
offenen Tageswerte aus dem DWD Climate Data Center in eine lokale
SQLite-Datenbank und wertet sie in zwölf Analysebereichen aus — von der
Monatsübersicht über Temperatur- und Niederschlagstrends bis zu Extremwerten
und einer klimatologischen Jahresprognose.

Für Göttingen reicht die Reihe bis **1858** zurück (rund 60.000 Messtage).

| Station | ID | Höhe |
|---|---|---|
| Göttingen | 01691 | 167 m |
| Brocken | 00722 | 1141 m |
| Zugspitze | 05792 | 2964 m |

## Schnellstart

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

Beim ersten Start ist die Datenbank leer. Oben rechts auf **Synchronisieren**
klicken — der Erstimport lädt das historische Archiv und die tagesaktuellen
Werte vom DWD (für Göttingen ca. 10 Sekunden).

### Produktion

```bash
npm run build
npm start          # liefert dist/ und die API auf Port 3001
```

## Analysebereiche

**Messwerte** — Monatsübersicht (Tageswerte, Tagesverlauf, Jahresverlauf) ·
Jahresübersicht (Kenndaten und Schwellenwerttage je Kalenderjahr) ·
Dieser Tag in der Geschichte

**Trends** — Temperaturtrend · Niederschlagstrend · Jahresmittelwerte,
Anomalien und Warming Stripes · Mitteltemperatur Year-to-Date · Jahreszeiten ·
Vegetationsperiode und Wachstumsgradtage · Starkregenanteil

**Rekorde** — Monats-Heatmap · Spitzenwerte (Top-50-Tage) ·
Spitzenmonate (Top-50-Monate) · Perioden & Serien (längste Hitze-, Trocken-,
Frost- und Niederschlagsperioden) · Rekordbilanz

**Klimatologie** — Klimadiagramm nach Walter & Lieth · Referenzperioden ·
Jahresprognose

## Aufbau

```
src/
  App.tsx              Shell, Navigation, Stationsauswahl
  types.ts             API-Typen
  index.css            Design-Tokens (@theme)
  lib/
    api.ts             useApi() — Fetch mit AbortController
    format.ts          null-sichere Formatierung, de-DE
    stats.ts           lineare Regression, Perzentile
  components/
    ui.tsx             Karten, Kacheln, Filter, Tooltips, Zustände
    …                  13 Analysekomponenten
server/
  index.js             Express-Routen
  db.js                SQLite-Schema und Indizes
  dwd.js               Download und Parser der DWD-Archive
  queries.js           sämtliche Aggregationen
  stations.js          Stationsverzeichnis
```

Die Datenbank liegt unter `data/weather.sqlite` (per `.gitignore`
ausgeschlossen, Pfad über `DATA_DIR` änderbar).

## Methodik

- **90-%-Regel.** Jahresmittel und Jahressummen werden nur für Jahre
  ausgewiesen, in denen mindestens 90 % der Tage einen geprüften Messwert
  tragen. Das laufende Jahr wird stets getrennt gekennzeichnet.
- **Kenntage nach DWD**, mit einschließenden Schwellen: heißer Tag ≥ 30,0 °C,
  Sommertag ≥ 25,0 °C, Tropennacht ≥ 20,0 °C, Frosttag < 0,0 °C (Minimum),
  Eistag < 0,0 °C (Maximum).
- **Perioden.** Gezählt wird jede ununterbrochene Serie von Tagen, die dasselbe
  Kriterium erfüllen. Ein fehlender Messwert oder eine Lücke im Datenbestand
  beendet eine Serie, statt sie zu verlängern.
- **Gleitendes 30-Jahres-Mittel.** Zentriert, endet daher 15 Jahre vor dem
  Reihenende. Es zeigt den tatsächlichen Verlauf der Erwärmung, den eine
  einzelne Regressionsgerade über 168 Jahre als linear unterstellt.
- **Trendstärke.** Angegeben werden der Trend je Jahrzehnt, sein Standardfehler,
  das Bestimmtheitsmaß und ob er auf dem 95-%-Niveau signifikant ist; im
  Diagramm liegt das Konfidenzband um die Gerade.
- **Vegetationsperiode.** Beginn: erster Tag einer Serie von sechs Tagen mit
  einem Tagesmittel ab 5 °C. Ende: Tag vor der ersten solchen Serie darunter
  nach dem 1. Juli. Wachstumsgradtage summieren max(0, Tmittel − 5 °C).
- **Homogenität.** Die DWD-Reihen sind Rohdaten und nicht homogenisiert;
  Stationsverlegungen und Gerätewechsel sind nicht korrigiert. Jede
  Langzeitansicht blendet dazu die tatsächliche Datenabdeckung ein.
- **Jahreszeiten.** Meteorologische Jahreszeiten zu je drei vollen Monaten; der
  Winter läuft über den Jahreswechsel und wird nach beiden Jahren benannt.
- **Rekordbilanz.** Gezählt werden nur die heute noch stehenden Tagesrekorde —
  je einer pro Kalendertag und Richtung. Eine Zählung nach „wärmer als alles
  bisher Gesehene" wäre zu frühen Jahrzehnten hin verzerrt.
- **Starkregen.** Zwei Indizes: Anteil aus Tagen ab 20 mm sowie der WMO-Index
  R95p, dessen Schwelle aus dem 95. Perzentil der Regentage 1961–1990 stammt.
- **Extremmonate** benötigen mindestens 25 gültige Messtage.
- **Heatmap.** Jeder Monat wird gegen dieselben Kalendermonate aller anderen
  Jahre eingefärbt; die Skala läuft je Monat vom 20. bis zum 80. Perzentil.
- **Prognose.** Gemessene Tage bis zum letzten Datenbanktag; das Restjahr wird
  30-mal zu Ende gerechnet — je einmal so, wie es in jedem Jahr der
  Referenzperiode tatsächlich verlaufen ist. Ausgewiesen sind der Median dieser
  30 Ergebnisse und der Bereich vom 10. bis 90. Perzentil. Das ist eine
  Klimatologie-Fortschreibung, **keine Wettervorhersage**.
- **Klimadiagramm.** Temperatur- und Niederschlagsachse stehen im Verhältnis
  1 °C : 2 mm, damit die Walter-&-Lieth-Leseregel gilt.

## Herkunft

Die App wurde ursprünglich in Google AI Studio erstellt. Dieses Repository ist
eine vollständige Rekonstruktion aus dem ausgelieferten Bundle und dem
Live-API-Vertrag: als typisiertes React-Projekt neu aufgebaut, mit
überarbeiteter Oberfläche und korrigierten Berechnungen.

Alle Endpunkte wurden gegen die Originalantworten gegengeprüft. Die Befunde und
Abweichungen sind in **[ANALYSE.md](ANALYSE.md)** dokumentiert — darunter ein
Fehler in der Jahresprognose, der das Vorzeichen der Kernaussage umkehrte.

Vorschläge für den weiteren Ausbau stehen in
**[VERBESSERUNGEN.md](VERBESSERUNGEN.md)** (30 Punkte, Abschnitt A umgesetzt)
und **[VERBESSERUNGEN-II.md](VERBESSERUNGEN-II.md)** (10 weitere, zur
Entscheidung offen).

## Daten

Quelle: [DWD Climate Data Center](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/),
Tageswerte (`kl`). Frei verwendbar nach GeoNutzV; Quellenangabe erforderlich.
