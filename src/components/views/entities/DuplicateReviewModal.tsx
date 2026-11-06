/**
 * Modal de revisión de duplicados (determinista, sin IA).
 *
 * Detecta parejas de entidades sospechosas de ser la misma (por nombre,
 * alias, contención o similitud de contenido) y presenta cada par lado a lado.
 * Para cada sugerencia, el usuario elige cuál ficha es la principal (la otra
 * pasa a ser alias) y pulsa "Fusionar", o la descarta. La fusión es local y
 * determinista; no consume la IA.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Check, GitMerge, X } from 'lucide-react'
import type { EntitySheet } from '../../../types'
import { findDuplicatePairs } from '../../../lib/analysis'
import type { DuplicatePair } from '../../../lib/analysis'
import { Modal } from '../../ui/Modal'

interface DuplicateReviewModalProps {
  open: boolean
  entities: EntitySheet[]
  onClose: () => void
  /** Fusiona la secundaria dentro de la primaria (determinista, sin IA). */
  onMerge: (primaryId: string, secondaryId: string) => void
}

/** Tarjeta compacta de una entidad dentro del comparador. */
function EntityCard({
  entity,
  selected,
  onSelect,
}: {
  entity: EntitySheet
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'flex-1 rounded-xl border p-3 text-left transition-colors',
        selected
          ? 'border-amber-500/60 bg-amber-500/10'
          : 'border-zinc-800 bg-zinc-900/60 hover:border-amber-500/30',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-100">
          {entity.name}
        </span>
        {selected && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            <Check size={11} aria-hidden="true" />
            Principal
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] text-zinc-400">
        {entity.role}
        {entity.narrativeRole ? ` · ${entity.narrativeRole}` : ''}
      </p>
      {entity.aliases.length > 0 && (
        <p className="mt-1 line-clamp-1 text-[11px] text-zinc-500">
          Alias: {entity.aliases.join(' · ')}
        </p>
      )}
      {entity.physicalDescription && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
          {entity.physicalDescription}
        </p>
      )}
    </button>
  )
}

export function DuplicateReviewModal({
  open,
  entities,
  onClose,
  onMerge,
}: DuplicateReviewModalProps) {
  // Pares detectados al abrir (se recalculan cuando cambian las entidades).
  const detected = useMemo(
    () => (open ? findDuplicatePairs(entities) : []),
    [open, entities],
  )

  // Sugerencias descartadas por el usuario en esta sesión (por clave de par).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Para cada par, cuál id es el elegido como principal.
  const [primaryByKey, setPrimaryByKey] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setDismissed(new Set())
      setPrimaryByKey({})
    }
  }, [open])

  // Pares visibles: los detectados que aún existen y no fueron descartados.
  const visiblePairs = useMemo(
    () =>
      detected.filter(
        (p) =>
          !dismissed.has(p.key) &&
          entities.some((e) => e.id === p.a.id) &&
          entities.some((e) => e.id === p.b.id),
      ),
    [detected, dismissed, entities],
  )

  const primaryOf = (pair: DuplicatePair): string =>
    primaryByKey[pair.key] ?? pair.a.id

  const setPrimary = (key: string, id: string) =>
    setPrimaryByKey((prev) => ({ ...prev, [key]: id }))

  const dismiss = (key: string) =>
    setDismissed((prev) => new Set(prev).add(key))

  const handleMerge = (pair: DuplicatePair) => {
    const primaryId = primaryOf(pair)
    const secondaryId = primaryId === pair.a.id ? pair.b.id : pair.a.id
    onMerge(primaryId, secondaryId)
    // Oculta el par resuelto; los ids fusionados dejan de existir de todos modos.
    dismiss(pair.key)
  }

  return (
    <Modal open={open} title="Detectar duplicados" onClose={onClose}>
      <p className="mb-4 text-sm text-zinc-400">
        Revisa las posibles fichas duplicadas. Elige cuál ficha se conserva como{' '}
        <span className="font-semibold text-zinc-200">principal</span> (la otra
        pasará a ser un alias) y pulsa Fusionar, o descarta la sugerencia.
      </p>

      {visiblePairs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No se detectaron entidades duplicadas.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {visiblePairs.map((pair) => {
            const primaryId = primaryOf(pair)
            return (
              <li
                key={pair.key}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    {pair.reason}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {Math.round(pair.score * 100)}% de coincidencia
                  </span>
                </div>

                <div className="flex items-stretch gap-2">
                  <EntityCard
                    entity={pair.a}
                    selected={primaryId === pair.a.id}
                    onSelect={() => setPrimary(pair.key, pair.a.id)}
                  />
                  <div className="flex items-center text-zinc-600">
                    <ArrowLeftRight size={16} aria-hidden="true" />
                  </div>
                  <EntityCard
                    entity={pair.b}
                    selected={primaryId === pair.b.id}
                    onSelect={() => setPrimary(pair.key, pair.b.id)}
                  />
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => dismiss(pair.key)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                  >
                    <X size={14} aria-hidden="true" />
                    Descartar sugerencia
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMerge(pair)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
                  >
                    <GitMerge size={14} aria-hidden="true" />
                    Fusionar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
