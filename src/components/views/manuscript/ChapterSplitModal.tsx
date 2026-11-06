/**
 * Modal de vista previa del Divisor Inteligente de Capítulos.
 *
 * Se abre tras importar un archivo cuando se detectan varios capítulos. Muestra
 * la lista de títulos detectados con su conteo aproximado de palabras y ofrece
 * dos acciones: importar como capítulos individuales o como documento único.
 */

import { FileText, Layers } from 'lucide-react'
import type { ChapterSection } from '../../../lib/chapterSplitter'
import { Modal } from '../../ui/Modal'

interface ChapterSplitModalProps {
  open: boolean
  fileName: string
  chapters: ChapterSection[]
  onClose: () => void
  onImportIndividual: () => void
  onImportSingle: () => void
}

function fmt(n: number): string {
  return n.toLocaleString('es')
}

export function ChapterSplitModal({
  open,
  fileName,
  chapters,
  onClose,
  onImportIndividual,
  onImportSingle,
}: ChapterSplitModalProps) {
  return (
    <Modal
      open={open}
      title="Capítulos detectados"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onImportIndividual}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
          >
            <Layers size={16} aria-hidden="true" />
            Importar como capítulos individuales
          </button>
          <button
            type="button"
            onClick={onImportSingle}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
          >
            <FileText size={16} aria-hidden="true" />
            Importar como documento único
          </button>
        </div>
      }
    >
      <p className="mb-1 text-sm text-zinc-300">
        Se han detectado{' '}
        <span className="font-semibold text-amber-300">{chapters.length}</span>{' '}
        capítulos en el documento.
      </p>
      <p className="mb-4 truncate text-xs text-zinc-500">{fileName}</p>

      <ul className="flex flex-col gap-1.5">
        {chapters.map((chapter, index) => (
          <li
            key={`${index}-${chapter.title}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-[11px] font-semibold text-zinc-400">
                {index + 1}
              </span>
              <span className="truncate text-sm text-zinc-200">
                {chapter.title}
              </span>
            </div>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {fmt(chapter.words)} palabras
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
