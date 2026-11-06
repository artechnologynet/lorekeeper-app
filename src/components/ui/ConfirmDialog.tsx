/**
 * Diálogo de confirmación (p. ej. para eliminar registros).
 *
 * Centrado y compacto. La acción de confirmación se resalta en rojo cuando es
 * destructiva.
 */

import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Cancelar"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <span
            className={[
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              destructive
                ? 'bg-red-500/15 text-red-400'
                : 'bg-amber-500/15 text-amber-400',
            ].join(' ')}
          >
            <AlertTriangle size={20} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2',
              destructive
                ? 'bg-red-500 text-white hover:bg-red-400 focus-visible:ring-red-500/60'
                : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 focus-visible:ring-amber-500/60',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
