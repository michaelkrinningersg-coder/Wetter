# 10 weitere Vorschläge — zur Entscheidung

Zweite Runde, keine Überschneidung mit den 30 Vorschlägen in
[VERBESSERUNGEN.md](VERBESSERUNGEN.md).

Alle Zahlen sind an der Station Göttingen (01691) gegen die Datenbank
gerechnet, nicht geschätzt. Wo ich einen Wert nicht belegen kann, steht das
ausdrücklich dabei.

**Jeder Vorschlag endet mit „Offene Entscheidungen".** Das sind Punkte, bei
denen es mehrere fachlich vertretbare Antworten gibt und die Wahl das Ergebnis
verändert — die entscheidest du, bevor ich etwas umsetze.

**Aufwand:** S = unter einem Tag · M = ein bis drei Tage · L = mehr

---

## 11. Tag-/Nacht-Erwärmung getrennt betrachten (Tagesspanne) [M]

**Was.** Tagesmaximum und Tagesminimum als getrennte Reihen, dazu die
Tagesspanne (Tmax − Tmin) als eigene Kenngröße.

**Warum.** Das Jahresmittel verdeckt, *wie* sich die Erwärmung verteilt. Global
sind die Nächte stärker wärmer geworden als die Tage; die Tagesspanne wird
enger. Göttingen zeigt in den Rohdaten das **Gegenteil**:

| Zeitraum | Ø Tmax | Ø Tmin | Tagesspanne |
|---|---:|---:|---:|
| 1900–1929 | 12,97 °C | 4,32 °C | 8,65 K |
| 1996–2025 | 14,27 °C | 4,90 °C | 9,37 K |
| Änderung | **+1,29 K** | **+0,58 K** | **+0,72 K** |

Die Tage erwärmen sich hier also mehr als doppelt so stark wie die Nächte.

**Vorbehalt, den ich nicht auflösen kann.** Genau dieses Muster entsteht auch
durch eine Stationsverlegung — etwa vom bebauten Stadtgebiet auf freies Feld,
wo die Nächte kühler ausfallen. Das Tagesmaximum liegt zudem erst ab 1885 vor,
das Minimum ab 1871. Ob der Befund real oder ein Messartefakt ist, lässt sich
aus dieser einen Reihe **nicht** entscheiden; dafür bräuchte man
Nachbarstationen oder die DWD-Stationshistorie.

**Offene Entscheidungen**
1. Soll die Ansicht den Befund **zeigen und den Vorbehalt danebenstellen** —
   oder soll sie ihn wegen des ungeklärten Bruchverdachts **gar nicht als
   Trendaussage** darstellen, sondern nur die beiden Reihen ohne Interpretation?
2. Startjahr: erst **ab 1885** (beide Größen vorhanden) oder die volle Reihe mit
   Lücken?

---

## 12. Trends nach meteorologischen Jahreszeiten [M]

**Was.** Winter (Dez–Feb), Frühling (Mär–Mai), Sommer (Jun–Aug), Herbst
(Sep–Nov) als vier eigene Trendreihen.

**Warum.** Das Jahresmittel mittelt genau die Information weg, die interessiert.
Für Göttingen, 1900–1929 gegenüber 1996–2025:

| Jahreszeit | früher | heute | Änderung |
|---|---:|---:|---:|
| Herbst | 8,51 °C | 9,97 °C | **+1,46 K** |
| Sommer | 16,31 °C | 17,41 °C | **+1,09 K** |
| Winter | 1,07 °C | 2,12 °C | **+1,05 K** |
| Frühling | 8,34 °C | 9,03 °C | **+0,68 K** |

Der Herbst erwärmt sich **mehr als doppelt so stark wie der Frühling** — das
steht in keiner der bestehenden Ansichten.

**Offene Entscheidungen**
1. Der meteorologische Winter läuft über den Jahreswechsel. Ich rechne ihn
   üblicherweise dem Jahr des Januars zu (Dez 2025 + Jan/Feb 2026 = „Winter
   2026"). Soll es so sein, oder lieber „Winter 2025/26" ausgeschrieben?
2. Eigener Bereich in der Navigation, oder als Umschalter **innerhalb** des
   Temperaturtrends (Ganzjahr / Winter / Frühling / Sommer / Herbst)?

---

## 13. Rekordbilanz: Wärme- gegen Kälterekorde [M]

**Was.** Für jeden Kalendertag zählen, wann der Wärme- und wann der Kälterekord
für diesen Tag aufgestellt wurde, und das je Jahrzehnt gegenüberstellen.

**Warum.** In einem stabilen Klima wäre das Verhältnis etwa ausgeglichen. Die
Schieflage ist ein sehr direkt lesbares Signal. Erste Rechnung für Göttingen
(Wärme : Kälte):

| Jahrzehnt | Verhältnis |
|---|---|
| 1970er | 41 : 11 |
| 1980er | 43 : 12 |
| 1990er | 58 : 22 |
| 2000er | 50 : 21 |
| 2010er | **75 : 17** |
| 2020er (unvollständig) | 46 : 7 |

**Methodischer Vorbehalt.** Diese Zahlen stammen aus einer naiven Zählung
(„war der Wert höher als alles bisher Gesehene?"). Die ist zwangsläufig zu
frühen Jahrzehnten hin verzerrt, weil am Anfang jeder Wert ein Rekord ist. Für
eine belastbare Darstellung braucht es eine andere Zählweise.

**Offene Entscheidungen**
1. Welche Zählweise?
   **(a)** *Heute noch stehende Rekorde* — in welchem Jahrzehnt wurde der aktuell
   gültige Tagesrekord aufgestellt? Unverzerrt und leicht erklärbar.
   **(b)** *Rekorde relativ zur Erwartung* — pro Jahrzehnt gegen die Zahl, die
   bei stabilem Klima zu erwarten wäre. Statistisch sauberer, erklärungsbedürftig.
   **(c)** Beides nebeneinander.
2. Sollen nur Kalendertage mit einer Mindestzahl an Messjahren (z. B. 100)
   zählen, um Zufallsrekorde aus dünn belegten Tagen auszuschließen?

---

## 14. Spätfrost nach Vegetationsbeginn [M]

**Was.** Zählt Frostnächte, die **nach** dem Beginn der Vegetationsperiode
auftreten, und den Abstand zwischen Vegetationsbeginn und letztem Frost.

**Warum.** Die Vegetationsperiode beginnt heute 22 Tage früher als um 1870
(bereits umgesetzt, siehe Vorschlag 9). Ob das für Obstbau und Garten ein
Vorteil ist, hängt daran, ob die Spätfröste im selben Maß zurückgegangen sind.
Wenn nicht, steigt das Risiko: Die Blüte kommt früher, der Frost bleibt.
Das ist die praktisch folgenreichste Frage, die diese Datenbank beantworten
kann.

**Datenlage.** Beide Bausteine sind vorhanden (Vegetationsbeginn und
`temp_min`). **Ich habe die Zahl noch nicht gerechnet** — das Ergebnis kann in
beide Richtungen gehen, und ich will es nicht vorwegnehmen.

**Offene Entscheidungen**
1. Welche Schwelle gilt als schädlicher Spätfrost? **0 °C** in 2 m Höhe
   (Standard, aus `temp_min`), oder strenger **−2 °C**? Der DWD nutzt für
   Blütenschäden auch das Erdbodenminimum (`TGK`) — das liegt im Archiv vor,
   wird aber aktuell nicht importiert und deckt nur 48,8 % der Reihe ab.
2. Bezugspunkt: Frost nach **Vegetationsbeginn** (thermisch, wie umgesetzt) oder
   nach einem festen Datum (z. B. ab 1. April)?

---

## 15. Verteilungsverschiebung statt nur Mittelwert [M]

**Was.** Die Häufigkeitsverteilung aller Tagesmitteltemperaturen für zwei
30-Jahres-Perioden übereinanderlegen.

**Warum.** Ein Mittelwert, der um 1 K steigt, kann zwei sehr verschiedene Dinge
bedeuten: alle Tage etwas wärmer, oder gleich viele kalte Tage plus deutlich
mehr sehr heiße. Für die Frage „werden Extreme häufiger?" ist das der
entscheidende Unterschied — und die App zeigt derzeit ausschließlich Mittelwerte
und Einzelrekorde, nichts dazwischen.

**Offene Entscheidungen**
1. Darstellung: **zwei überlagerte Kurven** (kompakt, direkter Vergleich) oder
   ein **Ridge-Plot** über mehrere Jahrzehnte (zeigt die Bewegung über die Zeit,
   braucht mehr Platz)?
2. Welche Größe? Tagesmittel, Tagesmaximum oder umschaltbar?
3. Sollen die Perioden **fest** sein (erste und letzte 30 Jahre) oder frei
   wählbar?

---

## 16. Heiz- und Kühlgradtage [M]

**Was.** Heizgradtage und Kühlgradtage je Jahr — das energetisch relevante
Gegenstück zu den Wachstumsgradtagen.

**Warum.** Übersetzt die Klimareihe in eine Größe mit direktem Alltagsbezug:
Heizbedarf und Kühlbedarf. Über 168 Jahre ist das eine der greifbarsten
Auswertungen überhaupt und beantwortet die Frage „spare ich beim Heizen, was ich
beim Kühlen zusätzlich brauche?".

**Offene Entscheidungen — hier gibt es mehrere konkurrierende Normen, und die
Wahl verändert die Zahlen deutlich.** Ich lege mich nicht selbst fest:
1. **Heizgradtage:** nach VDI 2067 (Heizgrenze 15 °C, Raumtemperatur 20 °C,
   also 20 − Tmittel an Tagen unter 15 °C) — oder die einfachere Variante
   HDD 15/15 (15 − Tmittel)? Die erste ist in Deutschland üblich, die zweite
   international vergleichbar.
2. **Kühlgradtage:** Basis 18 °C oder 22 °C? Beides ist gebräuchlich.
3. Sollen beide auf **eine gemeinsame Achse** (Nettobilanz sichtbar) oder
   getrennt dargestellt werden?

---

## 17. Starkregenanteil am Jahresniederschlag [M]

**Was.** Welcher Anteil der Jahressumme fällt an wenigen intensiven Tagen?

**Warum.** Die Jahressumme in Göttingen zeigt keinen klaren Trend — die
**Verteilung** aber schon. Erste Rechnung, Anteil der Jahressumme aus Tagen mit
mindestens 20 mm:

| Zeitraum | Anteil |
|---|---:|
| 1900–1929 | 11,4 % |
| 1996–2025 | **15,0 %** |

Der Niederschlag konzentriert sich also stärker auf wenige Tage, obwohl die
Gesamtmenge kaum steigt. Genau diese Aussage fehlt der App bisher.

**Offene Entscheidungen**
1. Welcher Index? **(a)** Anteil aus Tagen ≥ 20 mm (einfach, wie oben gerechnet),
   **(b)** der WMO-Index R95p (Anteil aus Tagen über dem 95. Perzentil der
   Referenzperiode — fachlich sauberer, aber erklärungsbedürftig), oder **(c)**
   beide?
2. Zusätzlich die **maximale 5-Tages-Summe** je Jahr ausweisen (ein Standardmaß
   für Hochwasserrelevanz)?

---

## 18. Tages-Anomaliekalender für ein einzelnes Jahr [M]

**Was.** Ein Raster mit allen 365 Tagen eines Jahres, jeder Tag eingefärbt nach
seiner Abweichung vom Klimamittel dieses Kalendertags.

**Warum.** Die bestehende Heatmap arbeitet auf Monatsebene und über alle Jahre.
Auf die Frage „wie war eigentlich 2003?" antwortet sie mit zwölf Kacheln. Der
Tageskalender zeigt stattdessen, ob ein warmes Jahr aus einer einzelnen
Hitzewelle bestand oder aus durchgehend leicht erhöhten Werten — und macht die
Monatsübersicht als reine Tabellenansicht deutlich anschaulicher.

**Offene Entscheidungen**
1. Referenz für die Abweichung: **das gleitende 30-Jahres-Mittel des jeweiligen
   Kalendertags** (bewegt sich mit) oder eine **feste Referenzperiode**
   (1961–1990 bzw. die vorhandene 1960–1990)? Die Wahl verschiebt alle Farben.
2. Eigener Bereich oder als zusätzliche Ansicht **innerhalb der
   Monatsübersicht**?

---

## 19. Wiederkehrperiode: „Wie außergewöhnlich ist dieses Jahr?" [L]

**Was.** Für ein herausgegriffenes Jahr ausrechnen, wie selten ein solcher Wert
in einer früheren Referenzperiode gewesen wäre — und wie selten er heute ist.

**Warum.** Statt „2024 war das wärmste Jahr" die deutlich aussagekräftigere
Formulierung: „Ein Jahr wie 2024 wäre im Klima von 1900 ein Ereignis gewesen,
das statistisch alle *n* Jahre auftritt; im heutigen Klima tritt es alle *m*
Jahre auf." Das ist die Standardformulierung der Attributionsforschung und
macht die Verschiebung greifbarer als jede Trendlinie.

**Vorbehalt.** Das ist der anspruchsvollste Vorschlag der Liste. Er erfordert
eine Verteilungsannahme, und das Ergebnis hängt spürbar davon ab. Bei ungünstiger
Umsetzung entstehen scheinpräzise Aussagen („alle 4.700 Jahre"), die die
Datenbasis nicht hergibt.

**Offene Entscheidungen**
1. Verteilung: **Normalverteilung** (einfach, für Jahresmittel meist vertretbar)
   oder **GEV** für Extremwerte (korrekt für Maxima, deutlich aufwendiger)?
2. Sollen Wiederkehrperioden über einer Obergrenze (z. B. 1.000 Jahre) als
   „> 1.000 Jahre" ausgewiesen werden, statt eine konkrete Zahl zu nennen?
3. Nur für Jahresmittel, oder auch für Monats- und Tagesextreme?

**Ehrliche Einschätzung:** Wenn du nur eines der aufwendigeren Themen willst,
würde ich 14 (Spätfrost) oder 12 (Jahreszeiten) vorziehen — beide liefern
belastbare Aussagen ohne Verteilungsannahme.

---

## 20. „Dieser Tag in der Geschichte" [S]

**Was.** Eine kleine Ansicht für das heutige Datum: wärmster, kältester,
nassester 31. Juli der Messgeschichte, dazu die Einordnung des aktuellen Jahres.

**Warum.** Der einzige Vorschlag der Liste, der auf wiederkehrende Nutzung
zielt statt auf einmalige Analyse — ein Grund, die App auch ohne konkrete Frage
zu öffnen. Aufwand gering, alle Daten liegen vor.

**Offene Entscheidungen**
1. Bezugstag: das **heutige Kalenderdatum** (dann zeigt die Ansicht bei
   veraltetem Datenbestand einen Tag ohne Messwert) oder der **letzte Tag mit
   Daten**? Ich neige zum letzten Datentag, will das aber nicht stillschweigend
   entscheiden.
2. Nur Einzeltag, oder ein Fenster von ±3 Tagen (robuster, mehr Vergleichswerte)?

---

## Übersicht

| # | Vorschlag | Aufwand | Aussagekraft |
|---|---|---|---|
| 11 | Tag-/Nacht-Erwärmung, Tagesspanne | M | hoch, aber mit Bruchverdacht |
| 12 | Trends nach Jahreszeiten | M | hoch, belegt |
| 13 | Rekordbilanz warm : kalt | M | hoch, Zählweise offen |
| 14 | Spätfrost nach Vegetationsbeginn | M | hoch, praktisch relevant |
| 15 | Verteilungsverschiebung | M | mittel bis hoch |
| 16 | Heiz- und Kühlgradtage | M | hoch, Alltagsbezug |
| 17 | Starkregenanteil | M | hoch, belegt |
| 18 | Tages-Anomaliekalender | M | mittel, sehr anschaulich |
| 19 | Wiederkehrperioden | L | hoch, aber annahmeabhängig |
| 20 | „Dieser Tag in der Geschichte" | S | gering, aber bindet |

Sag mir, welche Nummern umgesetzt werden sollen. Die offenen Entscheidungen des
jeweiligen Vorschlags klären wir dann, bevor ich anfange.
