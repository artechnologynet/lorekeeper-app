package com.lorekeeper.app;

import android.content.Intent;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

/**
 * MainActivity adaptada para @capgo/capacitor-social-login.
 *
 * El plugin exige que, al solicitar scopes personalizados de Google (como
 * drive.file), la MainActivity implemente la interfaz marcadora
 * {@link ModifiedMainActivityForSocialLoginPlugin} y reenvíe el resultado de la
 * actividad de autorización al plugin mediante {@code handleGoogleLoginIntent}.
 */
public class MainActivity extends BridgeActivity
        implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        // Reenvía únicamente los resultados del flujo de autorización de Google.
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                return;
            }
            SocialLoginPlugin plugin = (SocialLoginPlugin) pluginHandle.getInstance();
            plugin.handleGoogleLoginIntent(requestCode, data);
        }
    }

    // Marcador requerido por el plugin: confirma que esta MainActivity fue
    // modificada para integrarse con SocialLogin.
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
