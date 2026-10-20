"""
Wetter - aktuelles Wetter und Vorhersage
========================================

Aktuell: Bright Sky (brightsky.dev) - Messungen des DWD, nächste Station,
mit Bewölkung und Wetterlage. Vorhersage: je Modell eine Tabelle Stunde
für Stunde, drei Tage - Temperatur, Bewölkung, Niederschlag, Wind, Böen
und ein Wettersymbol.

Modelle (so entschieden):
    ICON-D2      DWD, 2 km, rund 2 Tage           Open-Meteo icon_d2
    ICON-EU      DWD, 7 km                        Open-Meteo icon_eu
    ECMWF IFS    ECMWF, 25 km                     Open-Meteo ecmwf_ifs025
    GFS          NOAA                             Open-Meteo gfs_seamless
    Swiss HD     MeteoSwiss ICON-CH1/CH2, 1-2 km  Open-Meteo meteoswiss_icon_ch1/ch2
                 (rechnet nur im Alpenraum - sonst "außerhalb des Gebiets")
    MET Norway   eigener Dienst api.met.no        locationforecast/2.0/complete

Alle Zeiten in UTC (ISO); die Seite zeigt sie in Ortszeit.

Die Umwandlung in ein gemeinsames Format (`open_meteo`, `met_norway`,
`bright_sky`) steht genauso in web/src/lokal/vorhersage.js; der
Gleichheitstest prüft beide an abgelegten Antworten.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import dwd

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
STUNDEN_WERTE = "temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,weather_code,is_day"
MODELLE = [
    # (Schlüssel, Name, Beschreibung, Quelle, Open-Meteo-Modell)
    ("icon_d2", "ICON-D2", "DWD, 2 km, rund 2 Tage", "open-meteo", "icon_d2"),
    ("icon_eu", "ICON-EU", "DWD, 7 km", "open-meteo", "icon_eu"),
    ("ecmwf", "ECMWF IFS", "Europäisches Zentrum, 25 km", "open-meteo", "ecmwf_ifs025"),
    ("gfs", "GFS", "NOAA (USA)", "open-meteo", "gfs_seamless"),
    ("swiss1", "Swiss HD 1 km", "MeteoSwiss ICON-CH1, nur Alpenraum", "open-meteo", "meteoswiss_icon_ch1"),
    ("swiss2", "Swiss HD 2 km", "MeteoSwiss ICON-CH2, nur Alpenraum", "open-meteo", "meteoswiss_icon_ch2"),
    ("metno", "MET Norway", "Norwegischer Wetterdienst", "met-norway", None),
]
KENNUNG = "Wetter-App (github.com/michaelkrinningersg-coder/Wetter)"


# ------------------------------------------------------------- Symbole
def symbol_wmo(code) -> str | None:
    """WMO-Wettercode (Open-Meteo) -> gemeinsames Symbol."""
    if code is None:
        return None
    c = int(code)
    if c == 0:
        return "klar"
    if c == 1:
        return "heiter"
    if c == 2:
        return "wolkig"
    if c == 3:
        return "bedeckt"
    if c in (45, 48):
        return "nebel"
    if c in (51, 53, 55):
        return "niesel"
    if c in (56, 57, 66, 67):
        return "glatteis"
    if c in (61, 63):
        return "regen"
    if c in (65, 82):
        return "starkregen"
    if c in (71, 73, 75, 77):
        return "schnee"
    if c in (80, 81):
        return "schauer"
    if c in (85, 86):
        return "schneeschauer"
    if c >= 95:
        return "gewitter"
    return None


def symbol_metno(code: str | None) -> tuple[str | None, bool | None]:
    """Symbolname von MET Norway (z. B. partlycloudy_night) -> (Symbol, Tag)."""
    if not code:
        return None, None
    basis, _, zeit = code.partition("_")
    tag = None if not zeit else zeit == "day"
    if "thunder" in basis:
        return "gewitter", tag
    if "snowshowers" in basis:
        return "schneeschauer", tag
    if "sleet" in basis:
        return "schneeregen", tag
    if "snow" in basis:
        return "schnee", tag
    if "rainshowers" in basis:
        return "schauer", tag
    if basis == "heavyrain":
        return "starkregen", tag
    if basis == "lightrain":
        return "niesel", tag
    if "rain" in basis:
        return "regen", tag
    return {"clearsky": "klar", "fair": "heiter", "partlycloudy": "wolkig",
            "cloudy": "bedeckt", "fog": "nebel"}.get(basis), tag


def symbol_brightsky(icon: str | None) -> tuple[str | None, bool | None]:
    if not icon:
        return None, None
    tag = True if icon.endswith("-day") else False if icon.endswith("-night") else None
    basis = icon.replace("-day", "").replace("-night", "")
    return {"clear": "klar", "partly-cloudy": "wolkig", "cloudy": "bedeckt", "fog": "nebel",
            "wind": "wind", "rain": "regen", "sleet": "schneeregen", "snow": "schnee",
            "hail": "gewitter", "thunderstorm": "gewitter"}.get(basis), tag


def _r(v, stellen=1):
    return None if v is None else round(float(v), stellen)


# ------------------------------------------------------- Umwandlungen
def open_meteo(antwort: dict) -> dict:
    """Antwort von Open-Meteo (timezone=GMT) -> {stunden} oder {fehler}."""
    if antwort.get("error"):
        grund = antwort.get("reason", "")
        if "No data is available for this location" in grund:
            return {"fehler": "Ort liegt außerhalb des Modellgebiets"}
        if "request limit" in grund:
            return {"fehler": "Tageslimit bei Open-Meteo erreicht - später noch einmal"}
        return {"fehler": grund or "unbekannter Fehler"}
    h = antwort.get("hourly") or {}
    zeiten = h.get("time") or []
    stunden = []
    for i, t in enumerate(zeiten):
        def wert(k):
            liste = h.get(k) or []
            return liste[i] if i < len(liste) else None
        temp = wert("temperature_2m")
        if temp is None and wert("cloud_cover") is None:
            continue                     # das Modell reicht nicht so weit
        tag = wert("is_day")
        stunden.append([t + ":00Z", _r(temp), _r(wert("cloud_cover"), 0), _r(wert("precipitation")),
                        _r(wert("wind_speed_10m"), 0), _r(wert("wind_gusts_10m"), 0),
                        symbol_wmo(wert("weather_code")), None if tag is None else bool(tag)])
    return {"stunden": stunden} if stunden else {"fehler": "keine Werte für diesen Ort"}


def met_norway(antwort: dict, stunden_max=72) -> dict:
    reihe = (antwort.get("properties") or {}).get("timeseries") or []
    stunden = []
    for e in reihe[:stunden_max]:
        d = e.get("data") or {}
        jetzt = (d.get("instant") or {}).get("details") or {}
        naechste = d.get("next_1_hours") or d.get("next_6_hours") or {}
        symbol, tag = symbol_metno((naechste.get("summary") or {}).get("symbol_code"))
        wind = jetzt.get("wind_speed")
        boe = jetzt.get("wind_speed_of_gust")
        regen = (naechste.get("details") or {}).get("precipitation_amount")
        stunden.append([e.get("time", "").replace("+00:00", "Z"), _r(jetzt.get("air_temperature")),
                        _r(jetzt.get("cloud_area_fraction"), 0), _r(regen),
                        _r(wind * 3.6, 0) if wind is not None else None,
                        _r(boe * 3.6, 0) if boe is not None else None, symbol, tag])
    return {"stunden": stunden} if stunden else {"fehler": "keine Werte"}


def bright_sky(antwort: dict) -> dict:
    w = antwort.get("weather") or {}
    if not w:
        return {"fehler": "keine Messung in der Nähe"}
    quelle = next((q for q in antwort.get("sources") or [] if q.get("id") == w.get("source_id")),
                  (antwort.get("sources") or [{}])[0])
    symbol, tag = symbol_brightsky(w.get("icon"))
    return {"zeit": w.get("timestamp"), "temp": _r(w.get("temperature")),
            "wolken": _r(w.get("cloud_cover"), 0), "symbol": symbol, "tag": tag,
            "regen": _r(w.get("precipitation_60")), "wind": _r(w.get("wind_speed_10"), 0),
            "boe": _r(w.get("wind_gust_speed_10"), 0), "feuchte": _r(w.get("relative_humidity"), 0),
            "station": quelle.get("station_name"), "abstand": _r((quelle.get("distance") or 0) / 1000)}


# ------------------------------------------------------------ Abruf
def _json(url: str) -> dict:
    anfrage = urllib.request.Request(url, headers={"User-Agent": KENNUNG})
    try:
        with urllib.request.urlopen(anfrage, timeout=30, context=dwd._tls()) as antwort:
            return json.loads(antwort.read().decode("utf-8"))
    except urllib.error.HTTPError as fehler:
        try:
            return json.loads(fehler.read().decode("utf-8"))   # Open-Meteo erklärt Fehler als JSON
        except Exception:                                      # noqa: BLE001
            return {"error": True, "reason": f"HTTP {fehler.code}"}


def url_open_meteo(lat, lon, modell) -> str:
    return (f"{OPEN_METEO}?latitude={lat:.4f}&longitude={lon:.4f}&hourly={STUNDEN_WERTE}"
            f"&forecast_days=3&timezone=GMT&models={modell}")


def url_met_norway(lat, lon) -> str:
    return f"https://api.met.no/weatherapi/locationforecast/2.0/complete?lat={lat:.4f}&lon={lon:.4f}"


def url_bright_sky(lat, lon) -> str:
    return f"https://api.brightsky.dev/current_weather?lat={lat:.4f}&lon={lon:.4f}"


def abrufen(lat: float, lon: float) -> dict:
    """Aktuell und alle Modelle gleichzeitig - jede Quelle für sich, ein
    Fehler bei einem Modell lässt die anderen stehen."""
    def modell(m):
        schluessel, name, text, quelle, om = m
        try:
            if quelle == "met-norway":
                daten = met_norway(_json(url_met_norway(lat, lon)))
            else:
                daten = open_meteo(_json(url_open_meteo(lat, lon, om)))
        except Exception as fehler:                            # noqa: BLE001
            daten = {"fehler": f"nicht erreichbar ({fehler})"}
        return {"id": schluessel, "name": name, "text": text, **daten}

    def aktuell():
        try:
            return bright_sky(_json(url_bright_sky(lat, lon)))
        except Exception as fehler:                            # noqa: BLE001
            return {"fehler": f"nicht erreichbar ({fehler})"}

    with ThreadPoolExecutor(max_workers=len(MODELLE) + 1) as pool:
        jetzt = pool.submit(aktuell)
        modelle = list(pool.map(modell, MODELLE))
    return {"aktuell": jetzt.result(), "modelle": modelle}


# ------------------------------------------------------------- Regenradar
RADAR_ZEILEN, RADAR_SPALTEN = 1200, 1100


def radar_bbox(bbox) -> tuple[int, int, int, int]:
    """[oben, links, unten, rechts] als ganze Zahlen im Radarraster."""
    o, l, u, r = (int(v) for v in bbox)
    if not (0 <= o <= u < RADAR_ZEILEN and 0 <= l <= r < RADAR_SPALTEN):
        raise ValueError(f"Ausschnitt außerhalb des Radarrasters: {bbox}")
    return o, l, u, r


def url_radar(bbox) -> str:
    o, l, u, r = radar_bbox(bbox)
    return f"https://api.brightsky.dev/radar?bbox={o},{l},{u},{r}&format=compressed"


def radar(bbox) -> dict:
    """Niederschlagsradar des DWD (RV, 1 km, 5 Minuten) über Bright Sky:
    die letzte Stunde und die Vorhersage der nächsten, gepackt wie geliefert -
    entpackt wird in der Seite (web/src/lib/radardaten.js)."""
    antwort = _json(url_radar(bbox))
    if "radar" not in antwort:
        raise ValueError(antwort.get("detail") or "keine Radardaten")
    return {"bbox": list(radar_bbox(bbox)), "radar": antwort["radar"]}

