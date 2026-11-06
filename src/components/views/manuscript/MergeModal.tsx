/**
 * Modal de fusión de manuscritos.
 *
 * Permite elegir con qué otro documento fusionar el documento de origen. El
 * contenido del origen se concatenará al final del documento elegido (destino).
 */

import { ArrowDownToLine } from 'lucide-react'
import type { Manuscript } from '../../../types'
import { Modal } from '../../ui/Modal'

interface MergeModalProps {
  open: boolean
  source: Manuscript | null
  candidates: Manuscript[]
  onClose: () => void
  onSelect: (targetId: string) => void
}

export function MergeModal({
  open,
  source,
  candidates,
  onClose,
  onSelect,
}: MergeModalProps) {
  return (
    <Modal open={open} title="Fusionar documento" onClose={onClose}>
      <p className="mb-4 text-sm text-zinc-400">
        El contenido de{' '}
        <span className="font-semibold text-zinc-200">{source?.title}</span> se
        añadirá al final del documento que elijas.
      </p>

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No hay otros documentos con los que fusionar.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {candidates.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left transition-colors hover:border-amber-500/40 hover:bg-zinc-900"
              >
                <ArrowDownToLine
                  size={16}
                  className="shrink-0 text-amber-400"
                  aria-hidden="true"
                />
                <span className="truncate text-sm text-zinc-200">
                  {doc.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
