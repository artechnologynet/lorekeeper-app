/**
 * Modal de ajustes de LoreKeeper.
 *
 * Permite al usuario:
 *   - Ingresar y guardar su propia API key de Gemini (BYOK).
 *   - Elegir el modelo activo (selector).
 *   - Verificar la validez de la clave con un ping ligero.
 *   - Exportar el estado completo como respaldo JSON.
 *   - Importar un respaldo JSON (reemplazar o fusionar).
 *   - Borrar todos los datos locales.
 */

import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import type { AppSettings, GeminiModel } from '../types'
import { GEMINI_MODELS, GEMINI_MODEL_GROUPS } from '../types'
import { verifyApiKey } from '../lib/gemini'
import type { ApiKeyCheckResult } from '../lib/gemini'
import type { ImportMode, ImportResult } from '../lib/storage'
import { useLoreKeeperContext } from '../lib/useLoreKeeperContext'
import { useNotifications } from '../lib/NotificationContext'
import { exportLoreBible, readBackupFromFile } from '../lib/loreBible'
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadBackupFromDrive,
  loadDriveState,
  uploadToDrive,
} from '../lib/driveSync'
import type { DriveState } from '../lib/driveSync'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { useExportDocx } from '../lib/ExportDocxContext'
import { Cloud, CloudUpload, FileText, LogOut } from 'lucide-react'

interface SettingsModalProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  onExport: () => boolean
  onImport: (jsonText: string, mode: ImportMode) => ImportResult
  onClearData: () => void
}

type Feedback = { kind: 'ok' | 'error'; message: string } | null

export function SettingsModal({
  open,
  settings,
  onClose,
  onUpdateSettings,
  onExport,
  onImport,
  onClearData,
}: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey)
  const [model, setModel] = useState<GeminiModel>(settings.activeModel)
  // Identidad de la obra (edición manual, guardado inmediato).
  const [projectTitle, setProjectTitle] = useState(settings.projectTitle)
  const [authorName, setAuthorName] = useState(settings.authorName)
  // Modo personalizado: activo cuando el modelo no está entre los sugeridos.
  const [customMode, setCustomMode] = useState(
    !GEMINI_MODELS.includes(settings.activeModel),
  )
  const [showKey, setShowKey] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<ApiKeyCheckResult | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const { data, importFromText } = useLoreKeeperContext()
  const { notify } = useNotifications()
  const { openExport } = useExportDocx()

  // Exportación ZIP y restauración.
  const [exportingZip, setExportingZip] = useState(false)
  const [pendingRestoreJson, setPendingRestoreJson] = useState<string | null>(null)

  // Google Drive.
  const [driveState, setDriveState] = useState<DriveState | null>(loadDriveState())
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [driveUploading, setDriveUploading] = useState(false)
  const [driveRestoring, setDriveRestoring] = useState(false)
  const [pendingDriveRestoreJson, setPendingDriveRestoreJson] = useState<string | null>(
    null,
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Re-sincroniza los campos locales cuando el modal se abre o cambian los ajustes.
  useEffect(() => {
    if (open) {
      setApiKey(settings.geminiApiKey)
      setModel(settings.activeModel)
      setCustomMode(!GEMINI_MODELS.includes(settings.activeModel))
      setProjectTitle(settings.projectTitle)
      setAuthorName(settings.authorName)
      setCheckResult(null)
      setFeedback(null)
    }
  }, [
    open,
    settings.geminiApiKey,
    settings.activeModel,
    settings.projectTitle,
    settings.authorName,
  ])

  // Cancela cualquier verificación en curso al cerrar.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      setChecking(false)
    }
  }, [open])

  if (!open) return null

  const persist = (patch: Partial<AppSettings>) => {
    onUpdateSettings(patch)
  }

  const handleSaveKey = () => {
    persist({ geminiApiKey: apiKey.trim(), activeModel: model })
    setFeedback({ kind: 'ok', message: 'Ajustes guardados.' })
  }

  // Identidad de la obra: guardado inmediato en cada cambio.
  const handleProjectTitleChange = (value: string) => {
    setProjectTitle(value)
    persist({ projectTitle: value })
  }

  const handleAuthorNameChange = (value: string) => {
    setAuthorName(value)
    persist({ authorName: value })
  }

  // Valor especial del <select> para activar el campo de modelo personalizado.
  const CUSTOM_OPTION = '__custom__'

  const handleModelSelect = (value: string) => {
    setCheckResult(null)
    if (value === CUSTOM_OPTION) {
      // Entra en modo personalizado sin perder lo ya escrito.
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    setModel(value)
    persist({ activeModel: value })
  }

  const handleCustomModelChange = (value: string) => {
    setModel(value)
    persist({ activeModel: value.trim() })
    setCheckResult(null)
  }

  const handleVerify = async () => {
    setChecking(true)
    setCheckResult(null)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const result = await verifyApiKey(apiKey, model, controller.signal)
    setCheckResult(result)
    setChecking(false)

    // Si la clave es válida, la persistimos automáticamente.
    if (result.ok) {
      persist({ geminiApiKey: apiKey.trim(), activeModel: model })
    }
  }

  const handleExport = () => {
    const ok = onExport()
    setFeedback(
      ok
        ? { kind: 'ok', message: 'Respaldo exportado como lorekeeper_backup.json.' }
        : { kind: 'error', message: 'No se pudo exportar el respaldo.' },
    )
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Resetea el input para permitir reimportar el mismo archivo.
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const result = onImport(text, 'replace')
      setFeedback(
        result.ok
          ? { kind: 'ok', message: 'Respaldo importado correctamente.' }
          : { kind: 'error', message: result.error },
      )
    } catch {
      setFeedback({ kind: 'error', message: 'No se pudo leer el archivo seleccionado.' })
    }
  }

  /* --- Exportar Biblia de Lore (.ZIP) --- */
  const handleExportZip = async () => {
    setExportingZip(true)
    const result = await exportLoreBible(data)
    setExportingZip(false)
    notify(
      result.ok
        ? `Biblia de Lore exportada: ${result.filename}`
        : result.error,
      result.ok ? 'success' : 'error',
    )
  }

  /* --- Restaurar proyecto (.json o .zip) --- */
  const handleRestoreClick = () => {
    restoreInputRef.current?.click()
  }

  const handleRestoreFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = '' // permite reseleccionar el mismo archivo
    if (!file) return

    const read = await readBackupFromFile(file)
    if (!read.ok) {
      notify(read.error, 'error')
      return
    }
    // Guarda el JSON leído y pide confirmación antes de reemplazar.
    setPendingRestoreJson(read.json)
  }

  const confirmRestore = () => {
    if (!pendingRestoreJson) return
    const result = importFromText(pendingRestoreJson, 'replace')
    setPendingRestoreJson(null)
    notify(
      result.ok
        ? 'Proyecto restaurado correctamente.'
        : result.error,
      result.ok ? 'success' : 'error',
    )
  }

  /* --- Google Drive --- */

  const formatSync = (iso: string | null): string => {
    if (!iso) return 'Nunca'
    try {
      return new Date(iso).toLocaleString('es', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return 'Nunca'
    }
  }

  const handleDriveConnect = async () => {
    setDriveConnecting(true)
    const result = await connectGoogleDrive()
    setDriveConnecting(false)
    if (result.ok) {
      setDriveState(result.data)
      notify(`Conectado a Google Drive como ${result.data.email}.`, 'success')
    } else {
      // Toast + alert con el detalle COMPLETO para diagnóstico (código nativo).
      notify(result.error, 'error')
      try {
        window.alert(`Error al conectar con Google Drive:\n\n${result.error}`)
      } catch {
        // Ignora si alert no está disponible.
      }
    }
  }

  const handleDriveDisconnect = () => {
    disconnectGoogleDrive()
    setDriveState(null)
    notify('Sesión de Google Drive cerrada.', 'info')
  }

  const handleDriveUpload = async () => {
    setDriveUploading(true)
    const result = await uploadToDrive(data)
    setDriveUploading(false)
    if (result.ok) {
      setDriveState(result.data)
      notify('Proyecto sincronizado con Google Drive exitosamente.', 'success')
    } else {
      notify(result.error, 'error')
    }
  }

  const handleDriveRestore = async () => {
    setDriveRestoring(true)
    const result = await downloadBackupFromDrive()
    setDriveRestoring(false)
    if (result.ok) {
      setPendingDriveRestoreJson(result.data)
    } else {
      notify(result.error, 'error')
    }
  }

  const confirmDriveRestore = () => {
    if (!pendingDriveRestoreJson) return
    const result = importFromText(pendingDriveRestoreJson, 'replace')
    setPendingDriveRestoreJson(null)
    notify(
      result.ok
        ? 'Datos restaurados desde Google Drive.'
        : result.error,
      result.ok ? 'success' : 'error',
    )
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Ajustes"
    >
      {/* Fondo semitransparente */}
      <button
        type="button"
        aria-label="Cerrar ajustes"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Contenedor del modal */}
      <div
        className="no-scrollbar relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl sm:rounded-3xl"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
      >
        <div
          className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-zinc-700 sm:hidden"
          aria-hidden="true"
        />

        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Ajustes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Sección prioritaria: Identidad de la Obra */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">
            Identidad de la Obra
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-zinc-500">
            Define el título de tu obra y tu nombre de autor. Se detectan
            automáticamente en el primer análisis, pero puedes corregirlos aquí
            en cualquier momento; tu edición siempre tiene prioridad.
          </p>

          <label
            htmlFor="project-title"
            className="mb-1.5 block text-xs font-medium text-zinc-400"
          >
            Título de la obra / saga
          </label>
          <input
            id="project-title"
            type="text"
            value={projectTitle}
            onChange={(e) => handleProjectTitleChange(e.target.value)}
            placeholder="Ej. La Sombra de la Inmortalidad"
            autoComplete="off"
            className="mb-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
          />

          <label
            htmlFor="author-name"
            className="mb-1.5 block text-xs font-medium text-zinc-400"
          >
            Autor / Seudónimo
          </label>
          <input
            id="author-name"
            type="text"
            value={authorName}
            onChange={(e) => handleAuthorNameChange(e.target.value)}
            placeholder="Ej. Tu nombre o seudónimo"
            autoComplete="off"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
          />
        </section>

        {/* Sección BYOK Gemini */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Conexión con Gemini</h3>
          <p className="mb-3 text-xs leading-relaxed text-zinc-500">
            Usa tu propia clave (BYOK). Se guarda solo en este dispositivo y no se
            incluye en los respaldos exportados.
          </p>

          <label htmlFor="gemini-key" className="mb-1.5 block text-xs font-medium text-zinc-400">
            API Key de Gemini
          </label>
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <input
                id="gemini-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setCheckResult(null)
                }}
                placeholder="AIza..."
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 pr-10 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Ocultar clave' : 'Mostrar clave'}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-200"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSaveKey}
              className="shrink-0 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              Guardar
            </button>
          </div>

          <label htmlFor="gemini-model" className="mb-1.5 block text-xs font-medium text-zinc-400">
            Modelo activo
          </label>
          <div className="mb-3 flex gap-2">
            <select
              id="gemini-model"
              value={customMode ? CUSTOM_OPTION : model}
              onChange={(e) => handleModelSelect(e.target.value)}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
            >
              {GEMINI_MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={CUSTOM_OPTION}>Personalizado…</option>
            </select>
            <button
              type="button"
              onClick={handleVerify}
              disabled={checking}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checking ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Verificando
                </>
              ) : (
                'Verificar clave'
              )}
            </button>
          </div>

          {/* Nota informativa sobre disponibilidad de modelos */}
          <p className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
            Nota: Los modelos insignia o de versiones recientes suelen presentar
            alta demanda temporal en la API de Google. Si recibes errores de
            saturación, selecciona modelos ligeros (Lite o Preview) que cuentan
            con mayor disponibilidad.
          </p>

          {customMode && (
            <div className="mb-3">
              <label
                htmlFor="gemini-model-custom"
                className="mb-1.5 block text-xs font-medium text-zinc-400"
              >
                Nombre del modelo personalizado
              </label>
              <input
                id="gemini-model-custom"
                type="text"
                value={model}
                onChange={(e) => handleCustomModelChange(e.target.value)}
                placeholder="p. ej. gemini-2.0-pro"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Escribe el identificador exacto del modelo. Usa «Verificar clave»
                para comprobar que esté disponible para tu API key.
              </p>
            </div>
          )}

          {checkResult && (
            <div
              className={[
                'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
                checkResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300',
              ].join(' ')}
            >
              {checkResult.ok ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span>{checkResult.message}</span>
            </div>
          )}
        </section>

        {/* Sección respaldo */}
        <section className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Respaldo de datos</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              <Download size={16} aria-hidden="true" />
              Exportar JSON
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              <Upload size={16} aria-hidden="true" />
              Importar JSON
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelected}
            className="hidden"
          />
        </section>

        {/* Sección Respaldo y Exportación (Biblia de Lore) */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">
            Respaldo y Exportación
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-zinc-500">
            Exporta toda tu biblia de lore como paquete .ZIP legible, o restaura
            el proyecto desde un respaldo .json o .zip.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleExportZip()}
              disabled={exportingZip}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingZip ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Generando ZIP…
                </>
              ) : (
                <>
                  <FileArchive size={16} aria-hidden="true" />
                  Exportar Biblia de Lore (.ZIP)
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                // Cierra Ajustes y abre el modal de exportación a Word.
                onClose()
                openExport()
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              <FileText size={16} aria-hidden="true" />
              Exportar a Word (.docx)
            </button>
            <button
              type="button"
              onClick={handleRestoreClick}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              <RotateCcw size={16} aria-hidden="true" />
              Restaurar proyecto
            </button>
          </div>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            onChange={handleRestoreFileSelected}
            className="hidden"
          />
        </section>

        {/* Sección Sincronización en la Nube (Google Drive) */}
        <section className="mb-6">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Cloud size={16} className="text-amber-400" aria-hidden="true" />
            Sincronización en la Nube (Google Drive)
          </h3>

          {!driveState ? (
            <>
              <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                Respalda y sincroniza tu lore directamente en tu Google Drive
                personal.
              </p>
              <button
                type="button"
                onClick={() => void handleDriveConnect()}
                disabled={driveConnecting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {driveConnecting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Conectando…
                  </>
                ) : (
                  <>
                    <Cloud size={16} aria-hidden="true" />
                    Conectar con Google Drive
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500">Conectado como</p>
                  <p className="truncate text-sm text-zinc-200">{driveState.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleDriveDisconnect}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
                >
                  <LogOut size={13} aria-hidden="true" />
                  Desconectar
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleDriveUpload()}
                disabled={driveUploading || driveRestoring}
                className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {driveUploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Subiendo a Drive…
                  </>
                ) : (
                  <>
                    <CloudUpload size={16} aria-hidden="true" />
                    Subir copia a Google Drive
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleDriveRestore()}
                disabled={driveUploading || driveRestoring}
                className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {driveRestoring ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Descargando…
                  </>
                ) : (
                  <>
                    <Download size={16} aria-hidden="true" />
                    Descargar y restaurar desde Drive
                  </>
                )}
              </button>

              <p className="text-center text-[11px] text-zinc-500">
                Última sincronización: {formatSync(driveState.lastSync)}
              </p>
            </div>
          )}
        </section>

        {/* Zona peligrosa */}
        <section>
          <button
            type="button"
            onClick={onClearData}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          >
            <Trash2 size={16} aria-hidden="true" />
            Borrar todos los datos
          </button>
        </section>

        {feedback && (
          <p
            className={[
              'mt-4 text-center text-xs',
              feedback.kind === 'ok' ? 'text-emerald-400' : 'text-red-400',
            ].join(' ')}
          >
            {feedback.message}
          </p>
        )}
      </div>

      {/* Confirmación de restauración local (.json/.zip) */}
      <ConfirmDialog
        open={pendingRestoreJson !== null}
        title="Restaurar proyecto"
        message="Esto reemplazará los datos actuales por los del respaldo. ¿Deseas continuar?"
        confirmLabel="Restaurar"
        destructive
        onConfirm={confirmRestore}
        onCancel={() => setPendingRestoreJson(null)}
      />

      {/* Confirmación de restauración desde Google Drive */}
      <ConfirmDialog
        open={pendingDriveRestoreJson !== null}
        title="Restaurar desde Google Drive"
        message="¿Deseas restaurar la copia de Drive? Esto actualizará tus datos locales."
        confirmLabel="Restaurar"
        destructive
        onConfirm={confirmDriveRestore}
        onCancel={() => setPendingDriveRestoreJson(null)}
      />
    </div>
  )
}
