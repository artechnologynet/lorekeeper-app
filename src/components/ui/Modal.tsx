/**
 * Modal base reutilizable, mobile-first.
 *
 * Aparece como hoja (sheet) desde abajo en móvil y centrado en pantallas
 * grandes. Incluye cabecera con título y botón de cierre, y cuerpo scrollable.
 * Opcionalmente renderiza un pie fijo (footer) para acciones.
 */

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-zinc-900 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div
            className="border-t border-zinc-800 px-5 py-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
