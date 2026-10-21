package app.wetter.station;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Resources;
import android.graphics.Color;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Das Widget 4x3: Ort und Modell, darunter 3 Tage mit je 8 Zeitpunkten
 * (0, 3 ... 21 Uhr): Wettersymbol und Temperatur. Gezeichnet wird aus dem
 * Raster, das WidgetArbeit ablegt; Tippen öffnet die App.
 */
public class WetterWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        zeichnen(c);
        Einstellungen.planen(c);
        Einstellungen.widgetJetzt(c);
    }

    @Override
    public void onEnabled(Context c) {
        Einstellungen.planen(c);
        Einstellungen.widgetJetzt(c);
    }

    static void zeichnen(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, WetterWidget.class));
        if (ids == null || ids.length == 0) return;
        String pkg = c.getPackageName();
        Resources res = c.getResources();
        SharedPreferences p = Einstellungen.prefs(c);
        RemoteViews rv = new RemoteViews(pkg, R.layout.wetter_widget);

        String ort = p.getString("name", "");
        String modell = p.getString("modellName", "");
        rv.setTextViewText(R.id.w_ort, ort.isEmpty() ? "Wetter – App einmal öffnen" : ort + (modell.isEmpty() ? "" : " · " + modell));

        try {
            JSONObject r = new JSONObject(p.getString("raster", "{}"));
            if (r.has("abgerufen")) {
                SimpleDateFormat uhr = new SimpleDateFormat("HH:mm", Locale.GERMANY);
                uhr.setTimeZone(Vorhersage.BERLIN);
                rv.setTextViewText(R.id.w_stand, uhr.format(r.getLong("abgerufen")));
            }
            JSONArray tage = r.optJSONArray("tage");
            JSONArray zellen = r.optJSONArray("zellen");
            for (int t = 0; t < 3; t++) {
                JSONArray tag = tage == null ? null : tage.optJSONArray(t);
                rv.setTextViewText(id(res, pkg, "w_" + t + "_name"), tag == null ? "" : tag.optString(0));
                rv.setTextViewText(id(res, pkg, "w_" + t + "_mm"), tag == null || tag.isNull(1) ? ""
                    : Math.round(tag.getDouble(1)) + "° / " + Math.round(tag.getDouble(2)) + "°");
                for (int k = 0; k < 8; k++) {
                    int sym = id(res, pkg, "w_" + t + "_" + k + "_s");
                    int txt = id(res, pkg, "w_" + t + "_" + k + "_t");
                    JSONArray z = zellen == null ? null : zellen.optJSONArray(t * 8 + k);
                    if (z == null) {
                        rv.setImageViewResource(sym, R.drawable.wsym_leer);
                        rv.setTextViewText(txt, "");
                        continue;
                    }
                    String art = z.optString(0);
                    int bild = art.isEmpty() ? 0
                        : res.getIdentifier("wsym_" + art + (z.optBoolean(1, true) ? "_t" : "_n"), "drawable", pkg);
                    rv.setImageViewResource(sym, bild == 0 ? R.drawable.wsym_leer : bild);
                    rv.setInt(sym, "setImageAlpha", z.optBoolean(3) ? 150 : 255);
                    double temp = z.getDouble(2);
                    rv.setTextViewText(txt, Math.round(temp) + "°");
                    rv.setTextColor(txt, temp >= 25 ? Color.parseColor("#F87171")
                        : temp < 0 ? Color.parseColor("#60A5FA") : Color.parseColor("#F3F4F6"));
                }
            }
        } catch (Exception e) {
            rv.setTextViewText(R.id.w_stand, "Fehler");
        }

        Intent oeffnen = new Intent(c, MainActivity.class);
        oeffnen.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, oeffnen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.w_rahmen, pi);
        m.updateAppWidget(ids, rv);
    }

    private static int id(Resources res, String pkg, String name) {
        return res.getIdentifier(name, "id", pkg);
    }
}
