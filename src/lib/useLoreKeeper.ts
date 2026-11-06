/**
 * Hook de estado global de LoreKeeper.
 *
 * Carga el estado persistido una sola vez al montar y guarda automáticamente
 * (con un pequeño debounce) ante cualquier cambio. Expone utilidades para
 * actualizar ajustes, importar/exportar respaldos y limpiar los datos.
 *
 * El flujo es determinista: la fuente de verdad es `data` en memoria; el
 * efecto de autosave lo refleja en localStorage sin provocar relecturas.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AssistantMessage,
  BaseRecord,
  CompendiumAnnex,
  EntitySheet,
  GlossaryTerm,
  LoreKeeperData,
  Manuscript,
  ManuscriptStatus,
} from '../types'
import {
  clearData as clearStorage,
  exportBackup,
  importBackup,
  loadData,
  saveData,
} from './storage'
import type { ImportMode, ImportResult } from './storage'
import { createId, nowIso } from './parse'

const AUTOSAVE_DELAY_MS = 400

/** Claves de LoreKeeperData que contienen colecciones CRUD de registros. */
type CollectionKey = 'entities' | 'glossary' | 'compendium' | 'manuscripts'

/** Datos de entrada de una entidad (sin metadatos de BaseRecord). */
export type EntityInput = Omit<EntitySheet, keyof BaseRecord>
/** Datos de entrada de un término de glosario. */
export type GlossaryInput = Omit<GlossaryTerm, keyof BaseRecord>
/** Datos de entrada de un anexo de compendio. */
export type CompendiumInput = Omit<CompendiumAnnex, keyof BaseRecord>
/** Datos de entrada de un manuscrito/documento. */
export type ManuscriptInput = Omit<Manuscript, keyof BaseRecord>

/** API CRUD para una colección concreta. */
export interface CrudApi<TRecord extends BaseRecord, TInput> {
  add: (input: TInput) => TRecord
  update: (id: string, patch: Partial<TInput>) => void
  remove: (id: string) => void
}

export interface UseLoreKeeper {
  data: LoreKeeperData
  setData: React.Dispatch<React.SetStateAction<LoreKeeperData>>
  updateSettings: (patch: Partial<AppSettings>) => void
  entities: CrudApi<EntitySheet, EntityInput>
  glossary: CrudApi<GlossaryTerm, GlossaryInput>
  compendium: CrudApi<CompendiumAnnex, CompendiumInput>
  manuscripts: CrudApi<Manuscript, ManuscriptInput>
  /**
   * Fusiona el manuscrito `sourceId` dentro de `targetId`: concatena el
   * contenido (separado por "\n\n"), ajusta el estado resultante y elimina el
   * documento absorbido. Devuelve true si la fusión se realizó.
   */
  mergeManuscripts: (targetId: string, sourceId: string) => boolean
  /** Elimina varios manuscritos a la vez (borrado por lotes). */
  removeManuscripts: (ids: string[]) => void
  /** Elimina varias entidades a la vez (borrado por lotes). */
  removeEntities: (ids: string[]) => void
  appendMessage: (message: AssistantMessage) => void
  clearConversation: () => void
  exportToFile: () => boolean
  importFromText: (jsonText: string, mode?: ImportMode) => ImportResult
  resetAll: () => void
  ready: boolean
}

export function useLoreKeeper(): UseLoreKeeper {
  const [data, setData] = useState<LoreKeeperData>(() => loadData())
  const [ready, setReady] = useState(false)

  // Evita guardar en el primer render (ya viene de loadData).
  const firstRun = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setReady(true)
  }, [])

  // Autosave con debounce ante cualquier cambio de `data`.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveData(data)
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [data])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }))
  }, [])

  /**
   * Fabrica una API CRUD determinista para una colección. Cada operación crea
   * un nuevo arreglo (inmutable) para disparar el autosave y el re-render.
   */
  const makeCrud = useCallback(
    <TRecord extends BaseRecord, TInput>(
      key: CollectionKey,
    ): CrudApi<TRecord, TInput> => ({
      add: (input: TInput): TRecord => {
        const timestamp = nowIso()
        const record = {
          ...(input as object),
          id: createId(),
          createdAt: timestamp,
          updatedAt: timestamp,
        } as TRecord

        setData((prev) => {
          const list = prev[key] as unknown as TRecord[]
          return { ...prev, [key]: [record, ...list] }
        })

        return record
      },

      update: (id: string, patch: Partial<TInput>) => {
        setData((prev) => {
          const list = prev[key] as unknown as TRecord[]
          return {
            ...prev,
            [key]: list.map((item) =>
              item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item,
            ),
          }
        })
      },

      remove: (id: string) => {
        setData((prev) => {
          const list = prev[key] as unknown as TRecord[]
          return { ...prev, [key]: list.filter((item) => item.id !== id) }
        })
      },
    }),
    [],
  )

  const entities = useRef(
    makeCrud<EntitySheet, EntityInput>('entities'),
  ).current
  const glossary = useRef(
    makeCrud<GlossaryTerm, GlossaryInput>('glossary'),
  ).current
  const compendium = useRef(
    makeCrud<CompendiumAnnex, CompendiumInput>('compendium'),
  ).current
  const manuscripts = useRef(
    makeCrud<Manuscript, ManuscriptInput>('manuscripts'),
  ).current

  const mergeManuscripts = useCallback(
    (targetId: string, sourceId: string): boolean => {
      if (targetId === sourceId) return false

      let merged = false
      setData((prev) => {
        const target = prev.manuscripts.find((m) => m.id === targetId)
        const source = prev.manuscripts.find((m) => m.id === sourceId)
        if (!target || !source) return prev

        // Estado resultante: 'pending' solo si AMBOS eran 'pending'; si no, 'draft'.
        const resultStatus: ManuscriptStatus =
          target.status === 'pending' && source.status === 'pending'
            ? 'pending'
            : 'draft'

        const combinedContent = [target.content.trimEnd(), source.content.trim()]
          .filter((part) => part.length > 0)
          .join('\n\n')

        merged = true
        return {
          ...prev,
          manuscripts: prev.manuscripts
            // Actualiza el receptor con el contenido fusionado.
            .map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    content: combinedContent,
                    status: resultStatus,
                    updatedAt: nowIso(),
                  }
                : m,
            )
            // Elimina el documento absorbido.
            .filter((m) => m.id !== sourceId),
        }
      })
      return merged
    },
    [],
  )

  const removeManuscripts = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const toRemove = new Set(ids)
    setData((prev) => ({
      ...prev,
      manuscripts: prev.manuscripts.filter((m) => !toRemove.has(m.id)),
    }))
  }, [])

  const removeEntities = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const toRemove = new Set(ids)
    setData((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => !toRemove.has(e.id)),
    }))
  }, [])

  const appendMessage = useCallback((message: AssistantMessage) => {
    setData((prev) => ({
      ...prev,
      conversation: [...prev.conversation, message],
    }))
  }, [])

  const clearConversation = useCallback(() => {
    setData((prev) => ({ ...prev, conversation: [] }))
  }, [])

  const exportToFile = useCallback(() => exportBackup(data), [data])

  const importFromText = useCallback(
    (jsonText: string, mode: ImportMode = 'replace'): ImportResult => {
      const result = importBackup(jsonText, data, mode)
      if (result.ok) {
        setData(result.data)
      }
      return result
    },
    [data],
  )

  const resetAll = useCallback(() => {
    clearStorage()
    setData((prev) => ({
      manuscripts: [],
      entities: [],
      glossary: [],
      compendium: [],
      conversation: [],
      // Conserva los ajustes (incluida la API key) tras limpiar el contenido.
      settings: { ...prev.settings },
    }))
  }, [])

  return {
    data,
    setData,
    updateSettings,
    entities,
    glossary,
    compendium,
    manuscripts,
    mergeManuscripts,
    removeManuscripts,
    removeEntities,
    appendMessage,
    clearConversation,
    exportToFile,
    importFromText,
    resetAll,
    ready,
  }
}
