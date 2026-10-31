import type { DockviewApi } from 'dockview-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AdapterInfo, Environment, SessionState } from '../../shared/types'
import { unsavedPanels } from './context'
import { EnvironmentView } from './EnvironmentView'
import { Home } from './Home'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { disposeTerminal, setTerminalTheme, type Theme } from './terminals'
import { Tooltip } from './Tooltip'

const THEME_KEY = 'agent-ide-theme'

function initialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

type Modal =
  | { kind: 'export' }
  | { kind: 'save'; env: Environment; closeAfter: boolean }
  | { kind: 'close-draft'; env: Environment }

export function App(): ReactNode {
  // undefined: ainda carregando; null: primeiro uso, sem pasta escolhida.
  const [workspace, setWorkspace] = useState<string | null | undefined>(undefined)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [stateList, setStateList] = useState<SessionState[]>([])
  const [modal, setModal] = useState<Modal | null>(null)
  const [saveName, setSaveName] = useState('')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [toast, setToast] = useState<string | null>(null)
  const apis = useRef(new Map<string, DockviewApi>())

  const states = useMemo(() => new Map(stateList.map((s) => [s.id, s])), [stateList])
  const active = environments.find((e) => e.id === activeId) ?? null
  const openEnvs = openIds.map((id) => environments.find((e) => e.id === id)).filter((e): e is Environment => Boolean(e))

  useEffect(() => {
    void ide.getWorkspace().then(setWorkspace)
    void ide.listAdapters().then(setAdapters)
    void ide.listSessionStates().then(setStateList)
    return ide.onSessionStates(setStateList)
  }, [])

  useEffect(() => {
    if (workspace) void ide.listEnvironments().then(setEnvironments)
  }, [workspace])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    setTerminalTheme(theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Sem armazenamento, o tema apenas não é lembrado.
    }
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  const updateEnv = useCallback((env: Environment) => {
    setEnvironments((list) => list.map((e) => (e.id === env.id ? env : e)))
  }, [])

  const openEnvironment = (env: Environment): void => {
    setEnvironments((list) => (list.some((e) => e.id === env.id) ? list.map((e) => (e.id === env.id ? env : e)) : [...list, env]))
    setOpenIds((ids) => (ids.includes(env.id) ? ids : [...ids, env.id]))
    setActiveId(env.id)
    void ide.markEnvironmentOpened(env.id)
  }

  /** Uma conversa já aberta não pode rodar duas vezes: leva à aba onde ela está. */
  const showOpenSession = (sessionId: string): boolean => {
    const holder = openEnvs.find((env) => env.sessions.some((s) => s.id === sessionId))
    if (holder) setActiveId(holder.id)
    return Boolean(holder)
  }

  const removeTab = (env: Environment): void => {
    env.sessions.forEach((s) => disposeTerminal(s.id))
    apis.current.delete(env.id)
    setOpenIds((ids) => ids.filter((id) => id !== env.id))
    if (activeId === env.id) {
      const rest = openIds.filter((id) => id !== env.id)
      setActiveId(rest[rest.length - 1] ?? null)
    }
  }

  const closeSaved = async (env: Environment): Promise<void> => {
    await ide.closeEnvironment(env.id)
    removeTab(env)
  }

  const discardDraft = async (env: Environment): Promise<void> => {
    await ide.deleteEnvironment(env.id)
    removeTab(env)
    setEnvironments((list) => list.filter((e) => e.id !== env.id))
  }

  const requestClose = (env: Environment): void => {
    const panels = apis.current.get(env.id)?.panels ?? []
    if (panels.some((p) => unsavedPanels.has(p.id)) && !window.confirm('Descartar as alterações não salvas?')) return
    panels.forEach((p) => unsavedPanels.delete(p.id))
    if (env.draft) {
      setModal({ kind: 'close-draft', env })
      return
    }
    const running = env.sessions.some((s) => states.get(s.id)?.running)
    if (running && !window.confirm(`Fechar ${env.name} e encerrar suas sessões?`)) return
    void closeSaved(env)
  }

  const startSaving = (env: Environment, closeAfter: boolean): void => {
    setSaveName('')
    setModal({ kind: 'save', env, closeAfter })
  }

  const submitSave = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (modal?.kind !== 'save') return
    try {
      const saved = await ide.saveEnvironment(modal.env.id, saveName)
      // A cópia do app tem as sessões mais recentes; do processo principal vêm nome e estado.
      const merged = { ...(environments.find((env) => env.id === saved.id) ?? saved), name: saved.name, draft: false }
      updateEnv(merged)
      setModal(null)
      if (modal.closeAfter) await closeSaved(merged)
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

  if (workspace === undefined) return <div className="app" />

  if (workspace === null) {
    return (
      <div className="app">
        <div className="home">
          <div className="home-inner">
            <div className="home-head">
              <h1>Onde a IDE deve guardar suas coisas?</h1>
            </div>
            <p className="home-note">
              Escolha uma pasta uma única vez. Projetos novos, ambientes e sessões temporárias ficam organizados nela.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                void ide.chooseWorkspace().then(
                  (dir) => dir && setWorkspace(dir),
                  (err) => setToast(errorMessage(err))
                )
              }
            >
              Escolher pasta
            </button>
          </div>
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="tabs">
        <button
          type="button"
          className={`tab-home ${activeId === null ? 'on' : ''}`}
          aria-label="Início"
          data-tip="Início"
          onClick={() => setActiveId(null)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
          </svg>
        </button>
        <div className="tab-list" role="tablist" aria-label="Ambientes abertos">
          {openEnvs.map((env) => (
            <div key={env.id} className={`tab ${env.id === activeId ? 'on' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={env.id === activeId}
                className={env.draft ? 'draft' : ''}
                data-tip={env.cwd}
                onClick={() => setActiveId(env.id)}
              >
                {env.name}
              </button>
              <IconButton icon="close" label={`Fechar ${env.name}`} className="env-close" onClick={() => requestClose(env)} />
            </div>
          ))}
        </div>
        <div className="tabs-space" />
        {active?.draft && <IconButton icon="save" label="Salvar como ambiente" onClick={() => startSaving(active, false)} />}
        {active && <IconButton icon="upload" label="Exportar ambiente" onClick={() => setModal({ kind: 'export' })} />}
        <IconButton icon="openFolder" label="Abrir pasta da IDE" onClick={() => void ide.openWorkspaceFolder()} />
      </header>

      <main className="environments">
        {activeId === null && (
          <Home
            environments={environments}
            onOpen={openEnvironment}
            showOpenSession={showOpenSession}
            onDeleted={(id) => setEnvironments((list) => list.filter((e) => e.id !== id))}
            toast={setToast}
          />
        )}
        {openEnvs.map((env) => (
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

      {modal?.kind === 'export' && (
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

      {modal?.kind === 'save' && (
        <div className="overlay">
          <form className="modal small" role="dialog" aria-label="Salvar como ambiente" onSubmit={(e) => void submitSave(e)}>
            <h2>Salvar como ambiente</h2>
            <p>Dê um nome para encontrá-lo depois.</p>
            <input type="text" aria-label="Nome do ambiente" autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}

      {modal?.kind === 'close-draft' && (
        <div className="overlay">
          <div className="modal small" role="dialog" aria-label="Fechar sessão temporária">
            <h2>Salvar este ambiente?</h2>
            <p>Sem salvar, o layout é descartado. As conversas continuam no histórico do projeto.</p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const { env } = modal
                  setModal(null)
                  void discardDraft(env)
                }}
              >
                Descartar
              </button>
              <button type="button" className="primary" onClick={() => startSaving(modal.env, true)}>
                Salvar
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
      <Tooltip />
    </div>
  )
}
