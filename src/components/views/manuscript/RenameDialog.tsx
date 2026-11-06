/**
 * Diálogo para renombrar un documento/manuscrito.
 */

import { useEffect, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { FormActions, TextField } from '../../ui/fields'

interface RenameDialogProps {
  open: boolean
  currentTitle: string
  onClose: () => void
  onSubmit: (title: string) => void
}

export function RenameDialog({
  open,
  currentTitle,
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const [title, setTitle] = useState(currentTitle)

  useEffect(() => {
    if (open) setTitle(currentTitle)
  }, [open, currentTitle])

  const canSubmit = title.trim().length > 0

  return (
    <Modal
      open={open}
      title="Renombrar documento"
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
            onClick={() => onSubmit(title.trim())}
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Guardar
          </button>
        </FormActions>
      }
    >
      <TextField
        label="Título del documento"
        value={title}
        onChange={setTitle}
        placeholder="Capítulo 1, Notas de Magia..."
        required
      />
    </Modal>
  )
}
