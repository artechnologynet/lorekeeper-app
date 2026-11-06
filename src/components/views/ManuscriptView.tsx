/**
 * Vista de Manuscrito / Archivos.
 *
 * Gestión de múltiples documentos/capítulos:
 *   - Lista vertical táctil de documentos con badge de estado + creación e importación.
 *   - Editor de texto limpio y responsivo (escribir o pegar).
 *   - Métricas en tiempo real: palabras, caracteres y páginas estimadas.
 *   - Renombrar / eliminar (con confirmación) y copiar al portapapeles.
 *   - Botón "Analizar y sincronizar" que lanza el análisis GLOBAL no bloqueante.
 *
 * Estados por documento (status):
 *   - draft    Borrador (nuevo o editado tras analizar).
 *   - pending  Pendiente (importado, aún sin analizar — o en análisis).
 *   - analyzed Analizado y sincronizado.
 *
 * El análisis se ejecuta en el AnalysisContext (raíz de la app), por lo que el
 * autor puede cerrar el editor o cambiar de sección mientras la IA procesa.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpToLine,
  Check,
  CheckSquare,
  Copy,
  FilePlus2,
  FolderOpen,
  GitMerge,
  ListChecks,
  Loader2,
  Pencil,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { Manuscript, ManuscriptStatus } from '../../types'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { useAnalysis } from '../../lib/AnalysisContext'
import { useNotifications } from '../../lib/NotificationContext'
import { computeMetrics, importFile } from '../../lib/documents'
import { splitIntoChapters } from '../../lib/chapterSplitter'
import type { ChapterSection } from '../../lib/chapterSplitter'
import { MergeModal } from './manuscript/MergeModal'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { RenameDialog } from './manuscript/RenameDialog'
import { ChapterSplitModal } from './manuscript/ChapterSplitModal'

/** A partir de cuántos capítulos se ofrece la división. */
const CHAPTER_SPLIT_THRESHOLD = 5

/** Formatea números con separador de miles en español. */
function fmt(n: number): string {
  return n.toLocaleString('es')
}

/** Etiqueta y clases del badge según el estado del documento. */
const STATUS_BADGE: Record<ManuscriptStatus, { label: string; className: string }> = {
  draft: {
    label: 'Borrador',
    className: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  },
  pending: {
    label: 'Pendiente',
    className: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  },
  analyzed: {
    label: 'Analizado',
    className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  },
}

function StatusBadge({ status }: { status: ManuscriptStatus }) {
  const badge = STATUS_BADGE[status]
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${badge.className}`}
    >
      {badge.label}
    </span>
  )
}

export function ManuscriptView() {
  const { data, manuscripts, mergeManuscripts, removeManuscripts } =
    useLoreKeeperContext()
  const {
    analyzeManuscriptById,
    analyzeManuscriptsBatch,
    analyzingIds,
    isBusy,
    batchProgress,
    cancelBatch,
  } = useAnalysis()
  const { notify } = useNotifications()
  const docs = data.manuscripts

  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [toDelete, setToDelete] = useState<Manuscript | null>(null)

  // Propuesta de división de capítulos pendiente de confirmar (modal).
  const [splitProposal, setSplitProposal] = useState<{
    fileName: string
    chapters: ChapterSection[]
    fullTitle: string
    fullContent: string
  } | null>(null)

  // Menú de opciones abierto (por id de documento) y origen de fusión.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [mergeSource, setMergeSource] = useState<Manuscript | null>(null)

  // Modo de selección múltiple y borrado por lotes.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Marca si el lote actual se lanzó desde esta vista (para salir de selección).
  const batchLaunchedRef = useRef(false)

  const active = useMemo(
    () => docs.find((d) => d.id === activeId) ?? null,
    [docs, activeId],
  )

  // Sincroniza el borrador cuando cambia el documento activo.
  useEffect(() => {
    setDraft(active?.content ?? '')
  }, [active?.id])

  const metrics = useMemo(() => computeMetrics(draft), [draft])

  const isActiveAnalyzing = active ? analyzingIds.has(active.id) : false

  /**
   * Persiste el contenido mientras se escribe. Si el documento estaba
   * 'analyzed', vuelve a 'draft' para indicar que hubo cambios tras el análisis.
   */
  const handleDraftChange = (value: string) => {
    setDraft(value)
    if (!active) return
    if (active.status === 'analyzed') {
      manuscripts.update(active.id, { content: value, status: 'draft' })
    } else {
      manuscripts.update(active.id, { content: value })
    }
  }

  const createBlank = () => {
    const index = docs.length + 1
    const record = manuscripts.add({
      title: `Documento ${index}`,
      content: '',
      tags: [],
      status: 'draft',
    })
    setActiveId(record.id)
  }

  const handleImportClick = () => {
    setImportError(null)
    fileInputRef.current?.click()
  }

  /** Crea un manuscrito importado (estado 'pending') y devuelve su id. */
  const addImported = (title: string, content: string): string => {
    const record = manuscripts.add({ title, content, tags: [], status: 'pending' })
    return record.id
  }

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    // IMPORTANTE: capturar los File en un array estable ANTES de tocar el input.
    // Limpiar `value` vacía el FileList en varios navegadores, por lo que hay
    // que materializar los archivos primero o se perderían tras el await.
    const input = event.target
    const selected = input.files ? Array.from(input.files) : []
    input.value = '' // permite volver a elegir el mismo archivo después

    if (selected.length === 0) return

    setImporting(true)
    setImportError(null)

    const imported: { title: string; content: string }[] = []
    const errors: string[] = []

    for (const file of selected) {
      const result = await importFile(file)
      if (result.ok) {
        imported.push({ title: result.title, content: result.content })
      } else {
        errors.push(result.error)
      }
    }

    setImporting(false)
    if (errors.length > 0) setImportError(errors.join(' '))
    if (imported.length === 0) return

    // Si un ÚNICO archivo contiene muchos capítulos, ofrece dividirlo (modal).
    if (imported.length === 1) {
      const [doc] = imported
      const split = splitIntoChapters(doc.content)
      if (split.detected && split.chapters.length >= CHAPTER_SPLIT_THRESHOLD) {
        setSplitProposal({
          fileName: doc.title,
          chapters: split.chapters,
          fullTitle: doc.title,
          fullContent: doc.content,
        })
        return // Espera la decisión del usuario en el modal.
      }
    }

    // Caso normal: crea cada archivo como un documento individual.
    let lastId: string | null = null
    for (const doc of imported) {
      lastId = addImported(doc.title, doc.content)
    }
    if (lastId) setActiveId(lastId)
  }

  /** Confirma la división: crea un manuscrito por capítulo detectado. */
  const handleImportChapters = () => {
    if (!splitProposal) return
    for (const chapter of splitProposal.chapters) {
      addImported(chapter.title, chapter.content)
    }
    const count = splitProposal.chapters.length
    setSplitProposal(null)
    notify(`Se importaron ${count} capítulos listos para analizar.`, 'success')
  }

  /** Importa el archivo completo como un único documento. */
  const handleImportSingle = () => {
    if (!splitProposal) return
    const id = addImported(splitProposal.fullTitle, splitProposal.fullContent)
    setSplitProposal(null)
    setActiveId(id)
    notify('Documento importado.', 'success')
  }

  const handleCopy = async () => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Algunos navegadores bloquean clipboard sin gesto directo; se ignora.
    }
  }

  const handleRename = (title: string) => {
    if (active) manuscripts.update(active.id, { title })
    setRenaming(false)
  }

  /**
   * Lanza el análisis GLOBAL del documento activo. No bloquea: delega en el
   * AnalysisContext (vive en la raíz), de modo que el autor puede cerrar el
   * editor o navegar mientras Gemini procesa en segundo plano.
   */
  const handleAnalyzeActive = () => {
    if (active) analyzeManuscriptById(active.id)
  }

  const confirmDelete = () => {
    if (toDelete) {
      manuscripts.remove(toDelete.id)
      if (activeId === toDelete.id) setActiveId(null)
    }
    setToDelete(null)
  }

  /** Fusiona un documento dentro de otro (target recibe el contenido). */
  const runMerge = (targetId: string, sourceId: string) => {
    const ok = mergeManuscripts(targetId, sourceId)
    setMenuOpenId(null)
    setMergeSource(null)
    if (ok) {
      // Si el documento absorbido estaba activo, cambia al receptor.
      if (activeId === sourceId) setActiveId(targetId)
      notify('Documento fusionado con éxito.', 'success')
    }
  }

  /** Fusiona el documento con el inmediatamente anterior en la lista. */
  const mergeWithPrevious = (docId: string) => {
    const index = docs.findIndex((d) => d.id === docId)
    if (index <= 0) return
    const previous = docs[index - 1]
    runMerge(previous.id, docId)
  }

  /* --- Selección múltiple --- */

  const enterSelection = () => {
    setSelectionMode(true)
    setSelectedIds(new Set())
    setMenuOpenId(null)
  }

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = docs.length > 0 && selectedIds.size === docs.length

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(docs.map((d) => d.id)))
  }

  const confirmBulkDelete = () => {
    const ids = Array.from(selectedIds)
    removeManuscripts(ids)
    if (activeId && ids.includes(activeId)) setActiveId(null)
    setBulkDeleteOpen(false)
    exitSelection()
    notify(
      `Se eliminaron ${ids.length} ${ids.length === 1 ? 'documento' : 'documentos'}.`,
      'success',
    )
  }

  /** Lanza el análisis por lote de los capítulos seleccionados. */
  const handleBatchAnalyze = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    analyzeManuscriptsBatch(ids)
    batchLaunchedRef.current = true
  }

  // Al terminar la cola del lote (batchProgress vuelve a null), sale del modo
  // selección. Solo aplica a lotes lanzados desde esta vista.
  useEffect(() => {
    if (batchProgress === null && batchLaunchedRef.current) {
      batchLaunchedRef.current = false
      setSelectionMode(false)
      setSelectedIds(new Set())
    }
  }, [batchProgress])

  /* ----------------------------------------------------------------------- */
  /* Vista de EDICIÓN de un documento                                        */
  /* ----------------------------------------------------------------------- */
  if (active) {
    return (
      <section className="flex flex-col gap-4">
        {/* Barra superior del editor */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveId(null)}
            aria-label="Volver a la lista"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <h2 className="flex-1 truncate text-base font-semibold text-zinc-100">
            {active.title}
          </h2>
          <button
            type="button"
            onClick={handleAnalyzeActive}
            disabled={isBusy}
            aria-label="Analizar y sincronizar con IA"
            title={
              isBusy && !isActiveAnalyzing
                ? 'Hay otra tarea de IA en curso. Espera a que termine.'
                : 'Analizar y sincronizar con IA'
            }
            className="flex h-9 w-9 items-center justify-center rounded-xl text-amber-400 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isActiveAnalyzing ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label="Renombrar documento"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copiar texto"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            {copied ? (
              <Check size={16} className="text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setToDelete(active)}
            aria-label="Eliminar documento"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Estado + métricas en tiempo real */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge status={active.status} />
          <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-zinc-400 ring-1 ring-zinc-800">
            <span className="font-semibold text-zinc-200">{fmt(metrics.words)}</span>{' '}
            palabras
          </span>
          <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-zinc-400 ring-1 ring-zinc-800">
            <span className="font-semibold text-zinc-200">
              {fmt(metrics.characters)}
            </span>{' '}
            caracteres
          </span>
          <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-zinc-400 ring-1 ring-zinc-800">
            <span className="font-semibold text-zinc-200">{fmt(metrics.pages)}</span>{' '}
            {metrics.pages === 1 ? 'página' : 'páginas'}
          </span>
        </div>

        {/* Editor */}
        <textarea
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          placeholder="Empieza a escribir o pega tu texto aquí..."
          className="no-scrollbar min-h-[60dvh] w-full resize-y rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
          aria-label={`Editor de ${active.title}`}
        />

        <RenameDialog
          open={renaming}
          currentTitle={active.title}
          onClose={() => setRenaming(false)}
          onSubmit={handleRename}
        />

        <ConfirmDialog
          open={toDelete !== null}
          title="Eliminar documento"
          message={`¿Seguro que quieres eliminar "${toDelete?.title}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      </section>
    )
  }

  /* ----------------------------------------------------------------------- */
  /* Vista de LISTA de documentos                                            */
  /* ----------------------------------------------------------------------- */
  return (
    <section className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <FolderOpen size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">
              Manuscrito / Archivos
            </h2>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {docs.length}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Documentos y capítulos de tu universo narrativo.
          </p>
        </div>
      </div>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={createBlank}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        >
          <FilePlus2 size={16} aria-hidden="true" />
          Nuevo documento
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={importing}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {importing ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Importando
            </>
          ) : (
            <>
              <Upload size={16} aria-hidden="true" />
              Importar archivo
            </>
          )}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Barra de selección: botón Seleccionar o barra de acciones masivas */}
      {docs.length > 0 &&
        (!selectionMode ? (
          <button
            type="button"
            onClick={enterSelection}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-amber-500/30 hover:text-zinc-100"
          >
            <ListChecks size={16} aria-hidden="true" />
            Seleccionar
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/30 bg-zinc-900/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm font-medium text-zinc-200 transition-colors hover:text-amber-300"
              >
                {allSelected ? (
                  <CheckSquare size={18} className="text-amber-400" aria-hidden="true" />
                ) : (
                  <Square size={18} aria-hidden="true" />
                )}
                {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </button>
              <span className="text-xs text-zinc-400">
                {selectedIds.size}{' '}
                {selectedIds.size === 1
                  ? 'documento seleccionado'
                  : 'documentos seleccionados'}
              </span>
            </div>
            {/* Acción principal destacada: analizar en lote */}
            <button
              type="button"
              disabled={selectedIds.size === 0 || isBusy}
              onClick={handleBatchAnalyze}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchProgress ? (
                <>
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  Analizando {batchProgress.current} de {batchProgress.total}…
                </>
              ) : (
                <>
                  <Sparkles size={15} aria-hidden="true" />
                  Analizar seleccionados ({selectedIds.size})
                </>
              )}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exitSelection}
                disabled={batchProgress !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={15} aria-hidden="true" />
                Cancelar
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || isBusy}
                onClick={() => setBulkDeleteOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={15} aria-hidden="true" />
                Eliminar seleccionados
              </button>
            </div>
          </div>
        ))}

      {/* Indicador de progreso general del análisis por lote */}
      {batchProgress && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm text-amber-200">
              <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
              <span className="truncate">
                Analizando capítulo {batchProgress.current} de {batchProgress.total}…
              </span>
            </div>
            <button
              type="button"
              onClick={cancelBatch}
              aria-label="Detener análisis por lote"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-300"
            >
              <X size={14} aria-hidden="true" />
              Detener
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-300"
              style={{
                width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {importError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {importError}
        </p>
      )}

      {/* Lista de documentos */}
      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-zinc-500">
            No hay documentos. Crea uno en blanco o importa un archivo .txt, .md
            o .docx.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc, index) => {
            const m = computeMetrics(doc.content)
            const analyzing = analyzingIds.has(doc.id)
            const menuOpen = menuOpenId === doc.id
            const canMergePrevious = index > 0
            const checked = selectedIds.has(doc.id)
            return (
              <li key={doc.id} className="relative">
                <div
                  className={[
                    'flex items-stretch gap-1 rounded-2xl border bg-zinc-900/60 transition-colors',
                    checked
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-zinc-800 hover:border-amber-500/30 hover:bg-zinc-900',
                  ].join(' ')}
                >
                  {/* Checkbox en modo selección */}
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelected(doc.id)}
                      aria-label={checked ? 'Deseleccionar' : 'Seleccionar'}
                      aria-pressed={checked}
                      className="flex w-11 shrink-0 items-center justify-center rounded-l-2xl text-zinc-400 transition-colors hover:text-amber-300"
                    >
                      {checked ? (
                        <CheckSquare size={18} className="text-amber-400" aria-hidden="true" />
                      ) : (
                        <Square size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}

                  {/* Área principal: abre el documento (o selecciona en modo selección) */}
                  <button
                    type="button"
                    onClick={() =>
                      selectionMode ? toggleSelected(doc.id) : setActiveId(doc.id)
                    }
                    className={[
                      'flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left',
                      selectionMode ? '' : 'rounded-l-2xl',
                    ].join(' ')}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-zinc-100">
                          {doc.title}
                        </h3>
                        <StatusBadge status={doc.status} />
                        {analyzing && (
                          <Loader2
                            size={13}
                            className="shrink-0 animate-spin text-amber-400"
                            aria-label="Analizando"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {fmt(m.words)} palabras · {fmt(m.pages)}{' '}
                        {m.pages === 1 ? 'página' : 'páginas'}
                      </p>
                    </div>
                    {!selectionMode && (
                      <span className="shrink-0 text-xs text-amber-400">Abrir</span>
                    )}
                  </button>

                  {/* Controles de fila (ocultos en modo selección) */}
                  {!selectionMode && (
                    <>
                      {/* Analizar con IA (acción rápida, sin abrir el editor) */}
                      <button
                        type="button"
                        onClick={() => analyzeManuscriptById(doc.id)}
                        disabled={isBusy}
                        aria-label={`Analizar ${doc.title} con IA`}
                        title={
                          isBusy && !analyzing
                            ? 'Hay otra tarea de IA en curso. Espera a que termine.'
                            : 'Analizar con IA'
                        }
                        className="flex w-11 shrink-0 items-center justify-center text-amber-400 transition-colors hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {analyzing ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles size={16} aria-hidden="true" />
                        )}
                      </button>
                      {/* Papelera individual */}
                      <button
                        type="button"
                        onClick={() => setToDelete(doc)}
                        aria-label={`Eliminar ${doc.title}`}
                        className="flex w-11 shrink-0 items-center justify-center text-zinc-400 transition-colors hover:text-red-400"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                      {/* Opciones (fusión) */}
                      <button
                        type="button"
                        onClick={() => setMenuOpenId(menuOpen ? null : doc.id)}
                        aria-label="Opciones del documento"
                        aria-expanded={menuOpen}
                        className="flex w-11 shrink-0 items-center justify-center rounded-r-2xl text-zinc-400 transition-colors hover:text-amber-300"
                      >
                        <GitMerge size={16} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>

                {/* Menú desplegable de fusión */}
                {menuOpen && !selectionMode && (
                  <>
                    {/* Capa para cerrar al tocar fuera */}
                    <button
                      type="button"
                      aria-label="Cerrar menú"
                      onClick={() => setMenuOpenId(null)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div className="absolute right-2 top-[calc(100%-0.5rem)] z-20 w-60 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/40">
                      <button
                        type="button"
                        disabled={!canMergePrevious}
                        onClick={() => mergeWithPrevious(doc.id)}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ArrowUpToLine size={15} className="shrink-0 text-amber-400" aria-hidden="true" />
                        Fusionar con el anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMergeSource(doc)
                          setMenuOpenId(null)
                        }}
                        className="flex w-full items-center gap-2.5 border-t border-zinc-800 px-3.5 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
                      >
                        <GitMerge size={15} className="shrink-0 text-amber-400" aria-hidden="true" />
                        Fusionar con…
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ChapterSplitModal
        open={splitProposal !== null}
        fileName={splitProposal?.fileName ?? ''}
        chapters={splitProposal?.chapters ?? []}
        onClose={() => setSplitProposal(null)}
        onImportIndividual={handleImportChapters}
        onImportSingle={handleImportSingle}
      />

      <MergeModal
        open={mergeSource !== null}
        source={mergeSource}
        candidates={docs.filter((d) => d.id !== mergeSource?.id)}
        onClose={() => setMergeSource(null)}
        onSelect={(targetId) => {
          if (mergeSource) runMerge(targetId, mergeSource.id)
        }}
      />

      {/* Confirmación de borrado individual (papelera por fila) */}
      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar documento"
        message={`¿Seguro que quieres eliminar "${toDelete?.title}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      {/* Confirmación de borrado por lotes */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Eliminar documentos"
        message={`¿Estás seguro de eliminar ${selectedIds.size} ${
          selectedIds.size === 1 ? 'manuscrito' : 'manuscritos'
        }? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </section>
  )
}
