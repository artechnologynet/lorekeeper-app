/**
 * Componente raíz de LoreKeeper.
 *
 * Define el layout tipo aplicación móvil:
 *   - Header superior fijo (con botón de ajustes).
 *   - Área de contenido desplazable (cambia según la sección activa).
 *   - Barra de navegación inferior fija con 5 secciones.
 *
 * El estado global (entidades, glosario, anexos, ajustes) se provee con
 * `LoreKeeperProvider`. La navegación entre secciones y el "prefill" de
 * formularios (p. ej. desde el Asistente) se proveen con `NavigationProvider`.
 */

import { useState } from 'react'
import { Header } from './components/navigation/Header'
import { BottomNav } from './components/navigation/BottomNav'
import { SettingsModal } from './components/SettingsModal'
import { ManuscriptView } from './components/views/ManuscriptView'
import { EntitiesView } from './components/views/EntitiesView'
import { GlossaryView } from './components/views/GlossaryView'
import { CompendiumView } from './components/views/CompendiumView'
import { AssistantView } from './components/views/AssistantView'
import {
  LoreKeeperProvider,
  useLoreKeeperContext,
} from './lib/useLoreKeeperContext'
import { NavigationProvider, useNavigation } from './lib/NavigationContext'
import { NotificationProvider } from './lib/NotificationContext'
import { AnalysisProvider } from './lib/AnalysisContext'
import { ExportDocxProvider } from './lib/ExportDocxContext'
import { NotificationHost } from './components/NotificationHost'
import { AnalysisBadge } from './components/AnalysisBadge'
import type { SectionId } from './types'

/** Mapea cada sección a su vista correspondiente. */
function renderView(section: SectionId) {
  switch (section) {
    case 'manuscript':
      return <ManuscriptView />
    case 'entities':
      return <EntitiesView />
    case 'glossary':
      return <GlossaryView />
    case 'compendium':
      return <CompendiumView />
    case 'assistant':
      return <AssistantView />
    default:
      return <ManuscriptView />
  }
}

/** Contenido de la app (dentro de los providers). */
function AppShell() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { section, goTo } = useNavigation()

  const { data, updateSettings, exportToFile, importFromText, resetAll } =
    useLoreKeeperContext()

  const handleClearData = () => {
    resetAll()
    setSettingsOpen(false)
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-200">
      <Header active={section} onOpenSettings={() => setSettingsOpen(true)} />

      {/* Contenido: el padding superior compensa la ALTURA REAL del Header
          fijo (h-14 = 3.5rem) MÁS el safe-area superior del dispositivo, con un
          respiro extra para que el encabezado de cada vista no quede cortado.
          Aplica por igual a las 5 pestañas, ya que todas se renderizan aquí.
          La key fuerza el remontaje al cambiar de sección, de modo que las
          vistas consuman cualquier prefill pendiente al entrar. */}
      <main
        className="no-scrollbar mx-auto min-h-dvh max-w-2xl overflow-y-auto px-4 pb-24"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 5rem)' }}
      >
        <div key={section}>{renderView(section)}</div>
      </main>

      <BottomNav active={section} onChange={goTo} />

      <SettingsModal
        open={settingsOpen}
        settings={data.settings}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={updateSettings}
        onExport={exportToFile}
        onImport={importFromText}
        onClearData={handleClearData}
      />

      <NotificationHost />
      <AnalysisBadge />
    </div>
  )
}

function App() {
  return (
    <LoreKeeperProvider>
      <NavigationProvider>
        <NotificationProvider>
          <AnalysisProvider>
            <ExportDocxProvider>
              <AppShell />
            </ExportDocxProvider>
          </AnalysisProvider>
        </NotificationProvider>
      </NavigationProvider>
    </LoreKeeperProvider>
  )
}

export default App
