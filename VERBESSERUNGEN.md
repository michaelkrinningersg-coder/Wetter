# 30 Verbesserungsvorschläge

Priorisiert nach Verhältnis von Nutzen zu Aufwand. Alle Zahlenangaben sind an
der Station Göttingen (01691, 59.901 Messtage, 1858–2026) nachgerechnet.

**Aufwand:** S = unter einem Tag · M = ein bis drei Tage · L = mehr

> **Stand:** Abschnitt A ist **vollständig umgesetzt** (Punkte 1–10), erkennbar
> am Vermerk ✅ **Umgesetzt**. Die 20 Punkte der Abschnitte B–E sind weiterhin
> offene Vorschläge.

---

## A · Inhalt und Fachlichkeit

### 1. Kenntage auf die DWD-Definition umstellen — `>` statt `≥` [S] · ✅ Umgesetzt

Die Schwellenwerttage werden mit `temp_max > 30` gezählt. Der DWD definiert
einen heißen Tag als **Tmax ≥ 30,0 °C**. Ein Tag mit exakt 30,0 °C fällt
derzeit heraus:

| Kenngröße | aktuell (`>`) | DWD (`≥`) | Differenz |
|---|---:|---:|---:|
| Heiße Tage | 772 | 812 | **+40** |
| Sommertage | 4.242 | 4.386 | **+144** |

Bei Frost- und Eistagen (`<  0`) ist die Definition dagegen korrekt.

*Umgesetzt:* Alle Schwellen sind auf die DWD-Definition umgestellt; die
Jahresübersicht heißt die Spalten jetzt nach den Kenntagen („Heiße Tage",
„Sommertage") statt nach der Rechenvorschrift.

### 2. Tropennächte ergänzen (Tmin ≥ 20 °C) [S] · ✅ Umgesetzt

Fehlt vollständig, obwohl die Kategorie in den Spitzenwerten schon
„Wärmste Nächte (Tropennacht)" heißt. In 168 Jahren gibt es in Göttingen
**genau drei** — eine bemerkenswert klare Aussage, die die App bislang
verschenkte.

*Umgesetzt:* eigene Spalte in der Jahresübersicht.

### 3. Eistage als eigene Spalte (Tmax < 0 °C) [S] · ✅ Umgesetzt

**2.487 Tage** im Bestand. Die Jahresübersicht zeigte „Mittel < 0 °C", was
etwas anderes ist. Eistage sind die etablierte Kenngröße für Winterstrenge.

*Umgesetzt:* eigene Spalte; „Mittel < 0 °C" bleibt zusätzlich erhalten.

### 4. Warming Stripes [S] · ✅ Umgesetzt

Ein Streifen je Jahr, eingefärbt nach Anomalie — die bekannteste
Klimavisualisierung überhaupt.

*Umgesetzt:* im Bereich Jahresmittelwerte, ohne Achsen und Gitter, weil es um
den Gesamteindruck geht und nicht um Einzeljahre. Die Farbskala ist bei ±1,5 °C
gekappt, damit einzelne Ausreißer nicht alles andere in denselben Ton drücken,
und folgt derselben Regel wie die Heatmap (fester Farbton je Hälfte, Sättigung
trägt den Betrag) — beide lesen sich dadurch als ein System.

### 5. Gleitendes 30-Jahres-Mittel statt nur Regressionsgerade [M] · ✅ Umgesetzt

Eine einzige Gerade über 168 Jahre unterstellt lineare Erwärmung. Die ist aber
nicht linear: Bis etwa 1980 passiert wenig, danach wird es steil. Ein
gleitendes 30-Jahres-Mittel zeigt genau das — und ist die Darstellung, die
Klimadienste tatsächlich verwenden.

*Umgesetzt:* in Temperatur- und Niederschlagstrend als kräftige Kurve; die
Regressionsgerade bleibt gestrichelt zum Vergleich. Das Mittel ist zentriert
und endet daher bewusst 15 Jahre vor dem Reihenende — für den letzten Wert
gibt es kein ehrliches zentriertes 30-Jahres-Fenster. Berechnet wird es über
die **ungefilterte** Reihe, damit der Zeitraumfilter die Kurve nicht an beiden
Enden abschneidet.

### 6. Trendstärke beziffern statt nur zeichnen [M] · ✅ Umgesetzt

Es stand eine Gerade im Chart, ohne Aussage, wie belastbar sie ist. Die Kachel
„Klimaerwärmung +1,84 °C" lud damit zur Überinterpretation ein — je nach
gewähltem Fenster fiel sie deutlich anders aus.

*Umgesetzt:* Die Kachel nennt jetzt den **Trend je Jahrzehnt** — die
zitierfähige Größe — mit Standardfehler, Bestimmtheitsmaß und einer expliziten
Signifikanzaussage. Im Diagramm liegt ein 95-%-Konfidenzband um die Gerade, das
zur Mitte hin schmal und an den Rändern breit ist. Für Göttingen, letzte 100
Jahre: **+0,18 °C je Jahrzehnt, ± 0,03, R² 0,33, statistisch signifikant**.

### 7. Hitzewellen und Trockenperioden [M] · ✅ Umgesetzt

Längste Serie ohne messbaren Niederschlag, längste Serie über 30 °C, längste
Frostperiode. Das ist die Frage, die Menschen an eine Klimadatenbank
tatsächlich stellen. Bislang gab es nur Einzeltage, keine Serien.

*Umgesetzt:* neuer Bereich **Perioden & Serien** mit sechs Kategorien (Hitze,
Sommer, Trockenheit, Niederschlag, Frost, Dauerfrost), Rangliste der längsten
Serien und Häufigkeit je Jahrzehnt. Ein fehlender Messwert oder eine Lücke im
Datenbestand beendet eine Serie, statt sie zu verlängern.

Erste Ergebnisse für Göttingen: längste Hitzeperiode **13 Tage
(1.–13. August 2003)**, gefolgt von 12 Tagen 2018. Hitzeperioden je Jahrzehnt:
**6 in den 1900ern gegenüber 13 in den 2010ern**. Längste Trockenperiode:
**66 Tage (16. August – 20. Oktober 1959)**.

### 8. Prognose als Unsicherheitsband statt Punktwert [M] · ✅ Umgesetzt

Der Prognose-Tab nannte einen einzelnen Wert auf zwei Nachkommastellen — eine
Genauigkeit, die die Methode nicht hergibt.

*Umgesetzt:* Das Restjahr wird **30-mal zu Ende gerechnet** — je einmal so, wie
es in jedem Jahr der Referenzperiode tatsächlich verlaufen ist. Angegeben ist
der Median dieser 30 Ergebnisse, dazu der wahrscheinliche Bereich vom 10. bis
90. Perzentil. Für Göttingen 2026: **10,0 °C, Bereich 9,5 – 10,5 °C**
(Niederschlag 580 mm, Bereich 525 – 677 mm). Im Verlaufsdiagramm ersetzt das
Perzentilband die beiden Extremjahre; es ist während des gemessenen Zeitraums
null breit und öffnet sich erst im Prognoseteil.

### 9. Vegetationsperiode und Wachstumsgradtage [M] · ✅ Umgesetzt

Beginn und Ende der thermischen Vegetationsperiode und die Gradtagsumme. Für
Garten, Landwirtschaft und Imkerei die praktisch relevanteste Auswertung.

*Umgesetzt:* neuer Bereich **Vegetationsperiode**. Beginn ist der erste Tag
einer Serie von sechs Tagen mit einem Tagesmittel ab 5 °C, Ende der Tag vor der
ersten solchen Serie darunter nach dem 1. Juli (die Juli-Sperre verhindert, dass
ein Kälteeinbruch im Mai die Saison schließt). Wachstumsgradtage summieren
max(0, Tmittel − 5 °C) über das Jahr.

Ergebnis für Göttingen (1996–2025 gegenüber 1859–1888): Die Periode ist
**38 Tage länger** (276 statt 238), beginnt **22 Tage früher** (17. Februar) und
endet **16 Tage später** (19. November); die Wachstumsgradtage steigen um
**328 Kd auf 2.120**.

### 10. Homogenitätshinweis für lange Reihen [S] · ✅ Umgesetzt

Messstationen werden verlegt, Messgeräte und Ablesezeiten ändern sich. Eine
Reihe ab 1858 ungebrochen zu zeigen, suggeriert eine Vergleichbarkeit, die so
nicht gegeben ist.

*Umgesetzt:* ausklappbarer Hinweis in allen Langzeitansichten. Statt eines
allgemeinen Haftungssatzes zieht er die Zahlen aus der Datenbank (neuer
Endpunkt `/api/weather/coverage`) — ab wann welche Größe gemessen wurde und
welche Jahrzehnte unter 90 % Abdeckung liegen. Für Göttingen macht das
konkret sichtbar: Temperatur und Niederschlag ab 1858, **Tagesminimum erst ab
1871, Tagesmaximum ab 1885, Wind erst ab 1969** (34,8 % der Reihe). Damit wird
aus „Vorsicht bei alten Daten" etwas Nachprüfbares.

---

## B · Bedienung und Interaktion

### 11. Zustand in die URL legen [S] — größter UX-Gewinn im Verhältnis zum Aufwand

Aktuell liegt alles im React-State: Der Browser-Zurück-Button verlässt die App,
nichts lässt sich verlinken oder als Lesezeichen ablegen, ein Reload landet
wieder bei „Monatsübersicht Juli". Bereich, Station, Jahr und Monat gehören in
die URL — `?tab=heatmap&station=00722`.

### 12. Stationen direkt vergleichen [M]

Drei Stationen von 167 m bis 2.964 m sind auswählbar, aber immer nur einzeln.
Dabei ist der Höhenvergleich der eigentliche Erkenntnisgewinn. Zwei Reihen im
selben Chart wären in den Trend-Tabs eine kleine Ergänzung mit großer Wirkung.

### 13. Vergleichsjahr überlagern [M]

Im Tagesverlauf ein zweites Jahr als blasse Linie einblenden („2003
vergleichen"). Ohne Referenz sagt ein Monatsverlauf für sich genommen wenig
aus.

### 14. Zoom und Bereichsauswahl in den Langzeitcharts [S]

168 Jahre auf etwa 1.100 px Chartbreite sind rund 6 px pro Jahr. Die
Zeitraumfilter helfen nur in festen Stufen. Ein Brush-Element unter dem Chart
erlaubt beliebige Ausschnitte — bei Recharts eine einzelne Komponente.

### 15. Datenexport als CSV und JSON [S]

Eine Klimadatenbank ohne Exportfunktion ist eine Sackgasse. Je Ansicht ein
Download-Button; serverseitig ist es dieselbe Abfrage mit anderem
Ausgabeformat.

### 16. Diagramme als Bild teilen [M]

PNG- oder SVG-Export mit Stationsname, Zeitraum und Quellenangabe im Bild.
Klimadiagramme werden geteilt — ohne diese Angaben sind sie wertlos.

### 17. Globale Suche / Befehlspalette [M]

Ein Feld für „1947", „heißester Tag", „Brocken Januar" springt direkt zum
Ergebnis. Bei zwölf Bereichen mit je eigenen Filtern spart das den größten Teil
der Klickwege.

### 18. Spaltenauswahl in der Jahresübersicht [S]

14 Spalten erzwingen horizontales Scrollen; die Jahresspalte klebt links fest,
alles andere verschwindet. Wer nur Temperatur und Niederschlag sehen will,
sollte den Rest ausblenden können. Auswahl in `localStorage` merken.

### 19. Skeletons statt Spinner, und echter Import-Fortschritt [S]

Jeder Tab zeigt einen zentrierten Spinner; beim Eintreffen der Daten springt
das Layout. Skeletons in der Zielform halten die Seite ruhig. Der Import meldet
„Bitte warten…" ohne Fortschritt — dabei ist die Zeilenzahl serverseitig
bekannt und ließe sich als Fortschritt melden.

---

## C · Gestaltung

### 20. Einstiegsseite mit den Kernaussagen [M]

Die App startet direkt in der Monatsübersicht — einer Detailansicht. Eine
Übersichtsseite mit fünf Zahlen (Jahresmittel gegen Klimareferenz, wärmstes
Jahr, Erwärmung pro Dekade, Stand des laufenden Jahres, Warming Stripes)
beantwortet die Hauptfrage sofort, statt sie im vierten Tab zu verstecken.

### 21. Light-Mode [M]

Die App ist fest auf Dunkel gebaut. Für ein Datenprojekt, dessen Diagramme
ausgedruckt und in Präsentationen übernommen werden, ist ein helles Thema
weniger Kür als Grundausstattung. Die Tokens in `index.css` sind dafür bereits
vorbereitet — nötig ist ein zweiter Wertesatz, keine Umstrukturierung.

### 22. Dichte-Umschalter für Tabellen [S]

Die Jahresübersicht hat 126 Zeilen, die Jahreswerte-Tabelle 150. Eine kompakte
Variante zeigt gut die Hälfte mehr auf einen Blick.

### 23. Heatmap zusätzlich ohne Farbe lesbar machen [S]

Die Skala trägt die Information allein über Farbe. Blau/Rot ist für die
häufigen Rot-Grün-Schwächen zwar günstiger als andere Paletten, aber
Helligkeitsabstufung oder ein optionaler Rang-Modus (nur Zahlen, keine Fläche)
macht die Darstellung unabhängig davon.

### 24. Druckansicht [S]

Klimadaten werden ausgedruckt und in Berichte übernommen. Ein Print-Stylesheet
(Navigation aus, Charts auf Seitenbreite, Quellenangabe in die Fußzeile) ist
wenig Arbeit und macht jede Ansicht zitierfähig.

---

## D · Datenumfang

### 25. Die ungenutzten DWD-Spalten importieren [M] — größter inhaltlicher Hebel

Das DWD-Tagesarchiv liefert 16 Messgrößen. Importiert werden **sieben**. Die
Belegung der ignorierten Spalten (gemessen über alle 60.240 Zeilen):

| Spalte | Bedeutung | belegt |
|---|---|---:|
| `RSKF` | Niederschlagsform (Regen/Schnee) | 99,6 % |
| `UPM` | Relative Luftfeuchte | 96,7 % |
| `NM` | Bedeckungsgrad | 95,4 % |
| `VPM` | Dampfdruck | 93,5 % |
| `SHK_TAG` | Schneehöhe | 90,5 % |
| `SDK` | Sonnenscheindauer | 54,7 % |
| `TGK` | Erdbodenminimum | 48,8 % |

Fünf dieser Spalten sind zu über 90 % belegt und werden verworfen. Damit wären
sofort möglich: **Schneedeckentage und ihr Rückgang** (die anschaulichste
Klimawandelreihe überhaupt), Sonnenstunden je Monat, Schwüle-Auswertungen und
Spätfrostrisiko über das Erdbodenminimum. Der Aufwand beschränkt sich auf
Spalten im Schema, im Parser und in den Aggregationen — Import und Oberfläche
bleiben unverändert.

### 26. Freie Stationswahl statt drei fest eingetragener [M]

Der DWD veröffentlicht Tageswerte für über tausend Stationen. Die Stationsliste
ist im Code hinterlegt; sie ließe sich aus dem Verzeichnis
`KL_Tageswerte_Beschreibung_Stationen.txt` aufbauen — mit Suche nach Name oder
Postleitzahl. Aus einer App für drei Orte wird damit eine für ganz Deutschland.

### 27. Qualitätsniveau QN_3 / QN_4 auswerten [S]

Beide Spalten sind vollständig belegt und beschreiben die Prüfstufe der
Messwerte. Aktuell werden ungeprüfte und vollständig geprüfte Werte
gleichbehandelt. Zumindest als Hinweis auf Tagesebene — oder als Filter für die
Rekordlisten, damit ein Rekord nicht auf einem ungeprüften Wert steht.

---

## E · Technik und Betrieb

### 28. Code-Splitting je Analysebereich [S]

Das Bundle liegt bei 657 kB (190 kB gzip), im Wesentlichen Recharts. Wer nur
die Monatsübersicht ansieht, lädt trotzdem alles. `React.lazy` je Tab ist
minimaler Aufwand.

### 29. Aggregationen serverseitig zwischenspeichern [S]

Die Heatmap liefert 172 kB und rechnet 1.874 Monatsmittel samt Rangfolge bei
jedem Aufruf neu. Die Daten ändern sich nur beim Import — ein Cache, der bei
Import verworfen wird, macht jeden Tabwechsel unmittelbar.

### 30. Tests und automatischer Tagesimport [M]

Parser und Aggregationen sind reine Funktionen auf SQLite und damit gut
testbar; ein Testfall über einen bekannten Monat hätte den Prognosefehler aus
`ANALYSE.md` sofort sichtbar gemacht. Dazu ein täglicher Cron-Import — der DWD
aktualisiert das „recent"-Archiv täglich, aktuell muss jemand manuell auf
„Synchronisieren" klicken.

---

## Wenn nur Zeit für fünf bleibt

| | Vorschlag | Warum |
|---|---|---|
| 1 | **#11 URL-Zustand** | Behebt Zurück-Button, Verlinkbarkeit und Reload auf einmal |
| 2 | **#4 Warming Stripes** | Größte Wirkung pro Aufwand, Daten liegen fertig vor |
| 3 | **#25 Ungenutzte Spalten** | Schneedeckentage und Sonnenstunden ohne neue Datenquelle |
| 4 | **#1 + #2 Kenntage** | Zahlen stimmen dann mit dem überein, worauf sich die App beruft |
| 5 | **#20 Einstiegsseite** | Beantwortet die Hauptfrage sofort statt im vierten Tab |
