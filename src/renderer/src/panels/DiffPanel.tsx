import type { IDockviewPanelProps } from 'dockview-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { DiffPanelParams, FileDiff, GitChange, GitChanges } from '../../../shared/types'
import { useEnv } from '../context'
import { IconButton } from '../icons'
import { errorMessage, ide } from '../ide'

const POLL_MS = 5000

const STATUS_LABEL: Record<GitChange['status'], string> = {
  modified: 'Alterado',
  added: 'Adicionado',
  deleted: 'Apagado',
  renamed: 'Renomeado',
  untracked: 'Novo, fora do Git'
}

const STATUS_MARK: Record<GitChange['status'], string> = { modified: '●', added: '+', deleted: '−', renamed: '→', untracked: '+' }

function counts(f: GitChange): string {
  if (f.binary) return 'binário'
  if (f.status === 'deleted') return 'apagado'
  if (f.status === 'untracked' || (f.status === 'added' && f.deletions === 0)) return `novo +${f.additions}`
  return `+${f.additions} −${f.deletions}`
}

/** Só leitura: mostra o que mudou desde o último commit, sem stage nem descarte. */
export function DiffPanel({ params, api }: IDockviewPanelProps<DiffPanelParams>): ReactNode {
  const { env } = useEnv()
  const cwd = params.cwd ?? env.cwd
  const [changes, setChanges] = useState<GitChanges | null | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(() => {
    ide.gitChanges(cwd).then(
      (next) => {
        setChanges(next)
        setError(null)
        // Cada leitura também relê o arquivo aberto, que pode ter mudado.
        setVersion((v) => v + 1)
      },
      (err) => setError(errorMessage(err))
    )
  }, [cwd])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    const off = ide.onGitChanged(load)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [load])

  const branch = changes?.branch ?? null
  useEffect(() => {
    api.setTitle(branch ? `Alterações · ${branch}` : 'Alterações')
  }, [api, branch])

  // Mantém o arquivo escolhido; se ele saiu da lista, vai para o primeiro.
  const files = changes?.files ?? []
  const current = files.find((f) => f.path === selected) ?? files[0] ?? null
  const currentPath = current?.path ?? null

  useEffect(() => {
    if (!currentPath) {
      setDiff(null)
      return
    }
    let alive = true
    ide.gitFileDiff(cwd, currentPath).then(
      (d) => alive && setDiff(d),
      (err) => alive && setError(errorMessage(err))
    )
    return () => {
      alive = false
    }
  }, [cwd, currentPath, version])

  return (
    <div className="diff-panel">
      <div className="plugins-toolbar">
        <span>
          {changes === undefined
            ? 'Lendo alterações...'
            : changes === null
              ? 'Esta pasta não é um repositório Git.'
              : files.length === 0
                ? 'Nenhuma alteração desde o último commit.'
                : `${files.length} ${files.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}`}
        </span>
        <IconButton icon="refresh" label="Atualizar alterações" onClick={load} />
      </div>
      {error && (
        <p className="plugin-error" role="alert">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <div className="diff-body">
          <ul className="diff-files" aria-label="Arquivos alterados">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className={f.path === currentPath ? 'on' : ''}
                  aria-current={f.path === currentPath}
                  data-tip={f.from ? `${STATUS_LABEL[f.status]}: ${f.from} → ${f.path}` : `${STATUS_LABEL[f.status]}: ${f.path}`}
                  onClick={() => setSelected(f.path)}
                >
                  <span className={`diff-mark ${f.status}`} aria-label={STATUS_LABEL[f.status]}>
                    {STATUS_MARK[f.status]}
                  </span>
                  <span className="diff-name">
                    {f.path.split('/').pop()}
                    <small>{f.path.split('/').slice(0, -1).join('/')}</small>
                  </span>
                  <span className="diff-counts">{counts(f)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="diff-view" aria-label={currentPath ? `Diff de ${currentPath}` : 'Diff'}>
            {current && (
              <div className="diff-path mono">
                {current.from ? `${current.from} → ` : ''}
                {current.path}
              </div>
            )}
            {diff?.binary && <p className="git-muted">Arquivo binário.</p>}
            {diff && !diff.binary && (
              <pre className="diff-lines">
                {diff.lines.map((l, i) => (
                  <div key={i} className={`diff-line ${l.type}`}>
                    <span className="diff-no">{l.oldNo ?? ''}</span>
                    <span className="diff-no">{l.newNo ?? ''}</span>
                    <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                    <span className="diff-text">{l.text}</span>
                  </div>
                ))}
              </pre>
            )}
            {diff?.truncated && <p className="git-muted">Diff grande demais: só o começo aparece aqui.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
