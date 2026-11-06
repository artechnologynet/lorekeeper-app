/**
 * Render visual de los toasts globales (éxito/error/info) que se autodescartan.
 *
 * El indicador de tareas de análisis en segundo plano se renderiza por separado
 * en <AnalysisBadge> (badge flotante colapsable).
 *
 * Se monta una sola vez cerca de la raíz, dentro del NotificationProvider.
 */

import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useNotifications } from '../lib/NotificationContext'
import type { ToastKind } from '../lib/NotificationContext'

const TOAST_STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/30 bg-red-500/10 text-red-200',
  info: 'border-zinc-700 bg-zinc-900 text-zinc-200',
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return <CheckCircle2 size={16} className="shrink-0 text-emerald-400" aria-hidden="true" />
  }
  if (kind === 'error') {
    return <XCircle size={16} className="shrink-0 text-red-400" aria-hidden="true" />
  }
  return <Info size={16} className="shrink-0 text-zinc-400" aria-hidden="true" />
}

export function NotificationHost() {
  const { toasts, dismissToast } = useNotifications()

  return (
    <>
      {/* El indicador de análisis en segundo plano se renderiza aparte en
          <AnalysisBadge> (badge colapsable). Aquí solo viven los toasts. */}

      {/* Pila de toasts (sobre la barra inferior) */}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={[
                'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg shadow-black/30 backdrop-blur-md',
                TOAST_STYLES[toast.kind],
              ].join(' ')}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              <ToastIcon kind={toast.kind} />
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Cerrar notificación"
                className="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
