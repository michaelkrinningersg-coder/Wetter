package app.wetter.station;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Vorhersage für Widget und Meldungen - dieselben Quellen und Symbole wie
 * die App (web/src/lokal/vorhersage.js): Open-Meteo je Modell oder MET
 * Norway. Zeiten in UTC, Anzeige in Europe/Berlin.
 */
final class Vorhersage {

    static final String KENNUNG = "Wetter-App (github.com/michaelkrinningersg-coder/Wetter)";
    static final TimeZone BERLIN = TimeZone.getTimeZone("Europe/Berlin");
    static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    /** Eine Stunde: Zeit (ms), Temperatur °C, Niederschlag mm, Böe km/h, Symbol, Tag (null = unbekannt). */
    static final class Stunde {
        long ms;
        double temp = Double.NaN;
        double regen = Double.NaN;
        double boe = Double.NaN;
        String art;
        Boolean tag;
        boolean ersatz;
    }

    private Vorhersage() {}

    // ------------------------------------------------------------ Netz
    static String holen(String adresse) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(adresse).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(40000);
        c.setRequestProperty("User-Agent", KENNUNG);
        int code = c.getResponseCode();
        InputStream ein = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream aus = new ByteArrayOutputStream();
        if (ein != null) {
            byte[] puffer = new byte[16384];
            int n;
            while ((n = ein.read(puffer)) > 0) aus.write(puffer, 0, n);
            ein.close();
        }
        c.disconnect();
        String text = new String(aus.toByteArray(), StandardCharsets.UTF_8);
        if (code >= 400 && !text.trim().startsWith("{")) throw new IOException("HTTP " + code);
        return text;
    }

    // --------------------------------------------------------- Abrufen
    /** modell: Open-Meteo-Name (icon_d2, ecmwf_ifs025 ...) oder "metno". */
    static List<Stunde> abrufen(double lat, double lon, String modell) throws IOException, JSONException {
        if ("metno".equals(modell)) return metNorway(lat, lon);
        return openMeteo(lat, lon, modell);
    }

    static List<Stunde> openMeteo(double lat, double lon, String modell) throws IOException, JSONException {
        String adresse = String.format(Locale.ROOT,
            "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
                + "&hourly=temperature_2m,precipitation,weather_code,is_day,wind_gusts_10m"
                + "&forecast_days=3&timezone=GMT&models=%s", lat, lon, modell);
        JSONObject a = new JSONObject(holen(adresse));
        if (a.optBoolean("error", false)) {
            String grund = a.optString("reason", "Fehler");
            if (grund.contains("No data is available for this location")) grund = "Ort liegt außerhalb des Modellgebiets";
            throw new IOException(grund);
        }
        JSONObject h = a.getJSONObject("hourly");
        JSONArray zeit = h.getJSONArray("time");
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.ROOT);
        f.setTimeZone(UTC);
        List<Stunde> aus = new ArrayList<>();
        for (int i = 0; i < zeit.length(); i++) {
            Stunde s = new Stunde();
            try {
                s.ms = f.parse(zeit.getString(i)).getTime();
            } catch (ParseException e) {
                continue;
            }
            s.temp = zahl(h.optJSONArray("temperature_2m"), i);
            if (Double.isNaN(s.temp)) continue;
            s.regen = zahl(h.optJSONArray("precipitation"), i);
            s.boe = zahl(h.optJSONArray("wind_gusts_10m"), i);
            double code = zahl(h.optJSONArray("weather_code"), i);
            s.art = Double.isNaN(code) ? null : symbolWmo((int) code);
            double tag = zahl(h.optJSONArray("is_day"), i);
            s.tag = Double.isNaN(tag) ? null : tag > 0.5;
            aus.add(s);
        }
        return aus;
    }

    static List<Stunde> metNorway(double lat, double lon) throws IOException, JSONException {
        String adresse = String.format(Locale.ROOT,
            "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=%.4f&lon=%.4f", lat, lon);
        JSONArray reihe = new JSONObject(holen(adresse)).getJSONObject("properties").getJSONArray("timeseries");
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        f.setTimeZone(UTC);
        List<Stunde> aus = new ArrayList<>();
        for (int i = 0; i < reihe.length() && i < 90; i++) {
            JSONObject e = reihe.getJSONObject(i);
            JSONObject d = e.getJSONObject("data");
            JSONObject jetzt = d.getJSONObject("instant").getJSONObject("details");
            JSONObject naechste = d.has("next_1_hours") ? d.getJSONObject("next_1_hours") : d.optJSONObject("next_6_hours");
            Stunde s = new Stunde();
            try {
                s.ms = f.parse(e.getString("time")).getTime();
            } catch (ParseException x) {
                continue;
            }
            s.temp = jetzt.optDouble("air_temperature", Double.NaN);
            if (Double.isNaN(s.temp)) continue;
            double boe = jetzt.optDouble("wind_speed_of_gust", Double.NaN);
            s.boe = Double.isNaN(boe) ? Double.NaN : boe * 3.6;
            if (naechste != null) {
                JSONObject det = naechste.optJSONObject("details");
                // 6-Stunden-Summen zählen nicht als Starkregen je Stunde
                if (det != null && d.has("next_1_hours")) s.regen = det.optDouble("precipitation_amount", Double.NaN);
                JSONObject sum = naechste.optJSONObject("summary");
                if (sum != null) {
                    String code = sum.optString("symbol_code", "");
                    s.art = symbolMetno(code);
                    s.tag = code.endsWith("_day") ? Boolean.TRUE : code.endsWith("_night") ? Boolean.FALSE : null;
                }
            }
            aus.add(s);
        }
        return aus;
    }

    private static double zahl(JSONArray a, int i) {
        if (a == null || i >= a.length() || a.isNull(i)) return Double.NaN;
        return a.optDouble(i, Double.NaN);
    }

    // ---------------------------------------------------------- Symbole
    static String symbolWmo(int c) {
        if (c == 0) return "klar";
        if (c == 1) return "heiter";
        if (c == 2) return "wolkig";
        if (c == 3) return "bedeckt";
        if (c == 45 || c == 48) return "nebel";
        if (c == 51 || c == 53 || c == 55) return "niesel";
        if (c == 56 || c == 57 || c == 66 || c == 67) return "glatteis";
        if (c == 61 || c == 63) return "regen";
        if (c == 65 || c == 82) return "starkregen";
        if (c == 71 || c == 73 || c == 75 || c == 77) return "schnee";
        if (c == 80 || c == 81) return "schauer";
        if (c == 85 || c == 86) return "schneeschauer";
        if (c >= 95) return "gewitter";
        return null;
    }

    static String symbolMetno(String code) {
        if (code == null || code.isEmpty()) return null;
        int i = code.indexOf('_');
        String b = i < 0 ? code : code.substring(0, i);
        if (b.contains("thunder")) return "gewitter";
        if (b.contains("snowshowers")) return "schneeschauer";
        if (b.contains("sleet")) return "schneeregen";
        if (b.contains("snow")) return "schnee";
        if (b.contains("rainshowers")) return "schauer";
        if (b.equals("heavyrain")) return "starkregen";
        if (b.equals("lightrain")) return "niesel";
        if (b.contains("rain")) return "regen";
        switch (b) {
            case "clearsky": return "klar";
            case "fair": return "heiter";
            case "partlycloudy": return "wolkig";
            case "cloudy": return "bedeckt";
            case "fog": return "nebel";
            default: return null;
        }
    }

    // ------------------------------------------------ Tag oder Nacht
    /** Sonnenhöhe in Grad (wie sonnenhoehe in web/src/lib/format.js). */
    static double sonnenhoehe(long ms, double lat, double lon) {
        double rad = Math.PI / 180;
        double d = ms / 86400000.0 - 10957.5;
        double g = (357.529 + 0.98560028 * d) * rad;
        double l = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
        double e = (23.439 - 0.00000036 * d) * rad;
        double ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
        double dek = Math.asin(Math.sin(e) * Math.sin(l));
        double h = (280.46061837 + 360.98564736629 * d + lon) * rad - ra;
        return Math.asin(Math.sin(lat * rad) * Math.sin(dek) + Math.cos(lat * rad) * Math.cos(dek) * Math.cos(h)) / rad;
    }

    static boolean istTag(Stunde s, double lat, double lon) {
        if (s.tag != null) return s.tag;
        return sonnenhoehe(s.ms + 1800000L, lat, lon) > -0.833;
    }

    // ---------------------------------------------------- 3-Stunden-Raster
    /** Zeitpunkt (ms) des Tages t (0 = heute) um h Uhr in Berlin. */
    static long zeitpunkt(long jetzt, int t, int h) {
        Calendar c = Calendar.getInstance(BERLIN, Locale.GERMANY);
        c.setTimeInMillis(jetzt);
        c.add(Calendar.DAY_OF_MONTH, t);
        c.set(Calendar.HOUR_OF_DAY, h);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Stunde zur Zeit - aus der ersten Liste, die sie hat (die zweite ist Ersatz). */
    static Stunde finden(List<Stunde> haupt, List<Stunde> ersatz, long ms) {
        for (Stunde s : haupt) if (s.ms == ms) return s;
        if (ersatz != null) {
            for (Stunde s : ersatz) {
                if (s.ms == ms) {
                    s.ersatz = true;
                    return s;
                }
            }
        }
        return null;
    }
}
