import { useState, type FormEvent, type ReactNode } from 'react'
import { worktreeSlug } from '../../shared/worktreeName'
import { errorMessage } from './ide'
import { Overlay } from './Overlay'

export function WorktreeDialog(props: {
  folderName: string
  onCreate(name: string | null): Promise<void>
  onClose(): void
}): ReactNode {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const slug = worktreeSlug(name)

  const create = async (chosen: string | null): Promise<void> => {
    setCreating(true)
    setError(null)
    try {
      await props.onCreate(chosen)
      props.onClose()
    } catch (err) {
      setError(errorMessage(err))
      setCreating(false)
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (slug && !creating) void create(name)
  }

  return (
    <Overlay onClose={() => !creating && props.onClose()}>
      <form
        className="modal small worktree-dialog"
        role="dialog"
        aria-label="Nova sessão em worktree"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !creating) props.onClose()
        }}
      >
        <h2>Nova sessão em worktree</h2>
        <label>
          Nome
          <input type="text" autoFocus value={name} disabled={creating} onChange={(e) => setName(e.target.value)} />
        </label>
        <dl className="worktree-preview">
          <dt>Branch</dt>
          <dd>agent/{slug || '...'}</dd>
          <dt>Pasta</dt>
          <dd>
            {props.folderName}.worktrees/{slug || '...'}
          </dd>
        </dl>
        {error && (
          <p className="worktree-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={creating} onClick={props.onClose}>
            Cancelar
          </button>
          <button type="button" className="ghost" disabled={creating} onClick={() => void create(null)}>
            Nome aleatório
          </button>
          <button type="submit" className="primary" disabled={creating || !slug}>
            {creating ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </form>
    </Overlay>
  )
}
