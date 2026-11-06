/**
 * Formulario de metadatos de un anexo del compendio (título, subtítulo, tipo).
 * El cuerpo en Markdown se edita directamente en la vista, no aquí.
 */

import { useEffect, useState } from 'react'
import type { CompendiumAnnex } from '../../../types'
import type { CompendiumInput } from '../../../lib/useLoreKeeper'
import { Modal } from '../../ui/Modal'
import { FormActions, TextField } from '../../ui/fields'

interface AnnexMetaFormProps {
  open: boolean
  initial: CompendiumAnnex | null
  onClose: () => void
  onSubmit: (meta: Pick<CompendiumInput, 'title' | 'subtitle' | 'type'>) => void
}

export function AnnexMetaForm({
  open,
  initial,
  onClose,
  onSubmit,
}: AnnexMetaFormProps) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [type, setType] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setSubtitle(initial?.subtitle ?? '')
    setType(initial?.type ?? '')
  }, [open, initial])

  const canSubmit = title.trim().length > 0

  return (
    <Modal
      open={open}
      title={initial ? 'Editar anexo' : 'Nuevo anexo'}
      onClose={onClose}
      footer={
        <FormActions>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() =>
              onSubmit({
                title: title.trim(),
                subtitle: subtitle.trim(),
                type: type.trim(),
              })
            }
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {initial ? 'Guardar' : 'Crear anexo'}
          </button>
        </FormActions>
      }
    >
      <TextField
        label="Título"
        value={title}
        onChange={setTitle}
        placeholder="Título del anexo"
        required
      />
      <TextField
        label="Subtítulo"
        value={subtitle}
        onChange={setSubtitle}
        placeholder="Subtítulo opcional"
      />
      <TextField
        label="Tipo"
        value={type}
        onChange={setType}
        placeholder="Cronología, Mapa, Apéndice..."
      />
    </Modal>
  )
}
