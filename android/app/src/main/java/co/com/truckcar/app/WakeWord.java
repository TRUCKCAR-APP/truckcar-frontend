package co.com.truckcar.app;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.IOException;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

/**
 * Escucha continua de la frase de activación del Copiloto con Vosk, en el teléfono y sin internet. A diferencia del
 * reconocedor de Android, una sola sesión queda abierta mientras la app escucha: no se reinicia cada pocos segundos ni
 * suena un pitido. Solo transcribe y avisa a la web («partial» y «result» con el texto); la web decide si oyó la frase
 * y, para la orden, usa el reconocedor de Android (más preciso con direcciones y lugares).
 */
@CapacitorPlugin(name = "WakeWord", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
public class WakeWord extends Plugin implements RecognitionListener {

    private static final String MODEL_ASSET = "model-es";
    private static final float SAMPLE_RATE = 16000.0f;

    private Model model;
    private SpeechService service;
    private boolean loading = false;

    @Override
    public void load() {
        try {
            LibVosk.setLogLevel(LogLevel.WARNINGS);
        } catch (Throwable ignored) {
            // Sin la librería nativa start() falla y la web usa el reconocedor de Android.
        }
    }

    @PluginMethod
    public void available(PluginCall call) {
        boolean present;
        try {
            String[] files = getContext().getAssets().list(MODEL_ASSET);
            present = files != null && files.length > 0;
        } catch (IOException e) {
            present = false;
        }
        JSObject result = new JSObject();
        result.put("available", present);
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("permission");
            return;
        }
        if (service != null) {
            call.resolve();
            return;
        }
        if (model != null) {
            listen(call);
            return;
        }
        if (loading) {
            call.reject("loading");
            return;
        }
        loading = true;
        try {
        // La primera vez copia el modelo de los assets al almacenamiento de la app (unos segundos); luego es inmediato.
        StorageService.unpack(getContext(), MODEL_ASSET, "model",
            (loaded) -> {
                synchronized (WakeWord.this) {
                    loading = false;
                    model = loaded;
                    listen(call);
                }
            },
            (error) -> {
                synchronized (WakeWord.this) {
                    loading = false;
                }
                call.reject("model: " + error.getMessage());
            });
        } catch (Throwable e) {
            loading = false;
            call.reject("model: " + e.getMessage());
        }
    }

    private void listen(PluginCall call) {
        try {
            Recognizer recognizer = new Recognizer(model, SAMPLE_RATE);
            service = new SpeechService(recognizer, SAMPLE_RATE);
            service.startListening(this);
            call.resolve();
        } catch (Throwable e) {
            release();
            call.reject("start: " + e.getMessage());
        }
    }

    /** Suelta el micrófono antes de responder, para que el reconocedor de Android pueda usarlo de inmediato. */
    @PluginMethod
    public synchronized void stop(PluginCall call) {
        release();
        call.resolve();
    }

    private synchronized void release() {
        if (service != null) {
            try {
                service.stop();
                service.shutdown();
            } catch (Exception ignored) {
                // El servicio ya estaba detenido.
            }
            service = null;
        }
    }

    @Override
    protected void handleOnPause() {
        // En segundo plano no se escucha: la web vuelve a pedir start() al regresar.
        release();
        notifyListeners("stopped", new JSObject());
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        release();
        if (model != null) {
            model.close();
            model = null;
        }
        super.handleOnDestroy();
    }

    private void emit(String event, String json, String field) {
        try {
            String text = new JSONObject(json).optString(field, "").trim();
            if (text.isEmpty()) return;
            JSObject data = new JSObject();
            data.put("text", text);
            notifyListeners(event, data);
        } catch (Exception ignored) {
            // Resultado sin texto.
        }
    }

    @Override
    public void onPartialResult(String hypothesis) {
        emit("partial", hypothesis, "partial");
    }

    @Override
    public void onResult(String hypothesis) {
        emit("result", hypothesis, "text");
    }

    @Override
    public void onFinalResult(String hypothesis) {
        emit("result", hypothesis, "text");
    }

    @Override
    public void onError(Exception exception) {
        release();
        JSObject data = new JSObject();
        data.put("message", exception == null ? "" : String.valueOf(exception.getMessage()));
        notifyListeners("error", data);
    }

    @Override
    public void onTimeout() {
        // Sin tiempo límite: no se usa.
    }
}
