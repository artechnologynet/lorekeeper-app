/**
 * Modal de fusión inteligente de entidades.
 *
 * Permite elegir la entidad duplicada con la que unir la entidad de origen.
 * Al seleccionar un objetivo, se habilita el botón "Fusionar con IA", que
 * dispara la síntesis con Gemini (en segundo plano) para producir una ficha
 * canónica única.
 */

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Users } from 'lucide-react'
import type { EntitySheet } from '../../../types'
import { Modal } from '../../ui/Modal'

interface EntityMergeModalProps {
  open: boolean
  source: EntitySheet | null
  candidates: EntitySheet[]
  /** Hay otra tarea de IA en curso (exclusión mutua global). */
  busy: boolean
  onClose: () => void
  onMerge: (targetId: string) => void
}

export function EntityMergeModal({
  open,
  source,
  candidates,
  busy,
  onClose,
  onMerge,
}: EntityMergeModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (open) setSelectedId(null)
  }, [open])

  return (
    <Modal
      open={open}
      title="Fusionar entidad con IA"
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
        Selecciona la ficha duplicada de{' '}
        <span className="font-semibold text-zinc-200">{source?.name}</span>. La IA
        combinará ambas en una sola ficha canónica y eliminará la duplicada.
      </p>

      {busy && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
          Hay otra tarea de IA en curso. Espera a que termine.
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No hay otras entidades con las que fusionar.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {candidates.map((entity) => {
            const selected = selectedId === entity.id
            return (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(entity.id)}
                  className={[
                    'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    selected
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-amber-500/30 hover:bg-zinc-900',
                  ].join(' ')}
                >
                  <Users
                    size={16}
                    className={selected ? 'shrink-0 text-amber-400' : 'shrink-0 text-zinc-500'}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-100">
                      {entity.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {entity.role}
                      {entity.narrativeRole ? ` · ${entity.narrativeRole}` : ''}
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
