/**
 * Vista de Entidades / Fichas.
 *
 * Mobile-first: tarjetas apiladas, búsqueda en tiempo real, filtro ESTRICTO por
 * `role` canónico (enum), selección múltiple + borrado por lotes, y fusión
 * inteligente de duplicados con IA (Smart Merge). CRUD determinista sobre el
 * contexto de LoreKeeper; la fusión con IA es la única operación de red.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  CheckSquare,
  FileDown,
  GitMerge,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import type { EntityRole, EntitySheet } from '../../types'
import { ENTITY_ROLES } from '../../types'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { useNavigation } from '../../lib/NavigationContext'
import { useNotifications } from '../../lib/NotificationContext'
import { useAnalysis } from '../../lib/AnalysisContext'
import { useExportDocx } from '../../lib/ExportDocxContext'
import type { EntityInput } from '../../lib/useLoreKeeper'
import { mergeEntitiesDeterministic } from '../../lib/analysis'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EntityForm } from './entities/EntityForm'
import { EntityMergeModal } from './entities/EntityMergeModal'
import { DuplicateReviewModal } from './entities/DuplicateReviewModal'

/** Filtro de rol: 'Todos' o uno de los roles canónicos. */
type RoleFilter = 'Todos' | EntityRole

export function EntitiesView() {
  const { data, entities, removeEntities, setData } = useLoreKeeperContext()
  const { consumeEntityPrefill } = useNavigation()
  const { notify } = useNotifications()
  const { startEntityMerge, isBusy } = useAnalysis()
  const { openExport } = useExportDocx()

  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('Todos')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EntitySheet | null>(null)
  const [prefill, setPrefill] = useState<Partial<EntityInput> | null>(null)
  const [toDelete, setToDelete] = useState<EntitySheet | null>(null)

  // Selección múltiple.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // Fusión con IA (se delega al AnalysisContext, no bloqueante).
  const [mergeSource, setMergeSource] = useState<EntitySheet | null>(null)

  // Revisión de duplicados (fusión determinista, sin IA).
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)

  // Al montar, si el Asistente dejó un prefill, abre el formulario precargado.
  useEffect(() => {
    const pending = consumeEntityPrefill()
    if (pending) {
      setEditing(null)
      setPrefill(pending)
      setFormOpen(true)
    }
  }, [consumeEntityPrefill])

  // Filtro ESTRICTO por entity.role (enum) + búsqueda de texto.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.entities.filter((entity) => {
      const matchesRole = roleFilter === 'Todos' || entity.role === roleFilter
      if (!matchesRole) return false
      if (q.length === 0) return true

      const haystack = [
        entity.name,
        entity.role,
        entity.narrativeRole,
        entity.motivation,
        entity.notes,
        ...entity.aliases,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [data.entities, query, roleFilter])

  /* --- CRUD --- */

  const openCreate = () => {
    setEditing(null)
    setPrefill(null)
    setFormOpen(true)
  }

  const openEdit = (entity: EntitySheet) => {
    setEditing(entity)
    setPrefill(null)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setPrefill(null)
  }

  const handleSubmit = (input: EntityInput) => {
    if (editing) {
      entities.update(editing.id, input)
    } else {
      entities.add(input)
    }
    closeForm()
  }

  const confirmDelete = () => {
    if (toDelete) entities.remove(toDelete.id)
    setToDelete(null)
  }

  /* --- Selección múltiple --- */

  const enterSelection = () => {
    setSelectionMode(true)
    setSelectedIds(new Set())
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

  const allSelected =
    filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id))

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((e) => e.id)))
  }

  const confirmBulkDelete = () => {
    const ids = Array.from(selectedIds)
    removeEntities(ids)
    setBulkDeleteOpen(false)
    exitSelection()
    notify(
      `Se eliminaron ${ids.length} ${ids.length === 1 ? 'entidad' : 'entidades'}.`,
      'success',
    )
  }

  /* --- Fusión inteligente con IA (no bloqueante, vía AnalysisContext) --- */

  const handleStartMerge = (targetId: string) => {
    if (!mergeSource) return
    // La entidad del menú es la primaria (conserva su id); target se absorbe.
    startEntityMerge(mergeSource.id, targetId)
    // Cierra el modal de inmediato: el trabajo sigue en segundo plano.
    setMergeSource(null)
  }

  /* --- Fusión determinista de duplicados (sin IA, atómica) --- */

  const handleDeterministicMerge = (primaryId: string, secondaryId: string) => {
    let done = false
    setData((prev) => {
      const primary = prev.entities.find((e) => e.id === primaryId)
      const secondary = prev.entities.find((e) => e.id === secondaryId)
      if (!primary || !secondary) return prev
      const merged = mergeEntitiesDeterministic(primary, secondary)
      done = true
      return {
        ...prev,
        entities: prev.entities
          .filter((e) => e.id !== secondaryId)
          .map((e) => (e.id === primaryId ? merged : e)),
      }
    })
    if (done) {
      notify('Entidades fusionadas correctamente.', 'success')
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <Users size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Entidades / Fichas</h2>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {data.entities.length}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Personajes, criaturas y seres de tu historia.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => openExport('entities')}
            aria-label="Exportar entidades a Word"
            title="Exportar a Word"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
          >
            <FileDown size={16} aria-hidden="true" />
          </button>
          {data.entities.length > 1 && (
            <button
              type="button"
              onClick={() => setDuplicatesOpen(true)}
              aria-label="Detectar duplicados"
              title="Detectar duplicados"
              className="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              <Wand2 size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Detectar duplicados</span>
            </button>
          )}
        </div>
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
          placeholder="Buscar por nombre, rol, motivación o notas"
          aria-label="Buscar entidades"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
        />
      </div>

      {/* Filtro ESTRICTO por rol canónico (chips desplazables) */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {(['Todos', ...ENTITY_ROLES] as const).map((role) => {
          const active = roleFilter === role
          return (
            <button
              key={role}
              type="button"
              onClick={() => setRoleFilter(role)}
              className={[
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {role}
            </button>
          )
        })}
      </div>

      {/* Barra de selección */}
      {data.entities.length > 0 &&
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
                  ? 'entidad seleccionada'
                  : 'entidades seleccionadas'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exitSelection}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
              >
                <X size={15} aria-hidden="true" />
                Cancelar
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkDeleteOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={15} aria-hidden="true" />
                Eliminar seleccionados
              </button>
            </div>
          </div>
        ))}

      {/* Lista de tarjetas */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-zinc-500">
            {data.entities.length === 0
              ? 'Aún no hay entidades. Crea la primera con el botón +.'
              : 'Ninguna entidad coincide con la búsqueda o el filtro.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((entity) => {
            const checked = selectedIds.has(entity.id)
            return (
              <li
                key={entity.id}
                className={[
                  'rounded-2xl border bg-zinc-900/60 p-4 transition-colors',
                  checked ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800',
                ].join(' ')}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox en modo selección */}
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelected(entity.id)}
                      aria-label={checked ? 'Deseleccionar' : 'Seleccionar'}
                      aria-pressed={checked}
                      className="mt-0.5 shrink-0 text-zinc-400 transition-colors hover:text-amber-300"
                    >
                      {checked ? (
                        <CheckSquare size={18} className="text-amber-400" aria-hidden="true" />
                      ) : (
                        <Square size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-zinc-100">
                        {entity.name}
                      </h3>
                      {/* Badge principal: rol canónico */}
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/20">
                        {entity.role}
                      </span>
                    </div>
                    {/* Badge/subtítulo secundario: rol narrativo / parentesco */}
                    {entity.narrativeRole && (
                      <p className="mt-1 inline-block rounded-md bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300">
                        {entity.narrativeRole}
                      </p>
                    )}
                    {entity.aliases.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {entity.aliases.join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Acciones (ocultas en modo selección) */}
                  {!selectionMode && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(entity)}
                        aria-label={`Editar ${entity.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMergeSource(entity)}
                        aria-label={`Fusionar ${entity.name} con otra entidad`}
                        title="Fusionar con…"
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-300"
                      >
                        <GitMerge size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setToDelete(entity)}
                        aria-label={`Eliminar ${entity.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                {entity.motivation && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-400">
                    {entity.motivation}
                  </p>
                )}

                {entity.statusInStory && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Estado:{' '}
                    <span className="text-zinc-400">{entity.statusInStory}</span>
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Botón flotante de añadir (oculto en modo selección) */}
      {!selectionMode && (
        <button
          type="button"
          onClick={openCreate}
          aria-label="Añadir entidad"
          className="fixed bottom-24 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        >
          <Plus size={24} aria-hidden="true" />
        </button>
      )}

      <EntityForm
        open={formOpen}
        initial={editing}
        prefill={prefill}
        onClose={closeForm}
        onSubmit={handleSubmit}
      />

      <EntityMergeModal
        open={mergeSource !== null}
        source={mergeSource}
        candidates={data.entities.filter((e) => e.id !== mergeSource?.id)}
        busy={isBusy}
        onClose={() => setMergeSource(null)}
        onMerge={handleStartMerge}
      />

      <DuplicateReviewModal
        open={duplicatesOpen}
        entities={data.entities}
        onClose={() => setDuplicatesOpen(false)}
        onMerge={handleDeterministicMerge}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar entidad"
        message={`¿Seguro que quieres eliminar "${toDelete?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Eliminar entidades"
        message={`¿Estás seguro de eliminar ${selectedIds.size} ${
          selectedIds.size === 1 ? 'entidad' : 'entidades'
        }? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </section>
  )
}
