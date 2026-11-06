/**
 * Renderizador de Markdown mínimo y determinista (sin dependencias externas).
 *
 * Soporta un subconjunto suficiente para notas de lore:
 *   - Encabezados (#, ##, ###)
 *   - Negrita (**texto**) y cursiva (*texto* / _texto_)
 *   - Código en línea (`code`)
 *   - Listas no ordenadas (-, *) y ordenadas (1.)
 *   - Citas (>)
 *   - Separadores (---)
 *   - Párrafos y saltos de línea
 *
 * Devuelve HTML seguro: todo el texto se escapa antes de aplicar formato, de
 * modo que no se inyecta HTML arbitrario del usuario.
 */

/** Escapa caracteres HTML peligrosos. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Aplica formato en línea (negrita, cursiva, código) sobre texto ya escapado. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-amber-300">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-zinc-100">$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em class="italic">$2</em>')
    .replace(/_([^_\n]+)_/g, '<em class="italic">$1</em>')
}

/**
 * Convierte texto Markdown en una cadena HTML con clases de Tailwind.
 * Pensado para usarse con dangerouslySetInnerHTML sobre contenido ya escapado.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []

  let inUl = false
  let inOl = false
  let paragraph: string[] = []

  const closeList = () => {
    if (inUl) {
      html.push('</ul>')
      inUl = false
    }
    if (inOl) {
      html.push('</ol>')
      inOl = false
    }
  }

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const joined = paragraph.join('<br/>')
      html.push(`<p class="mb-3 leading-relaxed text-zinc-300">${joined}</p>`)
      paragraph = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const escaped = escapeHtml(line)

    // Línea en blanco: cierra párrafos y listas.
    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }

    // Separador horizontal.
    if (/^---+$/.test(line.trim())) {
      flushParagraph()
      closeList()
      html.push('<hr class="my-4 border-zinc-800"/>')
      continue
    }

    // Encabezados.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList()
      const level = heading[1].length
      const content = renderInline(escapeHtml(heading[2]))
      const sizes = ['text-xl', 'text-lg', 'text-base']
      html.push(
        `<h${level} class="mb-2 mt-4 ${sizes[level - 1]} font-semibold text-zinc-100">${content}</h${level}>`,
      )
      continue
    }

    // Cita.
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      closeList()
      html.push(
        `<blockquote class="mb-3 border-l-2 border-amber-500/50 pl-3 italic text-zinc-400">${renderInline(escapeHtml(quote[1]))}</blockquote>`,
      )
      continue
    }

    // Lista ordenada.
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      flushParagraph()
      if (inUl) {
        html.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        html.push('<ol class="mb-3 ml-5 list-decimal space-y-1 text-zinc-300">')
        inOl = true
      }
      html.push(`<li class="leading-relaxed">${renderInline(escapeHtml(ol[1]))}</li>`)
      continue
    }

    // Lista no ordenada.
    const ul = /^[-*]\s+(.*)$/.exec(line)
    if (ul) {
      flushParagraph()
      if (inOl) {
        html.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        html.push('<ul class="mb-3 ml-5 list-disc space-y-1 text-zinc-300">')
        inUl = true
      }
      html.push(`<li class="leading-relaxed">${renderInline(escapeHtml(ul[1]))}</li>`)
      continue
    }

    // Texto normal: acumula en el párrafo actual.
    closeList()
    paragraph.push(renderInline(escaped))
  }

  flushParagraph()
  closeList()

  return html.join('\n')
}
