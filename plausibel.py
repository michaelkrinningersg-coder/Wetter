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

Die Regeln 1 bis 3 greifen nach der QN-Auswahl und vor jeder Rechnung.
"""

from __future__ import annotations

TIEFST = -45.0
HOECHST = 50.0
SPRUNG = 15.0

# Wie die Seite sie nennt -> kleinstes zugelassenes QN
QN_STUFEN = {"alle": 0, "ab5": 5, "nur10": 10}
QN_VORGABE = "alle"


def qn_min(stufe) -> int:
    """Unbekanntes wird zur Vorgabe - eine Ansichtseinstellung soll nie
    eine Abfrage scheitern lassen."""
    return QN_STUFEN.get(stufe, QN_STUFEN[QN_VORGABE])


def _grenze(spalte: str) -> str:
    return (f"CASE WHEN {spalte} BETWEEN {TIEFST} AND {HOECHST} "
            f"THEN {spalte} END")


def rein(stufe=QN_VORGABE, wo: str = "TRUE") -> str:
    """Die bereinigte Tagestabelle als Unterabfrage.

    `wo` schränkt vorab ein (z. B. "station = ?"), damit DuckDB nur die
    Zeilen einer Station anfasst. Die Spalten heißen wie in `tag`.
    """
    q = qn_min(stufe)
    return f"""(
    SELECT station, datum, qn, quelle,
           CASE WHEN x0 < n0 THEN NULL
                WHEN m0 < n0 OR m0 > x0 THEN NULL
                ELSE m0 END AS tmk,
           CASE WHEN x0 < n0 THEN NULL ELSE x0 END AS txk,
           CASE WHEN x0 < n0 THEN NULL ELSE n0 END AS tnk
    FROM (SELECT station, datum, qn, quelle,
                 {_grenze('tmk')} AS m0,
                 {_grenze('txk')} AS x0,
                 {_grenze('tnk')} AS n0
          FROM tag
          WHERE ({wo}) AND coalesce(qn, 0) >= {q})
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
