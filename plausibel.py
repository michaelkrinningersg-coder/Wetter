"""
Wetter - was als plausibel gilt
===============================

Die Rohwerte bleiben in der Datenbank, wie der DWD sie liefert. Bereinigt
wird beim Lesen: jede Abfrage geht über `rein()`, eine Unterabfrage, die
dieselben Spalten liefert, nur mit den unplausiblen Werten als NULL.
So lässt sich eine Regel ändern, ohne eine Station neu zu laden, und die
Bilanz zeigt jederzeit, was eine Regel gekostet hat.

Die Regeln (so entschieden):

  1. Physikalische Grenzen: Mittel, Höchst- und Tiefstwert außerhalb von
     -45 bis +50 °C fallen weg - jeder Wert für sich.
  2. Höchstwert unter Tiefstwert: der Tag ist widersprüchlich, alle drei
     Temperaturen fallen weg.
  3. Mittel außerhalb von Tiefst- bis Höchstwert: nur das Mittel fällt weg.
  4. Sprung von mehr als 15 K zum Vortag: wird markiert, nie entfernt.
     Ein Kälteeinbruch kann echt sein (Göttingen 1893-01-15: -2,0 -> -19,0).
  5. Qualitätsniveau (QN) umschaltbar: alle / ab QN 5 / nur QN 10.
     Vorgabe: alle. Ein strenger Filter schneidet Jahrzehnte ab - vor 1981
     vergibt der DWD höchstens QN 5, die letzten Jahre tragen QN 9.
     Wind trägt beim DWD ein eigenes QN (QN_3), alles andere QN_4.

Die übrigen Größen (so entschieden): physikalische Grenzen, außerhalb
fällt nur dieser eine Wert weg -

     Wind (Mittel, Spitze)  0-250 km/h; Mittel über der Spitze -> Mittel weg
     Niederschlag           0-300 mm
     Sonnenschein           0-16,5 h (längster Tag in Deutschland)
     Schneehöhe             0-800 cm
     Bedeckung              0-8 Achtel
     rel. Feuchte           0-100 %
     Luftdruck              500-1100 hPa
     Dampfdruck             0-125 hPa (Sättigung bei der Obergrenze 50 °C)
     Erdbodenminimum        -50 bis +50 °C
     Niederschlagsform      nur die Codes des DWD (0 1 4 6 7 8 9)

Die Regeln greifen nach der QN-Auswahl und vor jeder Rechnung.
"""

from __future__ import annotations

TIEFST = -45.0
HOECHST = 50.0
SPRUNG = 15.0

WIND_MAX = 250 / 3.6          # km/h -> m/s, so liefert der DWD
GRENZEN = {"fx": (0, WIND_MAX), "fm": (0, WIND_MAX), "rsk": (0, 300),
           "sdk": (0, 16.5), "shk": (0, 800), "nm": (0, 8), "upm": (0, 100),
           "pm": (500, 1100), "vpm": (0, 125), "tgk": (-50, 50)}
NS_FORMEN = (0, 1, 4, 6, 7, 8, 9)

# Wie die Seite sie nennt -> kleinstes zugelassenes QN
QN_STUFEN = {"alle": 0, "ab5": 5, "nur10": 10}
QN_VORGABE = "alle"


def qn_min(stufe) -> int:
    """Unbekanntes wird zur Vorgabe - eine Ansichtseinstellung soll nie
    eine Abfrage scheitern lassen."""
    return QN_STUFEN.get(stufe, QN_STUFEN[QN_VORGABE])


def _grenze(spalte: str, tief=TIEFST, hoch=HOECHST) -> str:
    return (f"CASE WHEN {spalte} BETWEEN {tief} AND {hoch} "
            f"THEN {spalte} END")


def rein(stufe=QN_VORGABE, wo: str = "TRUE") -> str:
    """Die bereinigte Tagestabelle als Unterabfrage.

    `wo` schränkt vorab ein (z. B. "station = ?"), damit DuckDB nur die
    Zeilen einer Station anfasst. Die Spalten heißen wie in `tag`.
    """
    q = qn_min(stufe)
    ok4 = f"coalesce(qn, 0) >= {q}"
    ok3 = f"coalesce(qn3, 0) >= {q}"

    def weitere(spalte, ok):
        tief, hoch = GRENZEN[spalte]
        return f"CASE WHEN {ok} THEN {_grenze(spalte, tief, hoch)} END AS {spalte}"

    return f"""(
    SELECT station, datum, qn, quelle,
           CASE WHEN x0 < n0 THEN NULL
                WHEN m0 < n0 OR m0 > x0 THEN NULL
                ELSE m0 END AS tmk,
           CASE WHEN x0 < n0 THEN NULL ELSE x0 END AS txk,
           CASE WHEN x0 < n0 THEN NULL ELSE n0 END AS tnk,
           fx, CASE WHEN fm > fx THEN NULL ELSE fm END AS fm,
           rsk, rskf, sdk, shk, nm, vpm, pm, upm, tgk
    FROM (SELECT station, datum, qn, quelle,
                 CASE WHEN {ok4} THEN {_grenze('tmk')} END AS m0,
                 CASE WHEN {ok4} THEN {_grenze('txk')} END AS x0,
                 CASE WHEN {ok4} THEN {_grenze('tnk')} END AS n0,
                 {weitere('fx', ok3)}, {weitere('fm', ok3)},
                 {weitere('rsk', ok4)},
                 CASE WHEN {ok4} AND rskf IN {NS_FORMEN} THEN rskf END AS rskf,
                 {weitere('sdk', ok4)}, {weitere('shk', ok4)},
                 {weitere('nm', ok4)}, {weitere('vpm', ok4)},
                 {weitere('pm', ok4)}, {weitere('upm', ok4)},
                 {weitere('tgk', ok4)}
          FROM tag
          WHERE ({wo}))
)"""


def bilanz_sql(stufe=QN_VORGABE) -> str:
    """Was jede Regel bei einer Station entfernt oder markiert (ein ?)."""
    q = qn_min(stufe)
    return f"""
    WITH roh AS (SELECT * FROM tag WHERE station = ?),
    g AS (SELECT *,
                 {_grenze('tmk')} AS m0,
                 {_grenze('txk')} AS x0,
                 {_grenze('tnk')} AS n0
          FROM roh WHERE coalesce(qn, 0) >= {q}),
    r AS (SELECT datum, CASE WHEN x0 < n0 THEN NULL
                             WHEN m0 < n0 OR m0 > x0 THEN NULL
                             ELSE m0 END AS tmk
          FROM g),
    s AS (SELECT datum, tmk,
                 lag(tmk) OVER (ORDER BY datum) AS vor,
                 lag(datum) OVER (ORDER BY datum) AS vortag
          FROM r)
    SELECT
      (SELECT count(*) FROM roh) AS tage,
      (SELECT count(*) FROM roh WHERE coalesce(qn, 0) < {q}) AS qn_weg,
      (SELECT count(*) FILTER (WHERE tmk IS NOT NULL AND m0 IS NULL)
            + count(*) FILTER (WHERE txk IS NOT NULL AND x0 IS NULL)
            + count(*) FILTER (WHERE tnk IS NOT NULL AND n0 IS NULL)
         FROM g) AS grenze_weg,
      (SELECT count(*) FROM g WHERE x0 < n0) AS max_unter_min,
      (SELECT count(*) FROM g WHERE NOT coalesce(x0 < n0, false)
                               AND (m0 < n0 OR m0 > x0)) AS mittel_ausserhalb,
      (SELECT count(*) FROM s WHERE vortag = datum - 1
                               AND abs(tmk - vor) > {SPRUNG}) AS spruenge
    """
