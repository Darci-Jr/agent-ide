import type { DockviewApi } from 'dockview-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AdapterInfo, Environment, SessionState, TemplateId } from '../../shared/types'
import { EnvironmentView } from './EnvironmentView'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { disposeTerminal, setTerminalTheme, type Theme } from './terminals'

const THEME_KEY = 'agent-ide-theme'

function initialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const TEMPLATES: Array<{ id: TemplateId; name: string; description: string }> = [
  { id: 'multi', name: 'Várias sessões', description: 'Grade de sessões' },
  { id: 'think', name: 'Pensar junto', description: 'Sessão e Markdown' },
  { id: 'blank', name: 'Em branco', description: 'Monte do zero' }
]

export function App(): ReactNode {
  const [environments, setEnvironments] = useState<Environment[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [stateList, setStateList] = useState<SessionState[]>([])
  const [modal, setModal] = useState<'new' | 'export' | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [toast, setToast] = useState<string | null>(null)
  const apis = useRef(new Map<string, DockviewApi>())

  const states = useMemo(() => new Map(stateList.map((s) => [s.id, s])), [stateList])

  useEffect(() => {
    void ide.listAdapters().then(setAdapters)
    void ide.listSessionStates().then(setStateList)
    void ide.listEnvironments().then((list) => {
      setEnvironments(list)
      setActiveId(list[0]?.id ?? null)
      if (list.length === 0) setModal('new')
    })
    return ide.onSessionStates(setStateList)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    setTerminalTheme(theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Sem armazenamento, o tema apenas não é lembrado.
    }
  }, [theme])

  // Só monta um ambiente quando ele é aberto; depois ele continua vivo, oculto.
  useEffect(() => {
    if (activeId) setMounted((current) => (current.has(activeId) ? current : new Set(current).add(activeId)))
  }, [activeId])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  const updateEnv = useCallback((env: Environment) => {
    setEnvironments((list) => list?.map((e) => (e.id === env.id ? env : e)) ?? null)
  }, [])

  const addEnvironment = (env: Environment | null): void => {
    if (!env) return
    setEnvironments((list) => [...(list ?? []), env])
    setActiveId(env.id)
    setModal(null)
  }

  const createEnvironment = async (template: TemplateId): Promise<void> => {
    try {
      addEnvironment(await ide.createEnvironment(template))
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  const importEnvironment = async (): Promise<void> => {
    try {
      addEnvironment(await ide.importEnvironment())
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  const exportEnvironment = async (): Promise<void> => {
    if (!activeId) return
    try {
      const saved = await ide.exportEnvironment(activeId, apis.current.get(activeId)?.toJSON() ?? null)
      if (saved) setModal(null)
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  const deleteEnvironment = async (env: Environment): Promise<void> => {
    if (!window.confirm(`Fechar o ambiente ${env.name} e encerrar suas sessões?`)) return
    await ide.deleteEnvironment(env.id)
    env.sessions.forEach((s) => disposeTerminal(s.id))
    apis.current.delete(env.id)
    setEnvironments((list) => {
      const next = list?.filter((e) => e.id !== env.id) ?? []
      if (activeId === env.id) setActiveId(next[0]?.id ?? null)
      if (next.length === 0) setModal('new')
      return next
    })
  }

  return (
    <div className="app">
      <header className="tabs">
        <div className="tab-list" role="tablist" aria-label="Ambientes">
          {environments?.map((env) => (
            <div key={env.id} className={`tab ${env.id === activeId ? 'on' : ''}`}>
              <button type="button" role="tab" aria-selected={env.id === activeId} title={env.cwd} onClick={() => setActiveId(env.id)}>
                {env.name}
              </button>
              <IconButton icon="close" label={`Fechar ambiente ${env.name}`} className="env-close" onClick={() => void deleteEnvironment(env)} />
            </div>
          ))}
        </div>
        <IconButton icon="plus" label="Novo ambiente" onClick={() => setModal('new')} />
        <div className="tabs-space" />
        <IconButton icon="upload" label="Exportar ambiente" disabled={!activeId} onClick={() => setModal('export')} />
      </header>

      <main className="environments">
        {environments
          ?.filter((env) => mounted.has(env.id))
          .map((env) => (
            <EnvironmentView
              key={env.id}
              env={env}
              active={env.id === activeId}
              theme={theme}
              adapters={adapters}
              states={states}
              onChange={updateEnv}
              onApi={(id, api) => apis.current.set(id, api)}
              toast={setToast}
              toggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            />
          ))}
      </main>

      {modal === 'new' && (
        <div className="overlay">
          <div className="modal" role="dialog" aria-label="Novo ambiente">
            <div className="modal-head">
              <h2>Novo ambiente</h2>
              <IconButton icon="download" label="Importar de um arquivo" onClick={() => void importEnvironment()} />
              {(environments?.length ?? 0) > 0 && <IconButton icon="close" label="Fechar" onClick={() => setModal(null)} />}
            </div>
            <div className="templates">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="template" onClick={() => void createEnvironment(t.id)}>
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modal === 'export' && (
        <div className="overlay">
          <div className="modal small" role="dialog" aria-label="Exportar ambiente">
            <h2>Exportar ambiente</h2>
            <p>Leva o layout e os painéis. Segredos, conversas e caminhos ficam de fora.</p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="button" className="primary" onClick={() => void exportEnvironment()}>
                Exportar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
