/**
 * Modal de exportación a Microsoft Word (.docx).
 *
 * Permite elegir qué secciones incluir (Entidades, Glosario, Compendio) y el
 * destino: descarga local o guardado en la carpeta LoreKeeper de Google Drive.
 *
 * Si se abre desde una sección concreta, solo esa casilla queda marcada; si se
 * abre desde el Header, quedan marcadas todas.
 */

import { useEffect, useMemo, useState } from 'react'
import { Cloud, Download, FileDown, Loader2 } from 'lucide-react'
import { Modal } from './ui/Modal'
import { useLoreKeeperContext } from '../lib/useLoreKeeperContext'
import { useNotifications } from '../lib/NotificationContext'
import {
  ensureDriveSession,
  loadDriveState,
  uploadBinaryToDrive,
} from '../lib/driveSync'

/** Identificador de cada sección exportable. */
export type ExportSectionId = 'entities' | 'glossary' | 'compendium'

type Destination = 'local' | 'drive'

interface ExportDocxModalProps {
  open: boolean
  /** Sección desde la que se abrió el modal (null = todas). */
  initialSection: ExportSectionId | null
  onClose: () => void
}

const ALL_SECTIONS: Record<ExportSectionId, boolean> = {
  entities: true,
  glossary: true,
  compendium: true,
}

export function ExportDocxModal({
  open,
  initialSection,
  onClose,
}: ExportDocxModalProps) {
  const { data } = useLoreKeeperContext()
  const { notify } = useNotifications()

  const [selection, setSelection] = useState<Record<ExportSectionId, boolean>>(ALL_SECTIONS)
  const [destination, setDestination] = useState<Destination>('local')
  const [exporting, setExporting] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)

  // Reinicia las opciones cada vez que se abre el modal.
  useEffect(() => {
    if (!open) return
    setSelection(
      initialSection
        ? { entities: false, glossary: false, compendium: false, [initialSection]: true }
        : ALL_SECTIONS,
    )
    setDestination('local')
    setDriveConnected(loadDriveState() !== null)
  }, [open, initialSection])

  const sections = useMemo(
    () => [
      { id: 'entities' as const, label: 'Entidades / Personajes', count: data.entities.length },
      { id: 'glossary' as const, label: 'Glosario de Términos', count: data.glossary.length },
      { id: 'compendium' as const, label: 'Compendio / Anexos', count: data.compendium.length },
    ],
    [data.entities.length, data.glossary.length, data.compendium.length],
  )

  const anySelected = selection.entities || selection.glossary || selection.compendium

  const toggle = (id: ExportSectionId) =>
    setSelection((prev) => ({ ...prev, [id]: !prev[id] }))

  const handleExport = async () => {
    if (!anySelected || exporting) return
    setExporting(true)

    try {
      // Drive primero: la autorización web debe ocurrir dentro del gesto de clic.
      if (destination === 'drive') {
        const session = await ensureDriveSession()
        if (!session.ok) {
          notify(session.error, 'error')
          return
        }
      }

      // Carga diferida: docx y file-saver no forman parte del bundle inicial.
      const generator = await import('../lib/docxGenerator')
      const blob = await generator.generateLoreDocx(data, selection)
      const filename = generator.buildDocxFilename(data)

      if (destination === 'drive') {
        const uploaded = await uploadBinaryToDrive(filename, blob, generator.DOCX_MIME)
        if (!uploaded.ok) {
          notify(uploaded.error, 'error')
          return
        }
        notify(`Guardado en Google Drive (carpeta LoreKeeper): ${filename}`, 'success')
      } else {
        let outcome: Awaited<ReturnType<typeof generator.saveDocxLocally>>
        try {
          outcome = await generator.saveDocxLocally(blob, filename)
        } catch {
          notify('No se pudo guardar el archivo en el dispositivo.', 'error')
          return
        }
        if (outcome === 'cancelled') {
          notify('Exportación cancelada: no se eligió un destino.', 'info')
          return
        }
        notify(
          outcome === 'shared'
            ? `Documento listo: ${filename}`
            : `Documento generado: ${filename}`,
          'success',
        )
      }
      onClose()
    } catch {
      notify('No se pudo generar el documento de Word.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Exportar a Word"
      onClose={exporting ? () => undefined : onClose}
      footer={
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={!anySelected || exporting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Generando documento…
            </>
          ) : (
            <>
              <FileDown size={16} aria-hidden="true" />
              {destination === 'drive' ? 'Guardar en Google Drive' : 'Descargar .docx'}
            </>
          )}
        </button>
      }
    >
      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-semibold text-zinc-200">
          Secciones a incluir
        </legend>
        <div className="flex flex-col gap-2">
          {sections.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:border-amber-500/30"
            >
              <input
                type="checkbox"
                checked={selection[s.id]}
                onChange={() => toggle(s.id)}
                className="h-4 w-4 accent-amber-500"
              />
              <span className="flex-1">{s.label}</span>
              <span className="text-xs text-zinc-500">{s.count}</span>
            </label>
          ))}
        </div>
        {!anySelected && (
          <p className="mt-2 text-xs text-amber-300/80" role="status">
            Selecciona al menos una sección.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-zinc-200">
          Destino del documento
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:border-amber-500/30">
            <input
              type="radio"
              name="docx-destination"
              checked={destination === 'local'}
              onChange={() => setDestination('local')}
              className="h-4 w-4 accent-amber-500"
            />
            <Download size={16} className="text-zinc-400" aria-hidden="true" />
            <span>Descargar archivo local (.docx)</span>
          </label>

          <label
            className={[
              'flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm transition-colors',
              driveConnected
                ? 'cursor-pointer text-zinc-200 hover:border-amber-500/30'
                : 'cursor-not-allowed text-zinc-500 opacity-70',
            ].join(' ')}
          >
            <input
              type="radio"
              name="docx-destination"
              checked={destination === 'drive'}
              disabled={!driveConnected}
              onChange={() => setDestination('drive')}
              className="h-4 w-4 accent-amber-500"
            />
            <Cloud size={16} className="text-zinc-400" aria-hidden="true" />
            <span>Guardar en Google Drive</span>
          </label>
          {!driveConnected && (
            <p className="text-xs text-zinc-500">
              Conecta tu cuenta en Ajustes para guardar en la carpeta LoreKeeper de Drive.
            </p>
          )}
        </div>
      </fieldset>
    </Modal>
  )
}
