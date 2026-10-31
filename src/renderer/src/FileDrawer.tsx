import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConfigFile, TreeEntry } from '../../shared/types'
import { IconButton } from './icons'
import { ide } from './ide'

const MAX_RESULTS = 200

export function FileDrawer(props: { cwd: string; onOpen(path: string): void }): ReactNode {
  const { cwd, onOpen } = props
  const [config, setConfig] = useState<ConfigFile[]>([])
  const [tree, setTree] = useState<TreeEntry[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    void ide.listConfigFiles(cwd).then(setConfig)
    void ide.listTree(cwd).then(setTree)
  }, [cwd])

  useEffect(refresh, [refresh])

  const needle = query.trim().toLowerCase()
  const results = useMemo(
    () => (needle ? tree.filter((e) => !e.isDir && e.path.toLowerCase().includes(needle)).slice(0, MAX_RESULTS) : []),
    [needle, tree]
  )

  const visible = useMemo(
    () =>
      tree.filter((entry) => {
        const parts = entry.path.split('/')
        return parts.slice(0, -1).every((_, i) => expanded.has(parts.slice(0, i + 1).join('/')))
      }),
    [expanded, tree]
  )

  const toggle = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  return (
    <aside className="drawer" aria-label="Arquivos">
      <div className="drawer-search">
        <input
          aria-label="Buscar arquivo por nome"
          placeholder="Buscar arquivo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <IconButton icon="refresh" label="Atualizar" onClick={refresh} />
      </div>
      <div className="drawer-scroll">
        {needle ? (
          results.length === 0 ? (
            <p className="drawer-note">Nenhum arquivo encontrado.</p>
          ) : (
            results.map((e) => (
              <button key={e.path} type="button" className="file" title={e.path} onClick={() => onOpen(e.path)}>
                {e.path}
              </button>
            ))
          )
        ) : (
          <>
            <h3>Configuração</h3>
            {config.length === 0 && <p className="drawer-note">Nenhum arquivo de configuração.</p>}
            {config.map((f) => (
              <button key={f.path} type="button" className="file" title={f.path} onClick={() => onOpen(f.path)}>
                {f.label}
              </button>
            ))}
            <h3>Projeto</h3>
            {visible.map((entry) => {
              const parts = entry.path.split('/')
              const name = parts[parts.length - 1]
              const style = { paddingLeft: 8 + (parts.length - 1) * 14 }
              return entry.isDir ? (
                <button
                  key={entry.path}
                  type="button"
                  className="file dir"
                  style={style}
                  aria-expanded={expanded.has(entry.path)}
                  onClick={() => toggle(entry.path)}
                >
                  {expanded.has(entry.path) ? '▾' : '▸'} {name}
                </button>
              ) : (
                <button key={entry.path} type="button" className="file" style={style} title={entry.path} onClick={() => onOpen(entry.path)}>
                  {name}
                </button>
              )
            })}
          </>
        )}
      </div>
    </aside>
  )
}
