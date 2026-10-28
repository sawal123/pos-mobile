package com.posoffline.app;

import android.app.Activity;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * AUTH-M04: memory-only Google ID-token acquisition through Android Credential
 * Manager. No credential or token is written to app storage.
 */
@CapacitorPlugin(name = "GoogleNativeAuth")
public class GoogleNativeAuthPlugin extends Plugin {
    static final String ERROR_CANCELLED = "USER_CANCELLED";
    static final String ERROR_NOT_CONFIGURED = "CONFIGURATION_INVALID";
    static final String ERROR_NOT_INITIALIZED = "NOT_INITIALIZED";
    static final String ERROR_CONCURRENT = "CONCURRENT_OPERATION";
    static final String ERROR_UNAVAILABLE = "PROVIDER_UNAVAILABLE";
    static final String ERROR_PROVIDER = "PROVIDER_ERROR";

    private final AtomicBoolean operationActive = new AtomicBoolean(false);
    private final AtomicLong operationSequence = new AtomicLong(0L);
    private final SecureRandom secureRandom = new SecureRandom();
    private CredentialManager credentialManager;
    private String webClientId;
    private PluginCall activeCall;

    @PluginMethod
    public void initialize(PluginCall call) {
        String requestedClientId = call.getString("webClientId", "");
        if (!isValidWebClientId(requestedClientId)) {
            call.reject("Google Web Client ID belum dikonfigurasi.", ERROR_NOT_CONFIGURED);
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Google Sign-In tidak tersedia saat ini.", ERROR_UNAVAILABLE);
            return;
        }

        // Idempotent initialization. No credential or token is read or stored.
        credentialManager = CredentialManager.create(activity);
        webClientId = requestedClientId.trim();
        call.resolve();
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        if (credentialManager == null || webClientId == null) {
            call.reject("Google Sign-In belum diinisialisasi.", ERROR_NOT_INITIALIZED);
            return;
        }

        if (!operationActive.compareAndSet(false, true)) {
            call.reject("Permintaan Google Sign-In sedang berjalan.", ERROR_CONCURRENT);
            return;
        }

        final long operationId = operationSequence.incrementAndGet();
        activeCall = call;
        final Activity activity = getActivity();
        if (activity == null) {
            operationActive.set(false);
            activeCall = null;
            call.reject("Google Sign-In tidak tersedia saat ini.", ERROR_UNAVAILABLE);
            return;
        }

        try {
            GetSignInWithGoogleOption googleOption = new GetSignInWithGoogleOption.Builder(webClientId)
                .setNonce(createNonce())
                .build();
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(googleOption)
                .build();

            credentialManager.getCredentialAsync(
                activity,
                request,
                null,
                ContextCompat.getMainExecutor(activity),
                new androidx.credentials.CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        if (!isCurrentOperation(operationId)) return;

                        try {
                            Credential credential = response.getCredential();
                            if (!(credential instanceof CustomCredential)
                                || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                rejectCurrent(call, operationId, ERROR_PROVIDER, "Kredensial Google tidak valid.");
                                return;
                            }

                            GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(credential.getData());
                            String idToken = googleCredential.getIdToken();
                            if (idToken == null || idToken.trim().isEmpty()) {
                                rejectCurrent(call, operationId, ERROR_PROVIDER, "Kredensial Google tidak lengkap.");
                                return;
                            }

                            // The assertion is returned only in this callback
                            // result for one in-memory backend exchange.
                            JSObject result = new JSObject();
                            result.put("idToken", idToken);
                            resolveCurrent(call, operationId, result);
                        } catch (Exception exception) {
                            rejectCurrent(call, operationId, ERROR_PROVIDER, "Google Sign-In gagal diproses.");
                        }
                    }

                    @Override
                    public void onError(@NonNull GetCredentialException exception) {
                        if (!isCurrentOperation(operationId)) return;

                        if (exception instanceof GetCredentialCancellationException) {
                            rejectCurrent(call, operationId, ERROR_CANCELLED, "Google Sign-In dibatalkan.");
                        } else if (exception instanceof NoCredentialException) {
                            rejectCurrent(call, operationId, ERROR_UNAVAILABLE, "Akun Google tidak tersedia pada perangkat ini.");
                        } else {
                            rejectCurrent(call, operationId, ERROR_PROVIDER, "Google Sign-In tidak dapat digunakan saat ini.");
                        }
                    }
                }
            );
        } catch (Exception exception) {
            rejectCurrent(call, operationId, ERROR_PROVIDER, "Google Sign-In tidak dapat dimulai.");
        }
    }

    @Override
    public void handleOnDestroy() {
        // Abandoned/recreated Activity callbacks must never activate a session.
        operationActive.set(false);
        operationSequence.incrementAndGet();
        PluginCall abandonedCall = activeCall;
        activeCall = null;
        credentialManager = null;
        webClientId = null;
        if (abandonedCall != null) {
            abandonedCall.reject("Google Sign-In dihentikan.", "STALE_OPERATION");
        }
        super.handleOnDestroy();
    }

    private boolean isCurrentOperation(long operationId) {
        return operationActive.get() && operationSequence.get() == operationId;
    }

    private void resolveCurrent(PluginCall call, long operationId, JSObject result) {
        if (!isCurrentOperation(operationId)) return;
        operationActive.set(false);
        activeCall = null;
        call.resolve(result);
    }

    private void rejectCurrent(PluginCall call, long operationId, String code, String message) {
        if (!isCurrentOperation(operationId)) return;
        operationActive.set(false);
        activeCall = null;
        call.reject(message, code);
    }

    private String createNonce() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.NO_PADDING | Base64.URL_SAFE);
    }

    static boolean isValidWebClientId(String clientId) {
        return clientId != null
            && clientId.trim().matches("^[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com$");
    }
}
