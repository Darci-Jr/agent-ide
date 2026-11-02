import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { GitAction, GitStatus, GitWorktree } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'

/**
 * Ações de Git da sessão em uso, abertas pelo ícone da barra lateral. O rodapé só mostra o
 * estado; tudo que muda o repositório passa por aqui.
 */
export function GitMenu(props: {
  cwd: string
  /** Altura do ícone que abriu o menu, para o menu nascer ao lado dele. */
  top: number
  /** Outras sessões abertas na mesma pasta: trocar de branch também muda para elas. */
  sessionsInFolder(root: string): string[]
  openTerminal(worktreePath: string): void
  /** Abre o painel de alterações da raiz do repositório. */
  openDiff(root: string): void
  onClose(): void
}): ReactNode {
  const { cwd } = props
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined)
  const [branches, setBranches] = useState<string[]>([])
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [showBranches, setShowBranches] = useState(false)
  const [newBranch, setNewBranch] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const current = await ide.gitStatus(cwd)
    setStatus(current)
    if (!current) return
    const [b, w] = await Promise.all([ide.gitBranches(cwd), ide.gitWorktrees(cwd)])
    setBranches(b)
    setWorktrees(w)
  }, [cwd])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) props.onClose()
    }
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [props])

  const run = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await work()
      setMessage(text ? { text, error: false } : null)
      await load()
    } catch (err) {
      setMessage({ text: errorMessage(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  const action = (a: GitAction): Promise<void> => run(() => ide.gitAction(cwd, a))

  const switchTo = (branch: string): void => {
    const others = status ? props.sessionsInFolder(status.root) : []
    if (others.length > 0 && !window.confirm(`Estas sessões usam a mesma pasta e também vão para ${branch}: ${others.join(', ')}. Trocar mesmo assim?`)) return
    setShowBranches(false)
    void action({ kind: 'switch', branch })
  }

  const create = (e: FormEvent): void => {
    e.preventDefault()
    const name = newBranch ?? ''
    setNewBranch(null)
    void action({ kind: 'create', branch: name })
  }

  const remove = (w: GitWorktree): void => {
    if (!window.confirm(`Remover a worktree ${w.name}? A branch ${w.branch ?? ''} continua existindo.`)) return
    void run(async () => {
      await ide.removeWorktree(cwd, w.path)
      return `Worktree ${w.name} removida.`
    })
  }

  return (
    <div
      ref={box}
      className="git-menu"
      role="dialog"
      aria-label="Git"
      style={{ top: props.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose()
      }}
    >
      {status === undefined && <p className="git-muted">Lendo o repositório...</p>}
      {status === null && <p className="git-muted">Esta pasta não é um repositório Git.</p>}
      {status && (
        <>
          <h3>
            Git · <span className="mono">{status.branch}</span>
          </h3>
          <button type="button" className="ghost git-diff" onClick={() => props.openDiff(status.root)}>
            Ver alterações{status.changed > 0 ? ` (${status.changed})` : ''}
          </button>
          <div className="git-actions">
            <button type="button" className="ghost" disabled={busy} aria-expanded={showBranches} onClick={() => setShowBranches(!showBranches)}>
              Trocar branch
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setNewBranch(newBranch === null ? '' : null)}>
              Nova branch
            </button>
          </div>
          {showBranches && (
            <ul className="git-branches">
              {branches.map((b) => (
                <li key={b}>
                  <button type="button" disabled={busy || b === status.branch} onClick={() => switchTo(b)}>
                    {b === status.branch ? '● ' : ''}
                    {b}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {newBranch !== null && (
            <form className="git-new-branch" onSubmit={create}>
              <input type="text" autoFocus aria-label="Nome da nova branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
              <button type="submit" className="primary" disabled={!newBranch.trim()}>
                Criar
              </button>
            </form>
          )}
          <div className="git-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => void action({ kind: 'fetch' })}>
              Buscar
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void action({ kind: 'pull' })}>
              Puxar
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void action({ kind: 'push' })}>
              Enviar
            </button>
          </div>
          {message && (
            <p className={message.error ? 'git-error' : 'git-ok'} role={message.error ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
          <h4>Worktrees</h4>
          <ul className="git-worktrees">
            {worktrees.map((w) => (
              <li key={w.path} className={w.current ? 'on' : ''}>
                <span className="git-worktree-name" data-tip={w.path}>
                  {w.current ? '● ' : ''}
                  {w.main ? `${w.name} (principal)` : w.name}
                  <small>{w.branch ?? 'sem branch'}</small>
                </span>
                <IconButton icon="terminal" label={`Abrir terminal em ${w.name}`} onClick={() => props.openTerminal(w.path)} />
                <IconButton icon="openFolder" label={`Abrir pasta de ${w.name}`} onClick={() => void ide.openWorktreeFolder(cwd, w.path)} />
                {!w.main && <IconButton icon="trash" label={`Remover worktree ${w.name}`} disabled={busy} onClick={() => remove(w)} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
