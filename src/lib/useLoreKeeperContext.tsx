/**
 * Contexto de LoreKeeper.
 *
 * Provee una ÚNICA instancia del estado global (`useLoreKeeper`) a toda la app,
 * de modo que todas las vistas compartan la misma fuente de verdad y el mismo
 * autosave. Evita que cada vista cree su propio estado desconectado.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useLoreKeeper } from './useLoreKeeper'
import type { UseLoreKeeper } from './useLoreKeeper'

const LoreKeeperContext = createContext<UseLoreKeeper | null>(null)

export function LoreKeeperProvider({ children }: { children: ReactNode }) {
  const value = useLoreKeeper()
  return (
    <LoreKeeperContext.Provider value={value}>
      {children}
    </LoreKeeperContext.Provider>
  )
}

/** Accede al estado global de LoreKeeper. Debe usarse dentro del Provider. */
export function useLoreKeeperContext(): UseLoreKeeper {
  const ctx = useContext(LoreKeeperContext)
  if (!ctx) {
    throw new Error(
      'useLoreKeeperContext debe usarse dentro de <LoreKeeperProvider>.',
    )
  }
  return ctx
}
