/**
 * Vista del Glosario.
 *
 * Tarjetas clasificadas por categoría, con filtro por categoría, ordenamiento
 * local (A-Z, Z-A, Crípticos primero) y badge visual según el nivel de claridad.
 * CRUD determinista mediante el contexto de LoreKeeper.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  FileDown,
  GitMerge,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type {
  GlossaryCategory,
  GlossaryClarityLevel,
  GlossaryTerm,
} from '../../types'
import { GLOSSARY_CATEGORIES } from '../../types'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { useNavigation } from '../../lib/NavigationContext'
import { useAnalysis } from '../../lib/AnalysisContext'
import { useExportDocx } from '../../lib/ExportDocxContext'
import type { GlossaryInput } from '../../lib/useLoreKeeper'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { GlossaryForm } from './glossary/GlossaryForm'
import { GlossaryMergeModal } from './glossary/GlossaryMergeModal'

type SortMode = 'az' | 'za' | 'cryptic'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'az', label: 'A-Z' },
  { value: 'za', label: 'Z-A' },
  { value: 'cryptic', label: 'Crípticos primero' },
]

/** Clases del badge según el nivel de claridad. */
const CLARITY_BADGE: Record<GlossaryClarityLevel, string> = {
  Claro: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  Críptico: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  Ambiguo: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
}

/** Peso de ordenamiento para "Crípticos primero". */
const CLARITY_WEIGHT: Record<GlossaryClarityLevel, number> = {
  Críptico: 0,
  Ambiguo: 1,
  Claro: 2,
}

export function GlossaryView() {
  const { data, glossary } = useLoreKeeperContext()
  const { consumeGlossaryPrefill } = useNavigation()
  const { startGlossaryMerge, isBusy } = useAnalysis()
  const { openExport } = useExportDocx()

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'Todas' | GlossaryCategory>('Todas')
  const [sortMode, setSortMode] = useState<SortMode>('az')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GlossaryTerm | null>(null)
  const [prefill, setPrefill] = useState<Partial<GlossaryInput> | null>(null)
  const [toDelete, setToDelete] = useState<GlossaryTerm | null>(null)
  // Fusión con IA (se delega al AnalysisContext, no bloqueante).
  const [mergeSource, setMergeSource] = useState<GlossaryTerm | null>(null)

  // Al montar, si el Asistente dejó un prefill, abre el formulario precargado.
  useEffect(() => {
    const pending = consumeGlossaryPrefill()
    if (pending) {
      setEditing(null)
      setPrefill(pending)
      setFormOpen(true)
    }
  }, [consumeGlossaryPrefill])

  // Aplica filtro + búsqueda + ordenamiento de forma determinista.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = data.glossary.filter((term) => {
      const matchesCategory =
        categoryFilter === 'Todas' || term.category === categoryFilter
      if (!matchesCategory) return false
      if (q.length === 0) return true
      return `${term.term} ${term.definition} ${term.contextInStory}`
        .toLowerCase()
        .includes(q)
    })

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'az') return a.term.localeCompare(b.term, 'es')
      if (sortMode === 'za') return b.term.localeCompare(a.term, 'es')
      // cryptic: primero crípticos, luego ambiguos, luego claros; desempata A-Z.
      const weightDiff = CLARITY_WEIGHT[a.clarityLevel] - CLARITY_WEIGHT[b.clarityLevel]
      return weightDiff !== 0 ? weightDiff : a.term.localeCompare(b.term, 'es')
    })

    return sorted
  }, [data.glossary, query, categoryFilter, sortMode])

  // Agrupa por categoría para el render en secciones.
  const grouped = useMemo(() => {
    const map = new Map<GlossaryCategory, GlossaryTerm[]>()
    for (const term of visible) {
      const list = map.get(term.category) ?? []
      list.push(term)
      map.set(term.category, list)
    }
    return map
  }, [visible])

  const openCreate = () => {
    setEditing(null)
    setPrefill(null)
    setFormOpen(true)
  }

  const openEdit = (term: GlossaryTerm) => {
    setEditing(term)
    setPrefill(null)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setPrefill(null)
  }

  const handleSubmit = (input: GlossaryInput) => {
    if (editing) {
      glossary.update(editing.id, input)
    } else {
      glossary.add(input)
    }
    closeForm()
  }

  const confirmDelete = () => {
    if (toDelete) glossary.remove(toDelete.id)
    setToDelete(null)
  }

  /* --- Fusión inteligente con IA (no bloqueante, vía AnalysisContext) --- */
  const handleStartMerge = (targetId: string) => {
    if (!mergeSource) return
    // El término del menú es el primario (conserva su id); target se absorbe.
    startGlossaryMerge(mergeSource.id, targetId)
    setMergeSource(null)
  }

  // Orden de categorías a mostrar (respeta el orden canónico).
  const categoriesToRender = GLOSSARY_CATEGORIES.filter((c) => grouped.has(c))

  return (
    <section className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <BookOpen size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Glosario</h2>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {data.glossary.length}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Términos, nombres propios y conceptos del mundo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openExport('glossary')}
          aria-label="Exportar glosario a Word"
          title="Exportar a Word"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
        >
          <FileDown size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar términos"
          aria-label="Buscar términos del glosario"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
        />
      </div>

      {/* Ordenamiento */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Ordenar:</span>
        <div className="flex gap-1.5">
          {SORT_OPTIONS.map((opt) => {
            const active = sortMode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSortMode(opt.value)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                ].join(' ')}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Filtro por categoría (chips desplazables) */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {(['Todas', ...GLOSSARY_CATEGORIES] as const).map((cat) => {
          const active = categoryFilter === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={[
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {/* Contenido agrupado por categoría */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-zinc-500">
            {data.glossary.length === 0
              ? 'El glosario está vacío. Crea el primer término con el botón +.'
              : 'Ningún término coincide con la búsqueda o el filtro.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {categoriesToRender.map((category) => (
            <div key={category}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-500/80">
                {category}
              </h3>
              <ul className="flex flex-col gap-3">
                {grouped.get(category)!.map((term) => (
                  <li
                    key={term.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-base font-semibold text-zinc-100">
                            {term.term}
                          </h4>
                          <span
                            className={[
                              'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                              CLARITY_BADGE[term.clarityLevel],
                            ].join(' ')}
                          >
                            {term.clarityLevel}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(term)}
                          aria-label={`Editar ${term.term}`}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMergeSource(term)}
                          aria-label={`Fusionar ${term.term} con otro término`}
                          title="Fusionar con…"
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-300"
                        >
                          <GitMerge size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(term)}
                          aria-label={`Eliminar ${term.term}`}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {term.definition && (
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                        {term.definition}
                      </p>
                    )}

                    {term.occurrencesOrChapters && (
                      <p className="mt-2 text-xs text-zinc-500">
                        Apariciones:{' '}
                        <span className="text-zinc-400">
                          {term.occurrencesOrChapters}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Botón flotante de añadir */}
      <button
        type="button"
        onClick={openCreate}
        aria-label="Añadir término"
        className="fixed bottom-24 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <Plus size={24} aria-hidden="true" />
      </button>

      <GlossaryForm
        open={formOpen}
        initial={editing}
        prefill={prefill}
        onClose={closeForm}
        onSubmit={handleSubmit}
      />

      <GlossaryMergeModal
        open={mergeSource !== null}
        source={mergeSource}
        candidates={data.glossary.filter((t) => t.id !== mergeSource?.id)}
        busy={isBusy}
        onClose={() => setMergeSource(null)}
        onMerge={handleStartMerge}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar término"
        message={`¿Seguro que quieres eliminar "${toDelete?.term}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}
