# Wetter

Temperaturreihen und Tageswerte der DWD-Klimastationen, als schlankes
Windows-Programm: Python + pywebview (Edge WebView2), Svelte-Oberfläche,
DuckDB als Datenbank. Gleicher Aufbau wie der Serientrenner.

## Ansichten

- **Jahresband**: ein Jahr Tag für Tag (Tiefst- bis Höchstwert, gefärbt
  gegen das Normal 1991–2020). Daneben stehen das Jahr bis heute mit Platz,
  die Prognose zum Jahresende (10 % / Median / 90 %) und die Monate gegen
  normal.
- **Monat**: alle Größen der Tagesarchive Tag für Tag, mit Monats-, Normal-
  und Abweichungszeile.
- **Rangliste**: alle Jahre nach Mittel, sortierbar. Umschaltbar zwischen
  „bis heute“ und „bis Jahresende“, die Prognose lässt sich zu- und
  abschalten.
- **Zeitreihe**: Mittel, Max oder Min als Tag, Monat oder Jahr. Mit Zoom,
  Übersicht und Markierung von Sprüngen über 15 K.

## Daten

Die Tageswerte stammen direkt aus `opendata.dwd.de` (`daily/kl`). Gelesen
werden historisch und recent; historisch gewinnt, recent zählt erst nach
dem letzten hist-Tag. Alle 1.386 Stationen der Liste sind wählbar. Beim
ersten Öffnen lädt das Programm die Station (Einlesen 0,1 s, der Rest ist
Netz). Göttingen ist schon in der mitgelieferten Datenbank.

Die Rohwerte bleiben gespeichert; bereinigt wird beim Lesen
(`plausibel.py`): physikalische Grenzen je Größe, Max < Min nimmt den Tag,
ein Mittel außerhalb Min…Max nimmt das Mittel. Sprünge werden nur markiert.
Das Qualitätsniveau (QN) ist umschaltbar.

## Entwicklung

    pip install -r requirements.txt
    cd web && npm ci && npm run build && cd ..
    python startdaten_bauen.py        # Startdatenbank vom DWD
    python wetter.py                  # Fenster
    python wetter.py --dienst 8766    # dieselbe Seite im Browser
    python wetter.py --selbsttest
    python -m pytest -q && (cd web && npm test)

Gebaut wird in GitHub Actions (`.github/workflows/build-exe.yml`). Das
Ergebnis ist ein Ordner mit `Wetter.exe` (x64, PyInstaller onedir). Daten
und Protokolle legt das Programm daneben im Ordner `daten` ab; ist dort
kein Schreibrecht, unter `%LOCALAPPDATA%\Wetter`.
