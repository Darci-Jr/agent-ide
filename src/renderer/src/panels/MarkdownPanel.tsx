import type { IDockviewPanelProps } from 'dockview-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { FilePanelParams } from '../../../shared/types'
import { useEnv } from '../context'
import { IconButton } from '../icons'
import { errorMessage, ide } from '../ide'

const POLL_MS = 1000

export function MarkdownPanel({ params }: IDockviewPanelProps<FilePanelParams>): ReactNode {
  const { env, openFile } = useEnv()
  const { path } = params
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<string[]>([])

  // Atualiza sozinho quando o agente altera o arquivo.
  useEffect(() => {
    if (!path) return
    let last = -1
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const file = await ide.readFile(env.cwd, path)
        if (alive && file.mtimeMs !== last) {
          last = file.mtimeMs
          setContent(file.content)
          setError(null)
        }
      } catch (err) {
        if (alive) setError(errorMessage(err))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [env.cwd, path])

  useEffect(() => {
    if (path) return
    void ide.listTree(env.cwd).then((tree) => {
      setOptions(tree.filter((e) => !e.isDir && /\.md$/i.test(e.path)).map((e) => e.path).slice(0, 200))
    })
  }, [env.cwd, path])

  const html = useMemo(
    () => (content === null ? '' : DOMPurify.sanitize(marked.parse(content, { async: false }))),
    [content]
  )

  // Links nunca navegam dentro do app; os externos abrem no navegador.
  const onClick = (e: MouseEvent): void => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    e.preventDefault()
    if (/^https?:/.test(link.href)) window.open(link.href)
  }

  if (!path) {
    return (
      <div className="panel-empty">
        {options.length === 0 ? (
          <p>Nenhum Markdown neste projeto ainda.</p>
        ) : (
          <>
            <p>Escolha um Markdown</p>
            <div className="md-options">
              {options.map((option) => (
                <button key={option} type="button" className="file" onClick={() => openFile(option)}>
                  {option}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="file-panel">
      <div className="file-head">
        <span className="file-path">{path}</span>
        <IconButton icon="pencil" label="Editar" onClick={() => openFile(path, true)} />
      </div>
      {error && <div className="banner warning">{error}</div>}
      <article className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
