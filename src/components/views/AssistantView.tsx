/**
 * Vista del Asistente del Autor.
 *
 * Chat estilo mensajería conectado a Gemini (BYOK), de SOLO LECTURA: consulta
 * manuscritos, entidades y glosario como contexto, pero nunca crea, edita ni
 * borra registros. Dos modos:
 *   - Estricto 🛡️  (temp 0.1): auditor de continuidad, cero alucinaciones.
 *   - Creativo 💡 (temp 0.65): consejero narrativo, brainstorming.
 *
 * Lo único que se escribe en el estado es la propia conversación del chat. La
 * extracción de entidades/glosario ocurre solo por capítulo en Manuscritos.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, Lightbulb, Send, Shield, Sparkles } from 'lucide-react'
import type { AssistantMessage } from '../../types'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { createId, nowIso } from '../../lib/parse'
import { renderMarkdown } from '../../lib/markdown'
import { generateContent, MODE_TEMPERATURE } from '../../lib/gemini'
import type { AssistantMode, ChatTurn } from '../../lib/gemini'
import {
  QUICK_PROMPTS,
  buildSystemInstruction,
  summarizeContext,
} from '../../lib/assistantContext'

/** Formatea una marca de tiempo ISO como hora local corta. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function AssistantView() {
  const { data, appendMessage, clearConversation } = useLoreKeeperContext()
  const conversation = data.conversation

  const [mode, setMode] = useState<AssistantMode>('strict')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const context = useMemo(() => summarizeContext(data), [data])
  const hasApiKey = data.settings.geminiApiKey.trim().length > 0

  // Auto-scroll al último mensaje.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation.length, loading])

  // Cancela cualquier petición en curso al desmontar.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const send = async (rawText: string) => {
    const text = rawText.trim()
    if (text.length === 0 || loading) return

    if (!hasApiKey) {
      setError('No hay API key configurada. Añádela en Ajustes (engrane) para usar el asistente.')
      return
    }

    setError(null)

    // Registra el mensaje del usuario.
    const userMessage: AssistantMessage = {
      id: createId(),
      role: 'user',
      content: text,
      createdAt: nowIso(),
    }
    appendMessage(userMessage)
    setInput('')
    setLoading(true)

    // Historial para la API (turnos previos, sin el mensaje recién añadido).
    const history: ChatTurn[] = conversation.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.content,
    }))

    const controller = new AbortController()
    abortRef.current = controller

    const result = await generateContent({
      apiKey: data.settings.geminiApiKey,
      model: data.settings.activeModel,
      systemInstruction: buildSystemInstruction(mode, data),
      history,
      prompt: text,
      temperature: MODE_TEMPERATURE[mode],
      signal: controller.signal,
    })

    setLoading(false)
    abortRef.current = null

    if (result.ok) {
      appendMessage({
        id: createId(),
        role: 'assistant',
        content: result.text,
        createdAt: nowIso(),
        kind: 'chat',
      })
    } else {
      setError(result.error)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  return (
    <div className="flex flex-col">
      {/* Cabecera: toggle de modo + badge de contexto */}
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 pb-3 pt-1 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-amber-400" aria-hidden="true" />
          <h2 className="flex-1 text-base font-semibold text-zinc-100">Asistente</h2>
          <button
            type="button"
            onClick={clearConversation}
            disabled={conversation.length === 0}
            aria-label="Limpiar conversación"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eraser size={14} aria-hidden="true" />
            Limpiar
          </button>
        </div>

        {/* Toggle de modo */}
        <div className="inline-flex w-full rounded-xl border border-zinc-800 bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setMode('strict')}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
              mode === 'strict'
                ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-zinc-400 hover:text-zinc-200',
            ].join(' ')}
          >
            <Shield size={15} aria-hidden="true" />
            Modo Estricto
          </button>
          <button
            type="button"
            onClick={() => setMode('creative')}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
              mode === 'creative'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-zinc-400 hover:text-zinc-200',
            ].join(' ')}
          >
            <Lightbulb size={15} aria-hidden="true" />
            Modo Creativo
          </button>
        </div>

        {/* Badge de contexto */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500">Contexto activo:</span>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-zinc-400 ring-1 ring-zinc-800">
            {context.manuscripts} manuscritos
          </span>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-zinc-400 ring-1 ring-zinc-800">
            {context.entities} entidades
          </span>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-zinc-400 ring-1 ring-zinc-800">
            {context.glossaryTerms} términos
          </span>
        </div>
      </div>

      {/* Historial de chat */}
      <div className="mt-3 flex flex-col gap-3 pb-40">
        {conversation.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center">
            <p className="text-sm text-zinc-500">
              Consulta y haz brainstorming sobre tu universo. El asistente lee
              tus manuscritos, fichas y glosario, pero nunca los modifica.
            </p>
          </div>
        )}

        {conversation.map((message) => {
          const isUser = message.role === 'user'
          return (
            <div
              key={message.id}
              className={isUser ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={[
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                  isUser
                    ? 'rounded-br-md bg-amber-500 text-zinc-950'
                    : 'rounded-bl-md border border-zinc-800 bg-zinc-900 text-zinc-200',
                ].join(' ')}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </p>
                ) : (
                  <>
                    <div
                      className="assistant-markdown leading-relaxed"
                      // renderMarkdown escapa el contenido antes de dar formato.
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(message.content),
                      }}
                    />
                  </>
                )}
                <p
                  className={[
                    'mt-1 text-[10px]',
                    isUser ? 'text-zinc-800/70' : 'text-zinc-500',
                  ].join(' ')}
                >
                  {formatTime(message.createdAt)}
                </p>
              </div>
            </div>
          )
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
              <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" />
              </span>
              Pensando…
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Chips de preguntas rápidas + input fijo inferior */}
      <div
        className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
      >
        <div className="mx-auto max-w-2xl px-4 py-2.5">
          {conversation.length === 0 && (
            <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={loading}
                  className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-200 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              placeholder={hasApiKey ? 'Escribe tu consulta…' : 'Configura tu API key en Ajustes'}
              className="no-scrollbar max-h-32 flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              aria-label="Enviar"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
