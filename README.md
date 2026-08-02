# Wetterstation — DWD Klimadaten-Analyse

Klimadaten-Dashboard für Stationen des Deutschen Wetterdienstes. Importiert die
offenen Tageswerte aus dem DWD Climate Data Center in eine lokale
SQLite-Datenbank und wertet sie in zwölf Analysebereichen aus — von der
Monatsübersicht über Temperatur- und Niederschlagstrends bis zu Extremwerten
und einer klimatologischen Jahresprognose.

Für Göttingen reicht die Reihe bis **1858** zurück (rund 60.000 Messtage) —
einschließlich Luftfeuchte und Schneehöhe ab 1858 und Bewölkung ab 1860.

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

```bash
npm run lint       # ESLint 9, Flat Config
npm run typecheck  # tsc --noEmit
```

Beide laufen im Pages-Workflow vor dem Build und brechen den Deploy ab, bevor
eine kaputte Fassung veröffentlicht wird.

### GitHub Pages

Pages liefert Dateien aus, keine Query-Strings. `npm run build:static` baut
deshalb das Frontend im statischen Modus **und** schreibt jede API-Antwort als
JSON-Datei:

```bash
npm run import:stations   # Datenbank füllen (die drei Stationen vom DWD)
npm run build:static      # dist/ mit 7.673 Dateien, 144 MB
```

Das JavaScript ist aufgeteilt: 34 Chunks statt einer Datei. Der Erstaufruf lädt
**65 kB gzip** (Gerüst, React, Icons) statt 235 — die Diagrammbibliothek ist mit
123 kB gzip der größte Brocken und kommt erst beim ersten Diagramm. Die
Startansicht ist deshalb bewusst ohne sie gebaut. Überfährt man einen Tab, wird
seine Ansicht schon geladen, bevor der Klick kommt.

Der Zustand der Ansicht steht in der Adresszeile, damit sich jede Ansicht
verlinken lässt:

```
?bereich=air&groesse=o3&saison=summer          Ozon-Tagesgang im Sommer
?bereich=overview&station=00722&jahr=2020&monat=7   Brocken, Juli 2020
?bereich=day-in-history&monat=3&tag=15         der 15. März in der Geschichte
```

Ausschließlich über den Query-String, nie über den Pfad — Pages liefert Dateien
aus und hat keine Rewrite-Regel: `/Wetter/?bereich=air` ist weiterhin eine
Anfrage nach `/Wetter/`, `/Wetter/air` wäre ein 404. Ein Bereichswechsel legt
einen Verlaufseintrag an und räumt die Parameter des vorigen Bereichs weg; alles
innerhalb eines Bereichs ersetzt den Eintrag nur, damit die Zurück-Taste nicht
unter zwanzig Reglerbewegungen begraben wird. Unbekannte Werte fallen still auf
die Vorgabe zurück.

Wohin welche Antwort geschrieben wird, entscheidet `src/lib/static-path.js` —
und dieselbe Funktion benutzt das Frontend, um zu lesen. Eine zweite
Implementierung würde auseinanderlaufen, und der Fehler wäre ein 404 im
Browser statt ein Übersetzungsfehler.

| Gruppe | Dateien | Größe |
|---|---:|---:|
| Deutschland (Top 50 je Tag) | 552 | 57,9 MB |
| Karte (Register + ein Tag je Datei) | 553 | 32,1 MB |
| Monatsansicht | 5.020 | 30,3 MB |
| Dieser Tag | 1.116 | 17,3 MB |
| Gebietsmittel | 60 | 3,3 MB |
| übrige (inkl. Umweltdaten) | 175 | 2,3 MB |

Der Workflow `.github/workflows/pages.yml` veröffentlicht nach jedem Datenlauf.
Damit er greifen kann, muss in den Repository-Einstellungen unter **Pages** als
Quelle **GitHub Actions** eingestellt sein.

Die Oberfläche kennt einen hellen und einen dunklen Farbsatz, umschaltbar oben
rechts. Dunkel bleibt die Vorgabe; die Wahl wird gespeichert und vor dem ersten
Bildaufbau von einem Inline-Skript gesetzt, damit die Seite nicht kurz dunkel
aufblitzt. Sämtliche Farben sind CSS-Variablen — auch die der Diagramme, weil
recharts sie in SVG-Präsentationsattribute schreibt, wo `var()` aufgelöst wird.

Zwei Dinge kann eine statische Auslieferung nicht, und sie täuscht es auch
nicht vor: den DWD-Import auf Knopfdruck und das Nachladen der Pegel beim
Aufruf. Beide Schalter sind ausgeblendet; die Daten sind so frisch wie der
letzte Deploy.

## Analysebereiche

**Überblick** — Startansicht: letzter Messtag gegen das Übliche desselben
Kalendertags, laufendes Jahr gegen die Referenzperiode, die vier auffälligsten
Stationen Deutschlands, Allzeitrekorde des Tages, Pollen, Luft, Strahlung und
Pegel. Jede Kachel verlinkt in die Ansicht, aus der ihre Zahl stammt.

**Messwerte** — Monatsübersicht (Tageswerte, Tagesverlauf, Jahresverlauf) ·
Jahresübersicht (Kenndaten und Schwellenwerttage je Kalenderjahr) ·
Dieser Tag in der Geschichte

**Trends** — Temperaturtrend · Niederschlagstrend · Jahresmittelwerte,
Anomalien und Warming Stripes · Mitteltemperatur Year-to-Date · Jahreszeiten ·
Vegetationsperiode und Wachstumsgradtage · Starkregenanteil · Weitere
Kenngrößen (Schneedeckentage, heitere und trübe Tage, Sonnenscheindauer,
Luftfeuchte, schwüle Tage, Bodenfrosttage) · Luftdruck seit 1858 mit dem
Zusammenhang zur Windstärke · Spätfrostrisiko: Vegetationsbeginn gegen letzten
Frühjahrsfrost · Verteilungsverschiebung: drei Referenzperioden als ganze
Verteilung statt als Mittelwert

**Rekorde** — Monats-Heatmap · Spitzenwerte (Top-50-Tage) ·
Spitzenmonate (Top-50-Monate) · Perioden & Serien (längste Hitze-, Trocken-,
Frost- und Niederschlagsperioden) · Rekordbilanz · Rekordgeschichte: wie alt
die stehenden Rekorde sind und aus welchen Jahren die 366 Tagesrekorde stammen

**Klimatologie** — Klimadiagramm nach Walter & Lieth · Referenzperioden ·
Jahresprognose

**Umwelt** — Flusspegel Leine (Göttingen), Rhume (Northeim) und Weser
(Wahmbeck) mit Verlauf, Meldestufen und langjährigen Kennwerten · Luftqualität
aus den beiden Göttinger UBA-Stationen: Tagesgang je Messgröße im Vergleich
Hintergrund gegen Verkehr, Wochentags- und Jahresverlauf, Jahresmittel gegen
die Grenzwerte, Überschreitungen der 39. BImSchV und Ozon gegen die
Tageshöchsttemperatur derselben Stadt · Ortsdosisleistung der elf BfS-Sonden im
25-km-Umkreis, eine davon an der Wetterstation selbst · Pollenflug für die
DWD-Region, acht Arten über drei Vorhersagetage · Phänologie: die zehn
phänologischen Jahreszeiten seit 1951, der Kalender aus 191 Pflanze-Phase-Paaren
und der Vorfrühling gegen die Temperatur der Monate davor

**Deutschland** — Gebietsmittel für Deutschland und die Bundesländer seit 1881
(Trend je Jahrzehnt, Rangliste, zehn Größen) · Karte aller Stationen mit den
Tageswerten · Spitzenreiter aller DWD-Stationen für einen einzelnen Tag:
wärmste und kälteste Station im Mittel und absolut, stärkste Bö, windigste
Station im Mittel, nasseste Station und größte Tagesspanne — jeweils für ganz
Deutschland und für alles unterhalb 1000 m · Allzeitrekorde: welche Station an
welchem Tag ihren eigenen Höchst- oder Tiefstwert gebrochen hat, als Liste und
als Karte · Deutschlandtage: die Spanne zwischen dem wärmsten und dem kältesten
Ort des Landes für jeden Tag seit 1936, das Höhenprofil eines einzelnen Tages
und die Abnahme der Temperatur mit der Höhe über 145 Jahre, dazu der
Jahreslauf des geografischen Gefälles und die Stationen, die Deutschlands
Extreme halten · Markante Tage
des Archivs in zehn Kategorien · Bundesvergleich: wo Göttingen an jedem
Archivtag unter den rund 2.200 meldenden Stationen stand, mit dem Jahresgang
daraus

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
    url-state.ts       Ansichtszustand im Query-String
    theme.ts           heller und dunkler Farbsatz
  components/
    ui.tsx             Karten, Kacheln, Filter, Tooltips, Zustände
    …                  13 Analysekomponenten
server/
  index.js             Express-Routen
  db.js                SQLite-Schema und Indizes
  dwd.js               Download und Parser der DWD-Archive
  queries.js           sämtliche Aggregationen
  stations.js          Stationsverzeichnis
  zip.js               ZIP-Leser auf node:zlib, ohne Abhängigkeit
  dashboard.js         Überblick: zieht die Startansicht zusammen
  gauges.js            Flusspegel: Abruf, Parser, eigene Zeitreihe
  germany-sources.js   bundesweiter Abruf beider DWD-Stationsnetze
  germany-csv.js       Tagesarchiv, eine CSV je Tag
  germany.js           Superlative, Stationsregister und Kartendaten
  national.js          Rang der Station unter allen DWD-Stationen
  pressure.js          Luftdruck, Sturmlagen, Bezug zum Wind
  frost.js             Spätfrostrisiko: Beginn gegen letzten Frost
  calendar-records.js  Rekorde je Kalendertag und ihre Wechsel
  distribution.js      Verteilungen dreier Referenzperioden, Kenntage
  nationwide-shape.js  die Form eines Tages über Deutschland, reine Rechnung
  nationwide-csv.js    Jahresarchiv dieser Tagesformen plus Stationsregister
  nationwide.js        Spanne, Gefälle und Extrempunkte des Landes
  regional-sources.js  amtliche DWD-Gebietsmittel
  regional.js          Gebietsmittel: Reihen und Ranglisten
  records-kinds.js     Rekordkategorien
  records-csv.js       Allzeit-Basislinie je Station
  records.js           Nachspielen des Archivs, Rekordereignisse
  air-sources.js       UBA-Luftqualität: Stationen, Grenzwerte, Abruf
  air-csv.js           Stundenarchiv, eine CSV je Tag
  air.js               Tagesgang, Jahresreihen, Überschreitungen
  odl-sources.js       BfS-Ortsdosisleistung: Sondenwahl und WFS-Abruf
  odl-csv.js           Stundenarchiv, eine CSV je Tag
  odl.js               Sondenvergleich und Verlauf
  pollen-sources.js    DWD-Pollenvorhersage: Region, Arten, Stufen
  pollen-csv.js        Ausgabenarchiv, eine CSV je Ausgabe
  pollen.js            Saisonkalender und Treffsicherheit
  pheno-sources.js     DWD-Phänologie: Stationswahl, Strom-Filter
  pheno-csv.js         Beobachtungen, Stationen, Schlüssel
  pheno.js             Jahreszeiten, Kalender, Temperaturbezug
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
- **Starkregen.** Drei Indizes: Anteil aus Tagen ab 20 mm, der WMO-Index R95p
  (Schwelle aus dem 95. Perzentil der Regentage 1961–1990) sowie RX5day, die
  höchste Summe über fünf aufeinanderfolgende Tage. Ein RX5day-Fenster zählt nur
  bei lückenlosen, calendarisch aufeinanderfolgenden Tagen.
- **Weitere Kenngrößen.** Aus den DWD-Spalten, die dieses Projekt lange
  überlesen hat. Schwellen: Schneedeckentag ab 1 cm, heiterer Tag bis 1,6
  Achtel Bedeckung, trüber Tag ab 6,4 Achteln, schwüler Tag ab 18,8 hPa
  Dampfdruck, Bodenfrosttag unter 0 °C fünf Zentimeter über Grund. Die
  90-%-Regel gilt hier **je Spalte**, nicht je Station: Göttingen misst die
  Bewölkung seit 1860, die Sonnenscheindauer erst seit 1927.
- **Extremmonate** benötigen mindestens 25 gültige Messtage.
- **Heatmap.** Jeder Monat wird gegen dieselben Kalendermonate aller anderen
  Jahre eingefärbt; die Skala läuft je Monat vom 20. bis zum 80. Perzentil.
  Monate mit weniger als 25 gültigen Tagen erhalten keinen Rang und gehen nicht
  in die Skala ein — sie werden aber schraffiert mit Wert und Abdeckung
  ausgewiesen, statt als leeres Feld zu erscheinen. Im Bestand betrifft das 32
  Monate, zuletzt Juli 2026 in Göttingen nach neun Tagen Stationsausfall.
- **Prognose.** Gemessene Tage bis zum letzten Datenbanktag; das Restjahr wird
  30-mal zu Ende gerechnet — je einmal so, wie es in jedem Jahr der
  Referenzperiode tatsächlich verlaufen ist. Ausgewiesen sind der Median dieser
  30 Ergebnisse und der Bereich vom 10. bis 90. Perzentil. Das ist eine
  Klimatologie-Fortschreibung, **keine Wettervorhersage**.
- **Klimadiagramm.** Temperatur- und Niederschlagsachse stehen im Verhältnis
  1 °C : 2 mm, damit die Walter-&-Lieth-Leseregel gilt.
- **Deutschlandwertung.** Zwei Ranglisten je Kategorie: ganz Deutschland und
  alles unterhalb 1000 m. Ohne die zweite lautete die Antwort auf „wo war es am
  kältesten" praktisch jeden Tag Zugspitze und auf „wo war es am windigsten"
  Brocken — am 30.07.2026 lag die Zugspitze im Tagesmittel 9,4 K unter der
  zweitkältesten Station. Temperatur, Wind und Spanne stammen aus dem
  Klimanetz; für den Niederschlag kommt das dichtere reine Niederschlagsnetz
  hinzu, weil Starkregen kleinräumig ist. Die Sonnenscheindauer wird
  mitgespeichert, aber nicht bewertet: der DWD misst sie nur an rund 70
  Stationen, ein zu grobes Netz für den Titel „sonnigste Station Deutschlands".
  Stationen außerhalb Deutschlands — das Niederschlagsnetz enthält vier in
  Tirol — bleiben außen vor, ebenso Tage mit weniger als 100 Stationen.
- **Karte.** Punktkarte ohne Hintergrund: bei rund 2400 Stationen zeichnet die
  Wolke den Umriss selbst, eine Kartenquelle mehr wäre eine Quelle mehr, die
  niemand geprüft hat. Projektion äquidistant zylindrisch mit cos-φ-Stauchung
  der Längenachse — auf acht Breitengraden ist der Unterschied zu einer echten
  Kegelprojektion nicht sichtbar. Die Farbskala läuft vom 2. bis zum 98.
  Perzentil des Tages; beim Niederschlag beginnt sie bei null, und trockene
  Stationen bekommen einen offenen Punkt statt der blassesten Farbe.
- **Gebietsmittel.** Für Deutschland und die Bundesländer stammen die Zahlen
  aus dem DWD-Produkt `regional_averages_DE` und werden **nicht** aus den
  Stationen dieser App gerechnet — dahinter steht eine räumliche Interpolation
  über das vollständige Messnetz. Der DWD führt dabei nicht alle sechzehn
  Länder einzeln: Berlin, Hamburg und Bremen erscheinen nur in den
  Kombinationen Brandenburg/Berlin und Niedersachsen/Hamburg/Bremen,
  Thüringen/Sachsen-Anhalt überlappt zwei einzeln geführte Länder. Die
  Kombinationen sind gekennzeichnet und dürfen nicht addiert werden. Temperatur
  und Niederschlag reichen bis 1881, Sonnenscheindauer und Kenntage bis 1951.
- **Markante Tage.** Zehn Kategorien mit absichtlich verschiedenen Maßstäben:
  der heißeste Tag entscheidet sich an einer einzelnen Station, der nasseste am
  Landesmittel, der mit der größten Spanne am Abstand zwischen wärmster und
  kältester Station. Über ein Maß sortiert käme zehnmal dieselbe Hitzewelle
  heraus. Ein Tag zählt erst ab 200 meldenden Stationen für die jeweilige
  Größe — an den Rändern des Archivs gibt es Tage mit wenigen Dutzend, und ein
  Landesmittel daraus wäre keins.
- **Allzeitrekorde.** Jede Station wird ausschließlich gegen ihre eigene
  Geschichte geprüft, nie gegen andere Stationen. Ausgewiesen sind stets der
  alte Rekord mit Datum und die Länge der Messreihe — eine Station mit
  neunzehn Jahren bricht ihren Rekord leichter als eine mit 201. Die
  Jahresangabe zählt Tage mit gültigem Messwert je Parameter, nicht die Spanne:
  Leipzig-Holzhausen misst seit 1759, hat aber 192 Jahre Messwerte. Sortiert
  wird nach Reihenlänge. Stationen ohne Historie vor dem Stichtag setzen keinen
  Rekord, sie beginnen eine Reihe. Auf der Karte sitzt jeder Rekord an seinem
  Standort, die Punktgröße folgt der Länge der gebrochenen Reihe und nicht dem
  Messwert. Dazu drei Zahlen, die die Liste nicht hergibt: betroffene
  Bundesländer, Nord-Süd- und West-Ost-Ausdehnung und die weiteste Paarung.
  Fünfhundert Stationsnamen lesen sich gleich, ob sie ein Gewitter über einem
  Landkreis oder eine Lage über dem halben Land beschreiben — 39 Rekorde von
  Hiddensee bis Rheinfelden sind ein anderes Ereignis als 39 in Oberbayern.
- **Luftqualität.** Ein Tagesmittel entsteht erst ab 18 gültigen Stunden, ein
  Jahresmittel ab 300 gültigen Tagen — bei Größen mit ausgeprägtem Tagesgang
  wäre ein Mittel über die zufällig funktionierenden Stunden kein schwaches
  Mittel, sondern ein systematisch falsches. Das höchste 8-Stunden-Mittel für
  Ozon wird über Tagesgrenzen hinweg gebildet und dem Tag zugeschlagen, in den
  seine letzte Stunde fällt — so reichen die ersten Fenster eines Tages noch in
  den Abend davor zurück, wofür der Grenzwert geschrieben ist. Ein Fenster
  zählt nur, wenn es acht aufeinanderfolgende Stunden umfasst und mindestens
  sechs davon einen Ozonwert tragen. Zeitstempel werden unverändert übernommen,
  wie das UBA sie veröffentlicht, und nicht umgerechnet.
- **Ortsdosisleistung.** Die elf Sonden werden nicht fest eingetragen, sondern
  bei jedem Lauf aus dem BfS-Bestand nach Entfernung zur DWD-Station 01691
  ausgewählt — kommt eine Sonde hinzu, wandert sie von selbst ins Archiv.
  Zeitangaben in UTC, wie das BfS sie veröffentlicht; Tagesgrenzen dieses
  Archivs sind daher UTC-Tage. Jede Sonde wird gegen ihre eigene Spanne
  gelesen, nicht gegen eine gemeinsame Skala: die Unterschiede zwischen den
  Standorten sind geologisch und würden jede gemeinsame Einfärbung dominieren.
- **Pollenflug.** Die Belastungsstufen sind Ränge, keine Messwerte — „1-2" ist
  eine eigene Kategorie zwischen „1" und „2", keine gerundete 1,5. Sie werden
  deshalb gezählt und nie gemittelt. Die Treffsicherheit der Vorhersage wird
  erst ab zehn Ausgaben ausgewiesen; darunter wäre jede Prozentzahl Theater.
- **Phänologie.** Ein Jahreswert ist das Mittel über die Stationen, die ihn
  gemeldet haben; die Zahl der Melder steht an jedem Punkt, damit ein Jahr auf
  einem einzigen Beobachter erkennbar bleibt. Der Vollfrühling ist gespleißt:
  bis 1990 führte der DWD einen unaufgeteilten „Apfel", ab 1991 getrennt nach
  früher und später Reife — zwei Reihen nebeneinander würden ein durchgehendes
  Phänomen hinter einem Buchführungswechsel verstecken. Der Spätsommer nutzt
  „Pflückreife Beginn", nicht „erste reife Früchte" wie die Wildarten. In den
  Kalender kommt nur, was mindestens 20 Jahre trägt.
- **Tagesnormale im Überblick.** Die Abweichung des letzten Messtags ist gegen
  1991–2020 gerechnet, aber nicht gegen den einzelnen Kalendertag: dreißig Werte
  eines deutschen Julitags streuen um zehn Grad, das „Übliche" schwankte damit
  stärker als die Abweichung, die es messen soll. Genommen wird ein Fenster von
  ±5 Tagen um das Datum, also 330 Werte — so verläuft das Normal glatt durchs
  Jahr, wie es auch die geglätteten Normale des DWD tun.
- **Farbkontraste.** Beide Farbsätze sind gemessen, nicht geschätzt: Textfarben
  erreichen mindestens 4,5:1 gegen die Kartenfläche, Datenfarben mindestens
  3:1. Der helle Satz ist keine aufgehellte Kopie des dunklen — ein Gold, das
  auf Schwarz leuchtet, ist auf Weiß unsichtbar —, sondern ein eigener Entwurf
  bei rund 50 % Helligkeit. Die Kartenrampen sind ebenfalls getrennt: die
  dunkle läuft in der Mitte auf 86 % Helligkeit, was auf Weiß verschwände.
- **Spätfrostrisiko.** Der Vegetationsbeginn rückt vor, der letzte
  Frühjahrsfrost bewegt sich nicht — das Fenster dazwischen wächst. Eine
  methodische Entscheidung verändert die Größe des Ergebnisses spürbar, deshalb
  stehen drei Varianten nebeneinander statt einer: die Sechs-Tage-Regel wird ab
  dem 1. Januar geprüft, sodass ein milder Jahresanfang den „Beginn" in die
  erste Januarwoche setzt — dreizehnmal in 141 Jahren, über die ganze Reihe
  verteilt. Ungefiltert wächst das Fenster von 35,5 auf 72,7 Tage (+105 %), ohne
  Januarbeginne von 32,4 auf 61,5 (+90 %), bei strengster Auswahl auf 51,1
  (+58 %). Der Befund hält in allen drei Varianten, „verdoppelt" gilt nur für
  die ungefilterte. Jahre mit negativem Fenster bleiben in der Rechnung —
  wegzulassen würde den Mittelwert nach oben verzerren.
- **Rekordalter.** Ein Rekord hat ein Datum, und dieses Datum ist eine
  Aussage: die warmen Rekorde Göttingens sind im Mittel 59 Jahre alt, die
  kalten 105 — das 1,8-fache. Dafür braucht es keine Trendgerade, keine
  Referenzperiode und keine Glättung, nur eine Subtraktion. Neben jedem
  Allzeitrekord stehen die zwölf Monatsrekorde, weil ein einzelner Allzeitwert
  ein Zufall ist und zwölf Monatswerte ein Muster. Gerechnet wird gegen den
  letzten Tag der Reihe statt gegen die Uhr, damit die vorberechneten Dateien
  nicht vom laufenden Server abweichen. Kalendertage werden über Monat und Tag
  geschlüsselt, nie über `strftime('%j')`: der 1. März ist im Schaltjahr Tag 61
  und sonst Tag 60, ein Tagesindex würde also für ein Viertel der Reihe den
  1. März mit dem 29. Februar vergleichen. Und die Spalte „Reihe seit" nennt
  den Beginn der jeweiligen Messreihe, nicht das älteste noch stehende
  Rekorddatum — Höchst- und Tiefsttemperatur werden erst seit 1885 bzw. 1871
  aufgezeichnet, Böen seit 1969.
- **Rekordkalender.** Für jeden der 366 Kalendertage eine Kachel, eingefärbt
  nach dem Jahr des Rekords. Bei der Höchsttemperatur stammen **42 %** der
  Tagesrekorde aus den letzten dreißig Jahren, bei der Tiefsttemperatur **14 %**
  — dieselbe Reihe, dieselbe Methode, gegenläufiges Bild. Der 29. Februar steht
  mit in der Liste und ist kein Fehler: er hat ein Viertel der Messungen der
  übrigen Tage, weshalb die Zahl der Messungen in jedem Kachel-Hinweis steht.
  Die Nulllinie unter dem Jahrzehnt-Diagramm ist bewusst nicht gezeichnet — die
  Erwartung ist nicht gleichverteilt, sondern fällt, weil ein spätes Jahrzehnt
  mehr frühere Werte schlagen muss als ein frühes.
- **Verteilungsverschiebung.** Jeder andere Trend hier gibt einen Mittelwert
  an. Ein Mittelwert kann steigen, weil der kalte Rand kürzer wurde, weil der
  warme Rand wuchs oder weil sich alles gemeinsam verschob — drei verschiedene
  Klimata mit derselben Kennzahl. Verglichen werden drei gleich lange
  Referenzperioden (1931–1960, 1961–1990, 1991–2020), aufgetragen als Anteile
  statt als Stückzahlen, weil die Perioden unterschiedlich viele gültige Tage
  enthalten. Für Göttingen stieg das 1. Perzentil des Tagesmittels um 3,76 K,
  der Median nur um 1,00 K — die kältesten Tage haben sich fast viermal so stark
  erwärmt wie der mittlere. Bei den Kenntagen steht neben den Werten je Jahr,
  wie oft es den Tag in der ganzen Reihe überhaupt gab: „0,0 Tropennächte je
  Jahr" heißt nicht „nie", sondern dreimal seit 1858, zuletzt 1988.
- **Luftdruck.** Die DWD-Spalte enthält **Stationsdruck, nicht auf Meereshöhe
  reduziert** — Göttingen 996,5 hPa auf 167 m, Brocken 882 auf 1141 m, Zugspitze
  706 auf 2964 m. Die geläufige Schwelle „unter 990 hPa ist ein Sturmtief" gilt
  für Meereshöhe und wäre hier falsch; statt die Werte mit einer Formel
  umzurechnen, deren Temperaturannahmen eine weitere Angriffsfläche wären,
  stammen die Grenzen aus der Reihe der Station selbst: das unterste Prozent von
  Druck und Tagesänderung. Die Tagesänderung gilt nur, wo der Vortag wirklich
  der Vortag ist — über eine Lücke hinweg wäre sie ein erfundener Sturm.
- **Deutschlandtage.** Die Spanne zwischen dem wärmsten und dem kältesten Ort
  des Landes braucht mehr Geschichte, als das eigene Tagesarchiv hergibt, und
  ein rückwirkendes Vollarchiv aller Stationen wäre über ein Gigabyte. Ein
  einmaliger Durchlauf durch die historischen DWD-Archive liest deshalb 18,5
  Millionen Einzelmessungen und behält davon **eine Zeile je Tag** — Extreme,
  Höhengradient und geografisches Gefälle, seit 1759. Jeder Tag ab dem Beginn
  des Tagesarchivs wird beim Start neu daraus gerechnet, durch dieselbe
  Funktion, sonst hätte die Reihe an der Nahtstelle einen Sprung. Beteiligt sind
  nur die Klimastationen: das Niederschlagsnetz ist viermal so groß, misst aber
  keine Temperatur. Ein Tag zählt ab 100 meldenden Stationen, was die belastbare
  Reihe 1936 beginnen lässt — eine Spanne zwischen zwei Stationen kann nur
  wachsen, wenn Stationen dazukommen, und ein dünner Tag unterschätzt sie.
  Deshalb steht die Stationszahl im selben Diagramm wie die Spanne. Jede Spanne
  gibt es zweimal: über alle Stationen hält die Zugspitze das kalte Ende an
  92 % aller Tage, womit die Zahl vor allem misst, wie hoch Deutschlands
  höchster Berg ist; unterhalb 1000 m wird daraus eine Frage über Orte, an denen
  Menschen wohnen.
- **Höhengefälle.** Temperatur gegen Stationshöhe zu regressieren ergibt über
  diese Reihe rund **−0,39 K je 100 m** — zu flach. Der Grund: Deutschlands
  Höhen liegen im Süden, und der Süden ist auch weiter vom Meer entfernt, also
  schreibt die einfache Regression der Höhe zu, was in Wahrheit Lage ist.
  Rechnet man Höhe gemeinsam mit Nord und Ost, ergibt sich **−0,55 K je 100 m**
  und die Anpassung steigt von R² 0,40 auf 0,70. Beide Zahlen werden
  ausgewiesen, denn die erste ist das, was ein Streudiagramm tatsächlich zeigt —
  sie zu verschweigen hieße, das Diagramm der danebenstehenden Zahl
  widersprechen zu lassen. An 784 von 32.780 Tagen ist der lagebereinigte
  Koeffizient positiv: eine Inversionslage, im Januar an 7,6 % der Tage, von Mai
  bis September an keinem. An manchen dieser Tage fällt das rohe Streubild
  trotzdem noch — auch das steht in der Ansicht, samt Begründung, statt zwei
  Zahlen nebeneinanderzustellen, die sich zu widersprechen scheinen.
- **Geografisches Gefälle.** Dieselbe Anpassung liefert zwei weitere
  Koeffizienten: K je 100 km nach Norden und je 100 km nach Osten, jeweils mit
  den anderen beiden festgehalten. Zusammen sind sie ein Vektor, und der dreht
  sich im Jahreslauf. Im Januar ist die Nord-Süd-Komponente mit −0,07 praktisch
  null und die Ost-West-Komponente mit −0,47 stark negativ: Deutschland ist
  dann nicht im Norden kälter, sondern im Osten. Im Juni steht es umgekehrt bei
  −0,60 und **+0,19** — der Osten ist wärmer als der Westen, an 65 % der
  Junitage gegen 13 % der Januartage. Das ist Kontinentalität, gemessen statt
  behauptet. Aufgetragen als Schleife über zwölf Monatspunkte ist der ganze
  Jahreslauf ein Bild.
- **Extrempunkte.** Weil das Archiv zu jedem Tagesextrem die Station nennt,
  sind neunzig Jahre „wo war es heute am kältesten" eine Zählaufgabe. Zwei
  Dinge müssen dabei ausgesprochen werden, sonst führt die Bestenliste in die
  Irre. Stationen öffnen und schließen: eine, die 1970 stillgelegt wurde, kann
  danach nicht mehr auftauchen, also vermischt eine Lebenszeit-Zählung Epochen —
  deshalb steht daneben, wer jedes Jahrzehnt gewonnen hat. Und die Höhe
  entscheidet das kalte Ende fast allein, weshalb die Temperaturkategorien
  dieselben zwei Auswahlen tragen wie die Spanne. Ergebnisse, die man nicht
  erwartet: der wärmste Ort des Tages ist heute am häufigsten eine
  Nordsee-Forschungsplattform, und der nasseste ist zu 4,2 % die Zugspitze.
- **Bundesvergleich.** Das Perzentil zählt Stationen unter dem Wert plus die
  Hälfte der gleichen. Diese Halbierung ist keine Pedanterie: der DWD gibt
  Temperaturen auf eine Nachkommastelle aus, an einem ruhigen Tag teilen sich
  hundert Stationen dieselbe Zahl, und zählte man sie alle als „darunter",
  stünde Göttingen beim 96. Perzentil dafür, exakt Durchschnitt zu sein.
  Luftdruck bleibt außen vor, obwohl die Spalte existiert — er wird auf
  Stationshöhe gemessen, eine bundesweite Rangliste sortierte also die Höhe.
- **Flusspegel.** Alle Werte in Zentimeter über Pegelnullpunkt. Die Achse des
  Verlaufs ist auf die Messwerte skaliert, weil die täglichen Schwankungen im
  Zentimeterbereich die eigentliche Information sind; Kennwerte und Meldestufen
  außerhalb dieses Bereichs werden mit ihrem Abstand ausgewiesen statt die
  Kurve flachzudrücken.

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

**Klimadaten:** [DWD Climate Data Center](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/),
Tageswerte (`kl`). Frei verwendbar nach GeoNutzV; Quellenangabe erforderlich.

**Luftqualität:** [Umweltbundesamt, Luftdaten-API](https://luftdaten.umweltbundesamt.de/api/air-data/v3),
Stundenwerte der Stationen DENI042 und DENI068. Der ältere Pfad unter
`umweltbundesamt.de/api/air_data/` leitet dorthin um.

**Ortsdosisleistung:** [Bundesamt für Strahlenschutz, ODL-Messnetz](https://www.imis.bfs.de/ogc/opendata/ows),
offenes WFS, Layer `opendata:odlinfo_odl_1h_latest` und
`opendata:odlinfo_timeseries_odl_1h`.

**Pollenflug:** [DWD, `s31fg.json`](https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json),
Vorhersage für 27 Regionen, täglich gegen 11:00 Uhr.

**Phänologie:** [DWD Climate Data Center, Jahresmelder](https://opendata.dwd.de/climate_environment/CDC/observations_germany/phenology/annual_reporters/),
Gruppen `wild`, `fruit` und `crops`.

### Deutschlandarchiv

Für die bundesweite Ansicht gibt es beim DWD **keine Sammeldatei**: die
Tageswerte erscheinen ausschließlich als ein ZIP je Station. `timeseries_overview`
ist ein Katalog der Reihenlängen, keine Messwerte; die abgeleiteten Produkte
unter `weather_reports` sind Strahlungsdaten. Ganz Deutschland heißt daher rund
2900 kleine Archive — bei 16 parallelen Verbindungen unter einer Minute.

| Netz | Stationen | Parameter |
|---|---|---|
| [`daily/kl`](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/recent/) | 576 | Temperatur, Wind, Niederschlag, Sonne, Bewölkung, Druck, Feuchte, Schnee |
| [`daily/more_precip`](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/more_precip/recent/) | 2319 | nur Niederschlag und Schnee |

483 Stationen liegen in beiden Netzen; dort gilt der Klimadatensatz. Ein
täglicher Workflow (`.github/workflows/deutschland.yml`) holt den Vortag und
legt ihn ab:

```
data/germany/stations.csv          Register: Name, Bundesland, Lage, Höhe
data/germany/2026/2026-07-30.csv   ein Tag, eine Zeile je Station
```

```csv
station,temp_mean,temp_max,temp_min,precipitation,wind_max,wind_mean,sunshine,cloud,pressure,humidity,snow
01691,23.9,37.6,13.4,0.6,23.2,2.7,,2.4,995.93,61.88,0
```

Ein Tag umfasst rund 2300 Stationen (53 KB, gepackt 15 KB), das Jahr also etwa
5 MB im Repository. Der Server liest das Archiv beim Start in die Datenbank.

```bash
npm run fetch:germany                 # Vortag
npm run fetch:germany 2026-07-28      # ein bestimmter Tag
npm run fetch:germany -- --backfill   # alles, was die Archive hergeben
```

`--backfill` lohnt einmalig: jedes Stationsarchiv reicht etwa 500 Tage zurück,
ein Lauf füllt also rund anderthalb Jahre auf einmal. Wie beim Pegelarchiv
braucht der Workflow kein `npm ci` — die ZIPs werden über `node:zlib` entpackt
(`server/zip.js`), geprüft byte-identisch gegen `unzipper`.

### Gebietsmittel

```bash
npm run fetch:regional
```

58 Dateien, 115.000 Werte, 38 Sekunden. Abgelegt als `data/regional/annual.csv`,
`monthly.csv` und `seasonal.csv` — eine Zeile je Gebiet, Größe, Zeitraum und
Jahr. Der tägliche Workflow ruft sie mit ab: der DWD korrigiert auch
zurückliegende Jahre, wenn sich Messnetz oder Interpolation ändern, weshalb ein
reines „schon vorhanden" nicht genügt.

### Luftqualität

```bash
npm run fetch:air -- --backfill   # einmalig, 2016 bis heute
npm run fetch:air                 # täglich, letzte sieben Tage
```

Zwei UBA-Stationen in Göttingen: **DENI042** im vorstädtischen Hintergrund
(Nohlstraße) und **DENI068** verkehrsnah (Bürgerstraße 20), 2,7 km auseinander.
Neun Messreihen, stündlich — PM₁₀, PM₂٫₅, O₃, NO₂, SO₂ am Hintergrund, PM₁₀,
PM₂٫₅, NO₂ und CO als 8-Stunden-Mittel am Verkehr. Der Backfill holt 753.563
Werte in 3836 Tagesdateien (4,4 MB) in gut 40 Sekunden.

Zwei Eigenheiten der Quelle bestimmen den Zuschnitt. Erstens liefert die
Schnittstelle **nichts vor 2016**, ungeachtet dessen, was die
Stationsbeschreibung über das Baujahr sagt — deshalb wird archiviert, was
geholt wurde. Zweitens gibt es für **Ozon und Stickstoffdioxid überhaupt kein
Tagesmittel**, nur Stundenwerte und Tagesmaxima; jede Tagesangabe dazu ist hier
selbst gerechnet.

Der tägliche Lauf liest sieben Tage zurück statt nur den Vortag, weil das UBA
Stundenwerte nachträglich prüft und korrigiert. Tage ohne inhaltliche Änderung
erzeugen eine byte-identische Datei und damit keinen Commit.

Die Abdeckung ist nicht überall gleich: SO₂ liegt nur für 40 % der Stunden vor,
alle übrigen Größen für 95 bis 100 %. Die Oberfläche weist das je Größe aus,
statt eine dünn belegte Reihe wie eine dichte aussehen zu lassen.

### Ortsdosisleistung

```bash
npm run fetch:odl     # täglich; einen Backfill gibt es nicht
```

Elf BfS-Sonden im 25-km-Umkreis der DWD-Station, ausgewählt aus rund 1700
bundesweiten nach Entfernung. Zwei davon stehen praktisch am selben Ort:
**Göttingen DWD** 100 m von der Wetterstation entfernt auf 168 m, **Göttingen**
1,8 km weiter auf 150 m.

Der entscheidende Unterschied zu allen anderen Quellen hier: **das BfS hält
sieben Tage vor.** Was älter ist, gibt es nicht mehr — ein versäumter Tag ist
dauerhaft verloren. Umgekehrt kostet ein einzelner Fehlschlag nichts, weil der
nächste Lauf das ganze Fenster erneut sieht und die Lücke schließt.

Abgelegt als `data/odl/probes.csv` (Register) und `data/odl/2026/2026-08-02.csv`
mit `probe,hour,value` — 264 Zeilen am Tag, gut 4 kB.

Die Sonden unterscheiden sich um rund die Hälfte, von 0,114 bis 0,156 µSv/h im
Mittel. Das ist fast vollständig der terrestrische Anteil (0,072 bis 0,110); der
kosmische liegt bei allen elf zwischen 0,044 und 0,046 µSv/h, denn über 175
Höhenmeter ist der Höheneffekt bei drei Nachkommastellen nicht zu sehen.

### Pollenflug

```bash
npm run fetch:pollen  # täglich; einen Backfill gibt es nicht
```

Der DWD veröffentlicht jeden Vormittag `s31fg.json` für ganz Deutschland — acht
Pollenarten, sieben Belastungsstufen, drei Tage, 27 Regionen — und ersetzt die
Datei am nächsten Morgen. Ein Archiv gibt es nicht.

Göttingen liegt in Region 30 „Niedersachsen und Bremen". Deren Teilung in einen
westlichen und einen östlichen Teil benennt der DWD in den Daten nicht;
Göttingen liegt im Südosten, also im östlichen Teil. **Mitgeschrieben werden
beide**, damit die Zuordnung umkehrbar bleibt — das kostet acht Zeilen am Tag.

Alle drei Vorhersagehorizonte werden festgehalten, nicht nur der laufende Tag.
Damit lässt sich später eine Frage beantworten, die die DWD-Datei selbst nicht
beantworten kann: wie gut das, was zwei Tage im Voraus gesagt wurde, zu dem
passt, was am Tag selbst galt.

### Phänologie

```bash
npm run fetch:phenology          # einmalig, rund vier Minuten
npm run fetch:phenology wild     # eine Gruppe allein
```

Der phänologische Datenbestand des DWD ist der einzige, der nicht das Wetter
misst, sondern seine Wirkung: den Tag, an dem eine Hasel blühte, ein Apfel
pflückreif war, eine Eiche ihr Laub abwarf.

Der Abruf ist unangenehm, aber einmalig. Die Dateien sind auf feste Breite mit
Leerzeichen aufgefüllt und liegen in **drei Ständen je Art** vor (2018, 2019,
2024); nur der jüngste wird gelesen. Selbst dann sind es 2,9 GB über 63 Dateien
in drei Gruppen. Nichts davon landet auf der Platte — jede Datei wird im Strom
gelesen und zeilenweise verworfen, übrig bleiben **32.964 Beobachtungen** in
`data/pheno/observations.csv`, gut 1 MB.

Das Ergebnis ist eindeutig, und zwar in beide Richtungen:

| Jahreszeit | Zeigerphase | Trend/Jahrzehnt | erste 10 J. → letzte 10 J. |
|---|---|---:|---:|
| Vorfrühling | Hasel, Blüte Beginn | −2,3 d | 1. März → 23. Feb. |
| Vollfrühling | Apfel, Blüte Beginn | −2,0 d | 6. Mai → 26. Apr. |
| Frühsommer | Holunder, Blüte Beginn | −2,3 d | 8. Juni → 27. Mai |
| Spätherbst | Stiel-Eiche, Blattverfärbung | +1,9 d | 10. Okt. → 26. Okt. |
| Winter | Stiel-Eiche, Blattfall | +3,4 d | 24. Okt. → 10. Nov. |

Die Vegetationszeit hat sich also an beiden Enden gedehnt. Und der Vorfrühling
folgt der Mitteltemperatur von Januar und Februar mit **−6,3 Tagen je Grad bei
R² 0,68** über 66 Jahre — gemessen von zwei Quellen, die nichts voneinander
wissen.

**Diese Reihe wächst nicht mehr.** Von 46 Meldestationen im Umkreis haben nur 14
je gemeldet, die meisten hörten vor Jahrzehnten auf; die Station an der
Wetterstation selbst endet 2015, nur eine reicht bis 2023. Die aktuellen
`recent`-Dateien liefern für diesen Umkreis vier Beobachtungen in zwei Jahren.
Der Sammler steht deshalb nicht im täglichen Workflow — ein erneuter Lauf lohnt
nur, wenn der DWD die historischen Dateien überarbeitet.

### Allzeitrekorde

Für die Rekorde reichen die 500 Tage nicht; dafür stehen die vollständigen
Reihen in `daily/kl/historical/` — 1285 Archive, 360 MB. Der Abruf ist trotzdem
einmalig:

```bash
npm run fetch:records
```

Der Lauf liest alle Archive (rund 140 Sekunden) und behält davon nur je Station
und Kategorie den Extremwert, sein Datum und die Reihenlänge:
`data/germany/records-baseline.csv`, 6213 Zeilen, 308 KB. Stichtag ist der
erste Tag des Tagesarchivs; historische und rollierende Archive überlappen sich
um elf Monate, die Reihe hat also keine Lücke.

Alles nach dem Stichtag spielt der Server beim Start aus dem Tagesarchiv nach —
Tag für Tag, in der richtigen Reihenfolge, sodass ein Wert nur zählt, wenn er
schlägt, was **vor** ihm stand. Damit liegen die Rekordmeldungen rückwirkend
für den gesamten Archivzeitraum vor und nicht erst ab Inbetriebnahme. Der
tägliche Workflow braucht dafür keinen Zusatzschritt.

**Flusspegel:** zwei Quellen, weil die Pegel an unterschiedlichen Gewässern
liegen.

| Pegel | Gewässer | Quelle | Verfügbarkeit |
|---|---|---|---|
| Wahmbeck | Weser | [PEGELONLINE der WSV](https://pegelonline.wsv.de/webservice/dokuRestapi) | offene REST-Schnittstelle, rollierend 30 Tage im 15-Minuten-Takt |
| Göttingen | Leine | [NLWKN Pegelonline](https://www.pegelonline.nlwkn.niedersachsen.de/Pegel/Binnenpegel/ID/280) | nur aktueller Wert, keine Zeitreihe |
| Northeim | Rhume | [NLWKN Pegelonline](https://www.pegelonline.nlwkn.niedersachsen.de/Pegel/Binnenpegel/ID/454) | nur aktueller Wert, keine Zeitreihe |

Die Weser ist Bundeswasserstraße und deshalb bei der WSV geführt; Leine und
Rhume sind Landesgewässer. Das NLWKN-Portal rendert serverseitig, weshalb der
aktuelle Wert samt Meldestufen und Kennwerten aus der Seite gelesen wird — eine
dokumentierte Schnittstelle gibt es dort nicht. **Für diese beiden Pegel legt
die App jeden Abruf in der Datenbank ab und baut ihre Zeitreihe damit selbst
auf.** Meldestufen, Hauptwerte und Extremwerte stammen für alle drei Pegel vom
NLWKN.

### Pegelarchiv

Weil die Quellen keine Historie herausgeben, sammelt das Projekt sie selbst.
Ein stündlicher GitHub-Workflow (`.github/workflows/pegel.yml`) ruft die
aktuellen Werte ab und hängt sie an eine CSV je Pegel unter `data/gauges/` an:

```
data/gauges/leine-goettingen.csv
data/gauges/rhume-northeim.csv
data/gauges/weser-wahmbeck.csv
```

```csv
timestamp,value_cm
2026-07-31T22:15:00+02:00,35
```

Der Server liest dieses Archiv beim Start in die Datenbank ein — ein frischer
Klon hat die gesammelte Historie also sofort im Diagramm. Manuell:

```bash
npm run fetch:gauges
```

Drei Eigenschaften, die den Lauf robust halten:

- **Keine Abhängigkeiten.** Das Skript nutzt nur die Node-Standardbibliothek,
  der Workflow braucht daher kein `npm ci` und keinen nativen Build von
  better-sqlite3. Ein Lauf dauert Sekunden.
- **Append-only.** Geschrieben werden ausschließlich Messwerte, die neuer sind
  als der letzte Eintrag. Das hält die git-Diffs klein — bei stündlichen
  Commits ist das der Unterschied zwischen wenigen Zeilen und einem neuen Blob
  pro Lauf.
- **Teiltoleranz.** Fällt ein Portal aus, werden die übrigen Pegel trotzdem
  gespeichert. Der Lauf scheitert nur, wenn keine einzige Quelle erreichbar ist.

Zwei Dinge, die man über geplante Workflows wissen sollte: Sie laufen nur auf
dem **Standard-Branch**, und GitHub deaktiviert sie in öffentlichen
Repositories nach 60 Tagen ohne Aktivität. Da der Workflow selbst committet,
hält er sich in der Regel am Leben.

Historische Pegelzeitreihen sind online nirgends frei abrufbar. Die Daten
existieren (Leine ab 1958, Weser ab 1973, Rhume ab 1993), werden aber nur auf
Anfrage bei der NLWKN-Daten-Servicestelle abgegeben. Alle Pegelangaben ohne
Gewähr.
