# Ideen

Was noch nicht umgesetzt ist, warum es interessant wäre und woran es hängt.
Umgesetztes wandert aus dieser Datei heraus und in die README, wo es unter
„Was die Auswertungen tun" beschrieben steht.

---

## Datengrenzen, die jede Idee betreffen

Bevor eine Idee bewertet werden kann, muss klar sein, was überhaupt vorliegt.
Diese vier Reichweiten entscheiden über fast jede Frage:

| Quelle | Umfang | Grenze |
| --- | --- | --- |
| `daily` | 01.01.1858 – heute, 152.587 Tage, 3 Stationen | die lange Reihe, aber nur Göttingen und Umgebung |
| `germany_daily` | **ab 27.01.2025**, 2.363 Stationen, 1,28 Mio. Zeilen | wächst täglich, reicht aber nicht in die Vergangenheit |
| `regional_values` | 1881 – 2026, DWD-Gebietsmittel je Bundesland | Flächenmittel, keine Stationen — kein Tageswert, nur Monat/Jahreszeit/Jahr |
| `record_events` | ab 17.04.2025, 895 Ereignisse | beginnt mit dem Nachspielen des Archivs, nicht mit der Messreihe |
| `nationwide_daily` | 1759 – heute, 93.476 Tage | nur die *Form* jedes Tages, keine Einzelwerte; belastbar ab 1936 |

Die wichtigste davon ist die zweite: **das bundesweite Stationsarchiv ist
anderthalb Jahre alt.** Jede Idee, die „gestern gegen 1881" fragt, muss
entweder über die Gebietsmittel laufen oder auf Göttingen beschränkt bleiben.
Das ist keine Nachlässigkeit, sondern die Bauart — das Archiv entsteht durch
tägliches Mitschreiben, weil der DWD die Tageswerte aller Stationen nicht als
fertiges Paket anbietet.

---

## Roadmap

Die Reihenfolge ist gesetzt. Die laufenden Nummern sind die aus der
Ideenliste, aus der ausgewählt wurde — sie sind nicht fortlaufend, weil zwei
Ideen zurückgestellt wurden (siehe unten).

| # | Idee | Quelle | Stand |
| --- | --- | --- | --- |
| 2 | Rekordkarte des Tages | `record_events` | **fertig** |
| 3 | Die Spanne des Tages | `nationwide_daily` | **fertig** |
| 4 | Höhenprofil des Tages | `nationwide_daily` | **fertig** |
| 5 | Nord-Süd- und West-Ost-Gefälle | `nationwide_daily` | **fertig** |
| 6 | Deutschlands Extrempunkte | `nationwide_daily` | **fertig** |
| 8 | Wie alt ist jeder Rekord | `daily` | **fertig** |
| 9 | Rekordkalender: 366 Kacheln | `daily` | **fertig** |
| 11 | Rekordjahrgänge | `daily` | **fertig** |
| 12 | Überlebenskurve eines Rekords | `daily` | **fertig** |
| 13 | Bundesweite Rekordbilanz seit 1881 | `regional_values` | **fertig** |
| 10 | Fast-Rekorde | `daily` | **fertig** |
| 14 | Wetterzwillinge (Aussage auch ins Dashboard) | `daily` | **fertig** |
| 15 | Jahres-Wrapped: zehn markante Tage je Jahr | `daily` | **fertig** |
| 16 | Kuriositätenkabinett | `daily` | **fertig** |
| 17 | Episoden statt Tage | `daily` | **fertig** |
| 18 | Serien-Ticker | `daily` | **fertig** |
| 19 | Monatsbilanz live | `daily` | offen |
| 20 | Newsroom: automatische Meldungen | alle | offen |

### Was die einzelnen Punkte vorhaben

**19 — Monatsbilanz live.** Rang des laufenden Monats unter allen Ausgaben
desselben Monats, mit Angabe, wie viel sich bis Monatsende noch verschieben
kann. Am 2. eine schwache Aussage, am 28. eine starke — und das sollte
dabeistehen.

**20 — Newsroom.** Ein Regelwerk, das täglich prüft, ob etwas berichtenswert
war — Rekord, Fast-Rekord, Serie, Rang, ungewöhnliche Spanne — und daraus
Sätze formuliert. Deterministisch, aus Satzbausteinen; kein Sprachmodell im
Auslieferungspfad, sonst wäre die Seite nicht mehr statisch vorberechenbar.
Muss auch „gestern war nichts Besonderes" sagen können und das begründen.

---

## Zurückgestellt

**1 — Anomaliekarte statt Absolutkarte.** Dieselbe Deutschlandkarte, aber jede
Station gegen ihr eigenes Klimamittel: nicht „18 °C in Hamburg, 24 °C in
Freiburg", sondern „+4 K und −1 K". Das ist die Karte, die man eigentlich
lesen will — die absolute zeigt vor allem Geografie. Hängt daran, dass
Stationsmittel der Periode 1991–2020 für alle 2.363 Stationen beschafft werden
müssten; ob der DWD sie in dieser Vollständigkeit veröffentlicht, ist ungeprüft.

**7 — Zeitraffer der Karte.** Ein Schieberegler über mehrere Tage, damit man
eine Hitzewelle über Deutschland ziehen sieht. Technisch die vorhandene Karte
plus Vorladen mehrerer Tage; der Reiz liegt darin, dass Wetter erst in der
Bewegung erzählt. Zurückgestellt, weil es je Tag eine eigene vorberechnete
JSON-Datei braucht und die Anzahl der Dateien auf den Pages-Build durchschlägt.

---

## Ältere offene Punkte

**Tests.** Der wichtigste Punkt der Datei. Inzwischen über 4.000 Zeilen
Serverrechnung ohne einen einzigen Test. Kandidaten mit echter Fallhöhe: die
Midrank-Perzentilformel im Bundesvergleich, die Acht-Stunden-Mittel der
Luftqualität über Tagesgrenzen hinweg, das Nachspielen des Rekordarchivs, die
Quantilinterpolation der Verteilungsverschiebung, der Streaming-Filter der
Phänologiedateien.

**Export.** CSV und JSON zu jeder Tabelle und jedem Diagramm. Die Daten sind
frei verwendbar (GeoNutzV), die Oberfläche gibt sie aber nur zum Ansehen her.

**Zoom in Diagrammen.** Bei 168 Jahren auf 900 Pixeln ist ein Jahrzehnt drei
Pixel breit. Auswahlrechteck mit Zurücksetzen.

**Vergleichsjahr als Überlagerung.** Ein zweites Jahr in dieselbe Achse legen,
statt zwischen zwei Ansichten zu wechseln.

**Befehlspalette.** 34 Reiter sind über die Seitenleiste erreichbar, aber
nicht durchsuchbar. Strg+K mit Volltextsuche über Reiternamen und Kennzahlen.

**Spaltenauswahl in den Tabellen.** Monats- und Jahresübersicht zeigen einen
festen Satz Spalten; welche davon interessieren, ist Geschmackssache.

**Heiz- und Kühlgradtage.** Die klassische energetische Kennzahl, aus
`daily` sofort zu rechnen, bisher nur als Idee notiert.

**Wiederkehrperiode.** Extremwertstatistik: wie selten ist ein Ereignis
wirklich. Braucht eine Verteilungsanpassung (GEV) und eine ehrliche Angabe des
Vertrauensbereichs — sonst entsteht der Eindruck von Präzision, die die Reihe
nicht hergibt.

**Tages-Anomaliekalender.** Ein Jahr als 365 Kacheln, eingefärbt nach dem
Abstand zum Kalendertagsmittel. Die Heatmap gibt es auf Monatsebene, auf
Tagesebene wäre sie feiner.
