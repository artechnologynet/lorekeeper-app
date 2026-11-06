/**
 * Contexto global de análisis de manuscritos.
 *
 * Vive en la raíz de la app (siempre montado), por lo que el análisis es
 * 100% asíncrono y NO bloqueante: el usuario puede cerrar el editor, cambiar de
 * sección o editar fichas mientras Gemini procesa en segundo plano. El banner
 * flotante (NotificationContext) persiste en cualquier sección.
 *
 * Flujo de `analyzeManuscriptById`:
 *   1. Valida API key y contenido mínimo.
 *   2. Marca el documento como 'pending' y muestra el banner con su título.
 *   3. Pide a Gemini la extracción JSON y fusiona (upsert/merge).
 *   4. Al resolver: aplica el merge, marca el documento 'analyzed', toast resumen.
 *   5. En error: revierte el status previo y muestra toast de error.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useLoreKeeperContext } from './useLoreKeeperContext'
import { useNotifications } from './NotificationContext'
import { ERROR_MESSAGES, generateJson } from './gemini'
import {
  ANALYSIS_SYSTEM_INSTRUCTION,
  applyEntityMerge,
  applyGlossaryMerge,
  buildAnalysisPrompt,
  buildEntityMergePrompt,
  buildGlossaryMergePrompt,
  ENTITY_MERGE_SYSTEM_INSTRUCTION,
  GLOSSARY_MERGE_SYSTEM_INSTRUCTION,
  mergeExtraction,
  summaryMessage,
  totalAffected,
} from './analysis'
import type {
  AiExtraction,
  AiMergedEntity,
  AiMergedGlossaryTerm,
} from './analysis'
import type { ManuscriptStatus } from '../types'

/** Mínimo de caracteres para que valga la pena analizar. */
const MIN_CHARS = 40

interface AnalysisState {
  /** IDs de documentos actualmente en análisis. */
  analyzingIds: Set<string>
  /** Lanza el análisis de un documento por id (no bloqueante). */
  analyzeManuscriptById: (id: string) => void
  /**
   * Lanza la fusión con IA de dos entidades (no bloqueante). `primaryId`
   * conserva su ficha (id) y absorbe a `secondaryId`, que se elimina.
   */
  startEntityMerge: (primaryId: string, secondaryId: string) => void
  /**
   * Lanza la fusión con IA de dos términos del glosario (no bloqueante).
   * `primaryId` conserva su entrada (id) y absorbe a `secondaryId`.
   */
  startGlossaryMerge: (primaryId: string, secondaryId: string) => void
  /** ¿Hay algún análisis en curso? (compatibilidad) */
  isAnalyzing: boolean
  /**
   * Guard de tarea única: true si hay CUALQUIER tarea de IA en curso (análisis
   * o fusión). Se usa para exclusión mutua y deshabilitar botones.
   */
  isBusy: boolean
  /** Título/etiqueta de la tarea de IA que se muestra ahora (o null). */
  currentTitle: string | null
  /** Número de análisis en curso. */
  runningCount: number
  /** Analiza una lista de documentos de forma secuencial (lote). */
  analyzeManuscriptsBatch: (ids: string[]) => void
  /** Progreso del análisis por lote (null si no hay lote en curso). */
  batchProgress: { current: number; total: number } | null
  /** Detiene el análisis por lote en curso (conserva lo ya procesado). */
  cancelBatch: () => void
  /** Cancela todas las tareas de IA en curso. */
  cancelAll: () => void
}

const AnalysisContext = createContext<AnalysisState | null>(null)

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { data, setData, manuscripts } = useLoreKeeperContext()
  const { notify } = useNotifications()

  // Snapshot siempre fresco del estado (para prompt y merge sin dependencias).
  const dataRef = useRef(data)
  dataRef.current = data

  // IDs en análisis: estado reactivo (dispara re-render de spinners/badges).
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())

  const addRunning = useCallback((id: string) => {
    setAnalyzingIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const removeRunning = useCallback((id: string) => {
    setAnalyzingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Ref síncrono para evitar relanzar un análisis ya en curso (antes del re-render).
  const inFlightRef = useRef<Set<string>>(new Set())
  // Controladores de aborto por id, para poder cancelar.
  const controllersRef = useRef<Map<string, AbortController>>(new Map())
  // Título del análisis que se muestra actualmente (reactivo para el badge).
  const [currentTitle, setCurrentTitle] = useState<string | null>(null)

  // Guard de tarea única (exclusión mutua): ref síncrono + estado reactivo.
  const busyRef = useRef(false)
  const [isBusy, setIsBusy] = useState(false)
  // Progreso del análisis por lote (null fuera de lote).
  const [batchProgress, setBatchProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  // Bandera de cancelación del lote (síncrona, consultada por el bucle).
  const batchCancelRef = useRef(false)
  // Controlador de aborto de la fusión en curso (si la hay).
  const mergeControllerRef = useRef<AbortController | null>(null)

  const cancelAll = useCallback(() => {
    for (const controller of controllersRef.current.values()) {
      controller.abort()
    }
    mergeControllerRef.current?.abort()
  }, [])

  /**
   * Detiene el análisis por lote: marca la bandera para romper el bucle y aborta
   * la petición de red en curso. Los capítulos ya analizados conservan su estado.
   */
  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true
    // Aborta la petición activa del análisis en curso (si la hay).
    for (const controller of controllersRef.current.values()) {
      controller.abort()
    }
  }, [])

  /** Resultado de un análisis individual (para orquestación en lote). */
  type SingleOutcome =
    | 'ok'
    | 'empty'
    | 'error'
    | 'rateLimited'
    | 'quotaExceeded'
    | 'skipped'

  /**
   * Núcleo awaitable del análisis de UN documento. NO gestiona el guard de
   * tarea única (lo hace el llamador) ni emite toast de resumen en modo lote.
   * Marca el badge (pending→analyzed) y hace el merge. Devuelve el desenlace.
   */
  const runSingleAnalysis = useCallback(
    async (id: string, options?: { silent?: boolean }): Promise<SingleOutcome> => {
      const silent = options?.silent ?? false
      const doc = dataRef.current.manuscripts.find((m) => m.id === id)
      if (!doc) return 'skipped'

      const text = doc.content.trim()
      if (text.length < MIN_CHARS) {
        if (!silent) notify('El documento es demasiado corto para analizar.', 'info')
        return 'skipped'
      }

      const apiKey = dataRef.current.settings.geminiApiKey.trim()
      if (apiKey.length === 0) {
        if (!silent) {
          notify('Configura tu API key en Ajustes para analizar manuscritos.', 'info')
        }
        return 'error'
      }

      const previousStatus: ManuscriptStatus = doc.status
      inFlightRef.current.add(id)
      const controller = new AbortController()
      controllersRef.current.set(id, controller)
      addRunning(id)
      setCurrentTitle(`Analizando: ${doc.title}`)
      manuscripts.update(id, { status: 'pending' })

      try {
        const result = await generateJson<AiExtraction>({
          apiKey,
          model: dataRef.current.settings.activeModel,
          systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
          prompt: buildAnalysisPrompt(doc.title, text, dataRef.current),
          temperature: 0.2,
          signal: controller.signal,
        })

        if (!result.ok) {
          manuscripts.update(id, { status: previousStatus })
          if (controller.signal.aborted) {
            if (!silent) notify('Análisis cancelado.', 'info')
            return 'error'
          }
          // Clasifica por tipo de error para dar un trato diferenciado.
          if (result.errorKind === 'DAILY_QUOTA_EXCEEDED') {
            if (!silent) notify(result.error, 'error')
            return 'quotaExceeded'
          }
          if (result.errorKind === 'HIGH_DEMAND') {
            if (!silent) notify(result.error, 'error')
            return 'rateLimited'
          }
          if (!silent) notify(result.error, 'error')
          return 'error'
        }

        const { next, summary } = mergeExtraction(
          dataRef.current,
          result.data,
          doc.title,
        )
        const affected = totalAffected(summary)

        setData({
          ...next,
          manuscripts: next.manuscripts.map((m) =>
            m.id === id
              ? { ...m, status: 'analyzed', updatedAt: new Date().toISOString() }
              : m,
          ),
        })

        if (!silent) {
          notify(
            affected > 0
              ? summaryMessage(summary)
              : 'Análisis completado: no se encontraron datos nuevos.',
            affected > 0 ? 'success' : 'info',
          )
        }
        return affected > 0 ? 'ok' : 'empty'
      } catch (error) {
        manuscripts.update(id, { status: previousStatus })
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (!silent) notify('Análisis cancelado.', 'info')
        } else if (!silent) {
          notify('Ocurrió un error durante el análisis.', 'error')
        }
        return 'error'
      } finally {
        inFlightRef.current.delete(id)
        controllersRef.current.delete(id)
        removeRunning(id)
        if (inFlightRef.current.size === 0) setCurrentTitle(null)
      }
    },
    [manuscripts, setData, notify, addRunning, removeRunning],
  )

  /**
   * Analiza UN documento (acción rápida por fila). No bloqueante: toma el guard
   * de tarea única, corre el núcleo con toasts individuales y lo libera.
   */
  const analyzeManuscriptById = useCallback(
    (id: string) => {
      if (inFlightRef.current.has(id)) return
      if (busyRef.current) {
        notify('Hay otra tarea de IA en curso. Espera a que termine.', 'info')
        return
      }
      busyRef.current = true
      setIsBusy(true)
      void (async () => {
        try {
          await runSingleAnalysis(id)
        } finally {
          busyRef.current = false
          setIsBusy(false)
        }
      })()
    },
    [runSingleAnalysis, notify],
  )

  /**
   * Analiza una lista de documentos de forma SECUENCIAL (cola controlada para no
   * saturar la API). Mantiene el guard de tarea única durante todo el lote,
   * actualiza el progreso reactivo y tolera errores 429: reintenta UNA vez tras
   * una pausa y, si persiste, continúa con el siguiente sin abortar la cola.
   */
  const analyzeManuscriptsBatch = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      if (busyRef.current) {
        notify('Hay otra tarea de IA en curso. Espera a que termine.', 'info')
        return
      }
      const apiKey = dataRef.current.settings.geminiApiKey.trim()
      if (apiKey.length === 0) {
        notify('Configura tu API key en Ajustes para analizar manuscritos.', 'info')
        return
      }

      busyRef.current = true
      setIsBusy(true)
      batchCancelRef.current = false // reinicia la bandera al empezar

      // Pausa que se interrumpe si se cancela el lote (sondea cada 250 ms).
      const cancellableDelay = async (ms: number) => {
        const steps = Math.ceil(ms / 250)
        for (let s = 0; s < steps; s += 1) {
          if (batchCancelRef.current) return
          await new Promise((r) => setTimeout(r, 250))
        }
      }

      void (async () => {
        let okCount = 0
        let errorCount = 0
        let cancelled = false
        let quotaHit = false
        const total = ids.length

        try {
          for (let i = 0; i < ids.length; i += 1) {
            if (batchCancelRef.current) {
              cancelled = true
              break
            }
            setBatchProgress({ current: i + 1, total })

            let outcome = await runSingleAnalysis(ids[i], { silent: true })

            // Si se canceló durante la petición, no sigas procesando.
            if (batchCancelRef.current) {
              cancelled = true
              break
            }

            // CUOTA DIARIA agotada: detener la cola de inmediato (no reintentar).
            if (outcome === 'quotaExceeded') {
              quotaHit = true
              break
            }

            // Tolerancia a saturación: una pausa + un reintento del mismo item.
            if (outcome === 'rateLimited') {
              await cancellableDelay(8000)
              if (batchCancelRef.current) {
                cancelled = true
                break
              }
              outcome = await runSingleAnalysis(ids[i], { silent: true })
              if (batchCancelRef.current) {
                cancelled = true
                break
              }
              // Si el reintento revela cuota diaria, detener la cola.
              if (outcome === 'quotaExceeded') {
                quotaHit = true
                break
              }
            }

            if (outcome === 'ok' || outcome === 'empty') okCount += 1
            else if (outcome === 'rateLimited' || outcome === 'error') errorCount += 1
            // 'skipped' no cuenta como error ni como éxito.

            // Pequeña pausa entre items para respetar límites de tasa.
            if (i < ids.length - 1) {
              await cancellableDelay(1200)
            }
          }

          if (quotaHit) {
            // Mensaje específico y accionable; el lote se detuvo de inmediato.
            notify(ERROR_MESSAGES.DAILY_QUOTA_EXCEEDED, 'error')
          } else if (cancelled) {
            notify('Análisis por lote detenido.', 'info')
          } else if (errorCount === 0) {
            notify(`Análisis por lote completado: ${okCount} capítulos procesados.`, 'success')
          } else {
            notify(
              `Lote finalizado: ${okCount} procesados, ${errorCount} con errores (revisa saturación o cuota).`,
              errorCount >= okCount ? 'error' : 'info',
            )
          }
        } finally {
          batchCancelRef.current = false
          setBatchProgress(null)
          busyRef.current = false
          setIsBusy(false)
          setCurrentTitle(null)
        }
      })()
    },
    [runSingleAnalysis, notify],
  )

  const startEntityMerge = useCallback(
    (primaryId: string, secondaryId: string) => {
      if (primaryId === secondaryId) return

      // Guard de tarea única.
      if (busyRef.current) {
        notify('Hay otra tarea de IA en curso. Espera a que termine.', 'info')
        return
      }

      const primary = dataRef.current.entities.find((e) => e.id === primaryId)
      const secondary = dataRef.current.entities.find((e) => e.id === secondaryId)
      if (!primary || !secondary) return

      const apiKey = dataRef.current.settings.geminiApiKey.trim()
      if (apiKey.length === 0) {
        notify('Configura tu API key en Ajustes para fusionar con IA.', 'info')
        return
      }

      busyRef.current = true
      setIsBusy(true)
      setCurrentTitle(`Fusionando entidades: ${primary.name}`)
      const controller = new AbortController()
      mergeControllerRef.current = controller

      void (async () => {
        try {
          const result = await generateJson<AiMergedEntity>({
            apiKey,
            model: dataRef.current.settings.activeModel,
            systemInstruction: ENTITY_MERGE_SYSTEM_INSTRUCTION,
            prompt: buildEntityMergePrompt(primary, secondary),
            temperature: 0.3,
            signal: controller.signal,
          })

          if (!result.ok) {
            if (controller.signal.aborted) {
              notify('Fusión cancelada.', 'info')
            } else {
              notify(result.error, 'error')
            }
            return
          }

          const merged = applyEntityMerge(primary, secondary, result.data)
          setData((prev) => ({
            ...prev,
            entities: prev.entities
              .map((e) => (e.id === primary.id ? merged : e))
              .filter((e) => e.id !== secondary.id),
          }))
          notify('Fusión completada con éxito.', 'success')
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            notify('Fusión cancelada.', 'info')
          } else {
            notify('Ocurrió un error durante la fusión.', 'error')
          }
        } finally {
          mergeControllerRef.current = null
          setCurrentTitle(null)
          busyRef.current = false
          setIsBusy(false)
        }
      })()
    },
    [setData, notify],
  )

  const startGlossaryMerge = useCallback(
    (primaryId: string, secondaryId: string) => {
      if (primaryId === secondaryId) return

      // Guard de tarea única.
      if (busyRef.current) {
        notify('Hay otra tarea de IA en curso. Espera a que termine.', 'info')
        return
      }

      const primary = dataRef.current.glossary.find((t) => t.id === primaryId)
      const secondary = dataRef.current.glossary.find((t) => t.id === secondaryId)
      if (!primary || !secondary) return

      const apiKey = dataRef.current.settings.geminiApiKey.trim()
      if (apiKey.length === 0) {
        notify('Configura tu API key en Ajustes para fusionar con IA.', 'info')
        return
      }

      busyRef.current = true
      setIsBusy(true)
      setCurrentTitle(`Fusionando términos: ${primary.term}`)
      const controller = new AbortController()
      mergeControllerRef.current = controller

      void (async () => {
        try {
          const result = await generateJson<AiMergedGlossaryTerm>({
            apiKey,
            model: dataRef.current.settings.activeModel,
            systemInstruction: GLOSSARY_MERGE_SYSTEM_INSTRUCTION,
            prompt: buildGlossaryMergePrompt(primary, secondary),
            temperature: 0.3,
            signal: controller.signal,
          })

          if (!result.ok) {
            if (controller.signal.aborted) {
              notify('Fusión cancelada.', 'info')
            } else {
              notify(result.error, 'error')
            }
            return
          }

          const merged = applyGlossaryMerge(primary, secondary, result.data)
          setData((prev) => ({
            ...prev,
            glossary: prev.glossary
              .map((t) => (t.id === primary.id ? merged : t))
              .filter((t) => t.id !== secondary.id),
          }))
          notify('Fusión de términos completada con éxito.', 'success')
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            notify('Fusión cancelada.', 'info')
          } else {
            notify('Ocurrió un error durante la fusión.', 'error')
          }
        } finally {
          mergeControllerRef.current = null
          setCurrentTitle(null)
          busyRef.current = false
          setIsBusy(false)
        }
      })()
    },
    [setData, notify],
  )

  const state = useMemo<AnalysisState>(
    () => ({
      analyzingIds,
      analyzeManuscriptById,
      analyzeManuscriptsBatch,
      batchProgress,
      cancelBatch,
      startEntityMerge,
      startGlossaryMerge,
      isAnalyzing: analyzingIds.size > 0,
      isBusy,
      currentTitle,
      runningCount: analyzingIds.size,
      cancelAll,
    }),
    [
      analyzingIds,
      analyzeManuscriptById,
      analyzeManuscriptsBatch,
      batchProgress,
      cancelBatch,
      startEntityMerge,
      startGlossaryMerge,
      isBusy,
      currentTitle,
      cancelAll,
    ],
  )

  return (
    <AnalysisContext.Provider value={state}>
      {children}
    </AnalysisContext.Provider>
  )
}

export function useAnalysis(): AnalysisState {
  const ctx = useContext(AnalysisContext)
  if (!ctx) {
    throw new Error('useAnalysis debe usarse dentro de <AnalysisProvider>.')
  }
  return ctx
}
