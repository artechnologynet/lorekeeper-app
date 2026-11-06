/**
 * Inicialización de características nativas (Capacitor).
 *
 * Configura la StatusBar y el Keyboard cuando la app corre como aplicación
 * nativa (Android). En navegador web no hace nada: los plugins exponen no-ops
 * o se omiten tras comprobar `Capacitor.isNativePlatform()`.
 */

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'

/** Configura los plugins nativos. Seguro de llamar en web (se ignora). */
export async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    // StatusBar: tema oscuro, no superpuesta (el contenido respeta su altura).
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#09090b' })
  } catch {
    // La StatusBar puede no estar disponible en algunos dispositivos; se ignora.
  }

  try {
    // Keyboard: reajuste nativo para que el input fijo no quede oculto.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    await Keyboard.setScroll({ isDisabled: false })
  } catch {
    // Teclado no disponible en este entorno; se ignora.
  }
}
