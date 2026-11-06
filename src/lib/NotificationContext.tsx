/**
 * Contexto de notificaciones globales.
 *
 * Expone:
 *   - Un indicador de "tarea en segundo plano" (banner flotante discreto con
 *     spinner), p. ej. mientras la IA analiza un manuscrito.
 *   - Toasts efímeros (éxito/error/info) que se autodescartan.
 *
 * El render visual (NotificationHost) se monta una sola vez en la raíz.
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

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

interface NotificationState {
  /** Mensaje del banner de tarea en segundo plano (null = oculto). */
  backgroundTask: string | null
  toasts: Toast[]
  startBackgroundTask: (message: string) => void
  stopBackgroundTask: () => void
  notify: (message: string, kind?: ToastKind) => void
  dismissToast: (id: string) => void
}

const NotificationContext = createContext<NotificationState | null>(null)

let counter = 0
function nextId(): string {
  counter += 1
  return `toast-${Date.now()}-${counter}`
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [backgroundTask, setBackgroundTask] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const startBackgroundTask = useCallback((message: string) => {
    setBackgroundTask(message)
  }, [])

  const stopBackgroundTask = useCallback(() => {
    setBackgroundTask(null)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId()
      setToasts((prev) => [...prev, { id, kind, message }])
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        timers.current.delete(id)
      }, 5000)
      timers.current.set(id, timer)
    },
    [],
  )

  const state = useMemo<NotificationState>(
    () => ({
      backgroundTask,
      toasts,
      startBackgroundTask,
      stopBackgroundTask,
      notify,
      dismissToast,
    }),
    [
      backgroundTask,
      toasts,
      startBackgroundTask,
      stopBackgroundTask,
      notify,
      dismissToast,
    ],
  )

  return (
    <NotificationContext.Provider value={state}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationState {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error(
      'useNotifications debe usarse dentro de <NotificationProvider>.',
    )
  }
  return ctx
}
