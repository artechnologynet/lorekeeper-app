/**
 * Modal de fusión inteligente de términos del glosario.
 *
 * Permite elegir el término duplicado con el que unir el término de origen.
 * Al seleccionar un objetivo, se habilita el botón "Fusionar con IA", que
 * dispara la síntesis con Gemini (en segundo plano) para producir una entrada
 * canónica única: nombre principal, definición consolidada, notas combinadas y
 * apariciones/capítulos unificados.
 */

import { useEffect, useState } from 'react'
import { BookOpen, Loader2, Sparkles } from 'lucide-react'
import type { GlossaryTerm } from '../../../types'
import { Modal } from '../../ui/Modal'

interface GlossaryMergeModalProps {
  open: boolean
  source: GlossaryTerm | null
  candidates: GlossaryTerm[]
  /** Hay otra tarea de IA en curso (exclusión mutua global). */
  busy: boolean
  onClose: () => void
  onMerge: (targetId: string) => void
}

export function GlossaryMergeModal({
  open,
  source,
  candidates,
  busy,
  onClose,
  onMerge,
}: GlossaryMergeModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (open) setSelectedId(null)
  }, [open])

  return (
    <Modal
      open={open}
      title="Fusionar término con IA"
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!selectedId || busy}
          onClick={() => selectedId && onMerge(selectedId)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={16} aria-hidden="true" />
          Fusionar con IA
        </button>
      }
    >
      <p className="mb-4 text-sm text-zinc-400">
        Selecciona el término duplicado de{' '}
        <span className="font-semibold text-zinc-200">{source?.term}</span>. La IA
        combinará ambos en una sola entrada canónica (definición, notas y
        apariciones) y eliminará el duplicado.
      </p>

      {busy && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
          Hay otra tarea de IA en curso. Espera a que termine.
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No hay otros términos con los que fusionar.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {candidates.map((term) => {
            const selected = selectedId === term.id
            return (
              <li key={term.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(term.id)}
                  className={[
                    'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    selected
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-amber-500/30 hover:bg-zinc-900',
                  ].join(' ')}
                >
                  <BookOpen
                    size={16}
                    className={selected ? 'shrink-0 text-amber-400' : 'shrink-0 text-zinc-500'}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-100">
                      {term.term}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {term.category}
                      {term.definition ? ` · ${term.definition}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
