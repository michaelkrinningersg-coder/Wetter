package app.wetter.station;

import android.Manifest;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Brücke von der App (web/src/lokal/nativ.js) zu Widget und Meldungen:
 * Ort, Modell, Favoriten und Schalter ablegen, Erlaubnis für Meldungen.
 */
@CapacitorPlugin(
    name = "WetterNativ",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "meldungen") }
)
public class WetterNativ extends Plugin {

    @PluginMethod
    public void setzen(PluginCall call) {
        SharedPreferences.Editor e = Einstellungen.prefs(getContext()).edit();
        Double lat = call.getDouble("lat");
        Double lon = call.getDouble("lon");
        if (lat != null && lon != null) {
            e.putString("lat", Double.toString(lat));
            e.putString("lon", Double.toString(lon));
        }
        e.putString("name", call.getString("name", ""));
        e.putString("modell", call.getString("modell", "icon_d2"));
        e.putString("modellName", call.getString("modellName", ""));
        e.putString("favoriten", call.getString("favoriten", "[]"));
        e.putBoolean("unwetter", Boolean.TRUE.equals(call.getBoolean("unwetter", true)));
        e.putBoolean("rekorde", Boolean.TRUE.equals(call.getBoolean("rekorde", true)));
        e.apply();
        Einstellungen.planen(getContext());
        if (Boolean.TRUE.equals(call.getBoolean("neu", true))) Einstellungen.widgetJetzt(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("erlaubt", Meldung.erlaubt(getContext()));
        r.put("fehler", Einstellungen.prefs(getContext()).getString("fehler", ""));
        call.resolve(r);
    }

    @PluginMethod
    public void erlaubnis(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("meldungen") == PermissionState.GRANTED) {
            erlaubnisFertig(call);
        } else {
            requestPermissionForAlias("meldungen", call, "erlaubnisFertig");
        }
    }

    @PermissionCallback
    private void erlaubnisFertig(PluginCall call) {
        JSObject r = new JSObject();
        r.put("erlaubt", Meldung.erlaubt(getContext()));
        call.resolve(r);
    }

    /** Zum Ausprobieren: Widget und Rekorde sofort. */
    @PluginMethod
    public void jetzt(PluginCall call) {
        Einstellungen.widgetJetzt(getContext());
        Einstellungen.rekordeJetzt(getContext());
        call.resolve();
    }
}
