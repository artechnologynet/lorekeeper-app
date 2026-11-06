/**
 * Vista del Compendio / Anexos.
 *
 * - Tabs de anexos existentes + botón para crear uno nuevo.
 * - Modo dual: Vista previa (Markdown renderizado) y Edición (textarea).
 * - Copiar el contenido al portapapeles y descargar el anexo como .md.
 *
 * Todo determinista sobre el contexto de LoreKeeper; sin llamadas de red.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Eye,
  FileDown,
  Pencil,
  Plus,
  Scroll,
  SquarePen,
  Trash2,
} from 'lucide-react'
import type { CompendiumAnnex } from '../../types'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { useExportDocx } from '../../lib/ExportDocxContext'
import type { CompendiumInput } from '../../lib/useLoreKeeper'
import { renderMarkdown } from '../../lib/markdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { AnnexMetaForm } from './compendium/AnnexMetaForm'

type Mode = 'preview' | 'edit'

/** Genera un nombre de archivo .md seguro a partir del título. */
function toFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'anexo'}.md`
}

/** Construye el contenido .md completo (encabezado + cuerpo). */
function buildMarkdownFile(annex: CompendiumAnnex): string {
  const header: string[] = [`# ${annex.title}`]
  if (annex.subtitle) header.push(`_${annex.subtitle}_`)
  if (annex.type) header.push(`> Tipo: ${annex.type}`)
  header.push('')
  return `${header.join('\n')}\n${annex.contentMarkdown}`
}

export function CompendiumView() {
  const { data, compendium } = useLoreKeeperContext()
  const { openExport } = useExportDocx()
  const annexes = data.compendium

  const [activeId, setActiveId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('preview')
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [editingMeta, setEditingMeta] = useState<CompendiumAnnex | null>(null)
  const [toDelete, setToDelete] = useState<CompendiumAnnex | null>(null)

  // Asegura un anexo activo válido cuando cambia la colección.
  useEffect(() => {
    if (annexes.length === 0) {
      setActiveId(null)
      return
    }
    if (!activeId || !annexes.some((a) => a.id === activeId)) {
      setActiveId(annexes[0].id)
    }
  }, [annexes, activeId])

  const active = useMemo(
    () => annexes.find((a) => a.id === activeId) ?? null,
    [annexes, activeId],
  )

  // Sincroniza el borrador al cambiar de anexo activo o al entrar en edición.
  useEffect(() => {
    setDraft(active?.contentMarkdown ?? '')
    setMode('preview')
  }, [active?.id])

  const rendered = useMemo(
    () => (active ? renderMarkdown(active.contentMarkdown) : ''),
    [active],
  )

  const createNew = (meta: Pick<CompendiumInput, 'title' | 'subtitle' | 'type'>) => {
    const record = compendium.add({ ...meta, contentMarkdown: '' })
    setActiveId(record.id)
    setMetaOpen(false)
    setEditingMeta(null)
    setMode('edit')
  }

  const saveMeta = (meta: Pick<CompendiumInput, 'title' | 'subtitle' | 'type'>) => {
    if (editingMeta) {
      compendium.update(editingMeta.id, meta)
    }
    setMetaOpen(false)
    setEditingMeta(null)
  }

  const saveBody = () => {
    if (active) {
      compendium.update(active.id, { contentMarkdown: draft })
    }
    setMode('preview')
  }

  const handleCopy = async () => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(buildMarkdownFile(active))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Silencioso: algunos navegadores bloquean clipboard sin gesto directo.
    }
  }

  const handleDownload = () => {
    if (!active) return
    const content = buildMarkdownFile(active)
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = toFilename(active.title)
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const confirmDelete = () => {
    if (toDelete) compendium.remove(toDelete.id)
    setToDelete(null)
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <Scroll size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Compendio / Anexos</h2>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {annexes.length}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Cronologías, mapas y apéndices en Markdown.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openExport('compendium')}
          aria-label="Exportar compendio a Word"
          title="Exportar a Word"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
        >
          <FileDown size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Tabs de anexos + nuevo */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {annexes.map((annex) => {
          const isActive = annex.id === activeId
          return (
            <button
              key={annex.id}
              type="button"
              onClick={() => setActiveId(annex.id)}
              className={[
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {annex.title}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => {
            setEditingMeta(null)
            setMetaOpen(true)
          }}
          className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-300"
        >
          <Plus size={14} aria-hidden="true" />
          Nuevo
        </button>
      </div>

      {active ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
          {/* Barra del anexo activo */}
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-zinc-100">
                {active.title}
              </h3>
              {active.subtitle && (
                <p className="truncate text-xs text-zinc-500">{active.subtitle}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  setEditingMeta(active)
                  setMetaOpen(true)
                }}
                aria-label="Editar metadatos del anexo"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setToDelete(active)}
                aria-label="Eliminar anexo"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Controles: modo dual + copiar + descargar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={[
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === 'preview'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200',
                ].join(' ')}
              >
                <Eye size={14} aria-hidden="true" />
                Vista previa
              </button>
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={[
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === 'edit'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200',
                ].join(' ')}
              >
                <SquarePen size={14} aria-hidden="true" />
                Editar
              </button>
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-emerald-400" aria-hidden="true" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden="true" />
                    Copiar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                <Download size={14} aria-hidden="true" />
                .md
              </button>
            </div>
          </div>

          {/* Cuerpo: preview o edición */}
          <div className="px-4 py-4">
            {mode === 'preview' ? (
              active.contentMarkdown.trim().length === 0 ? (
                <p className="text-center text-sm text-zinc-500">
                  Este anexo está vacío. Entra en modo edición para redactarlo.
                </p>
              ) : (
                <div
                  className="text-sm"
                  // El HTML proviene de renderMarkdown, que escapa el contenido del usuario.
                  dangerouslySetInnerHTML={{ __html: rendered }}
                />
              )
            ) : (
              <div className="flex flex-col gap-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={14}
                  placeholder={'# Título\n\nEscribe en **Markdown**...\n\n- Punto uno\n- Punto dos'}
                  className="no-scrollbar w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(active.contentMarkdown)
                      setMode('preview')
                    }}
                    className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={saveBody}
                    className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-zinc-500">
            No hay anexos todavía. Crea el primero con «Nuevo».
          </p>
        </div>
      )}

      <AnnexMetaForm
        open={metaOpen}
        initial={editingMeta}
        onClose={() => {
          setMetaOpen(false)
          setEditingMeta(null)
        }}
        onSubmit={editingMeta ? saveMeta : createNew}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar anexo"
        message={`¿Seguro que quieres eliminar "${toDelete?.title}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}
