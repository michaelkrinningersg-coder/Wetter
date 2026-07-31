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
Jahresübersicht (Kenndaten und Schwellenwerttage je Kalenderjahr)

**Trends** — Temperaturtrend · Niederschlagstrend · Jahresmittelwerte und
Anomalien · Mitteltemperatur Year-to-Date

**Rekorde** — Monats-Heatmap · Spitzenwerte (Top-50-Tage) ·
Spitzenmonate (Top-50-Monate)

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
- **Extremmonate** benötigen mindestens 25 gültige Messtage.
- **Heatmap.** Jeder Monat wird gegen dieselben Kalendermonate aller anderen
  Jahre eingefärbt; die Skala läuft je Monat vom 20. bis zum 80. Perzentil.
- **Prognose.** Gemessene Tage bis zum letzten Datenbanktag, danach das
  tagesgenaue Mittel der letzten 30 vollständigen Kalenderjahre. Das ist eine
  Klimatologie-Fortschreibung, **keine Wettervorhersage**: Sie zeigt, wo das
  Jahr bei durchschnittlichem Restverlauf landen würde.
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

## Daten

Quelle: [DWD Climate Data Center](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/),
Tageswerte (`kl`). Frei verwendbar nach GeoNutzV; Quellenangabe erforderlich.
