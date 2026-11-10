import type { DockviewApi } from 'dockview-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AdapterInfo, UpdateState, CacheInfo, TokenTotals, ClaudeUsage, CustomCommand, Environment, GitStatus, Preferences, SessionContext, SessionState } from '../../shared/types'
import { SettingsDialog } from './SettingsDialog'
import { Overlay } from './Overlay'
import { UsageBar } from './UsageBar'
import { CommandButtons } from './CommandButtons'
import { commandRunners, footerGitMenus, INTERRUPTED_TIP, unsavedPanels } from './context'
import { EnvironmentView } from './EnvironmentView'
import { Home } from './Home'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { disposeTerminal, setTerminalTheme, type Theme } from './terminals'
import { Tooltip } from './Tooltip'

const THEME_KEY = 'agent-ide-theme'
const RAIL_KEY = 'agent-ide-rail-expanded'

function initialRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

function initialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

type Modal = { kind: 'template'; env: Environment } | { kind: 'settings' }

export function App(): ReactNode {
  // undefined: ainda carregando; null: primeiro uso, sem pasta escolhida.
  const [workspace, setWorkspace] = useState<string | null | undefined>(undefined)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [stateList, setStateList] = useState<SessionState[]>([])
  const [modal, setModal] = useState<Modal | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [toast, setToast] = useState<string | null>(null)
  const [railExpanded, setRailExpanded] = useState(initialRail)
  const toggleRail = useCallback(() => {
    setRailExpanded((on) => {
      try {
        localStorage.setItem(RAIL_KEY, on ? '0' : '1')
      } catch {
        // Sem armazenamento, só não é lembrado ao reabrir.
      }
      return !on
    })
  }, [])
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [prefs, setPrefs] = useState<Preferences>({ showUsage: true, showContext: true, showCache: true, showTokens: true, showGit: true })
  // Sessão em uso em cada ambiente, e o contexto já lido de cada sessão.
  const [activeSessions, setActiveSessions] = useState<Record<string, string>>({})
  const [contexts, setContexts] = useState<Record<string, SessionContext | null>>({})
  const [restored, setRestored] = useState(false)
  const restoring = useRef(false)
  const apis = useRef(new Map<string, DockviewApi>())
  // Um painel montado em aba oculta mediria zero e estragaria o layout salvo: só monta ao aparecer.
  const shown = useRef(new Set<string>())
  if (activeId) shown.current.add(activeId)

  const states = useMemo(() => new Map(stateList.map((s) => [s.id, s])), [stateList])
  const active = environments.find((e) => e.id === activeId) ?? null
  // Momento do último clique no + das abas: remonta a tela inicial já em "Criar ambiente".
  const [newEnvironmentAt, setNewEnvironmentAt] = useState(0)
  const [homeVisit, setHomeVisit] = useState(0)

  // Comandos do projeto da sessão em uso: viram botões na aba do ambiente.
  const activeProjectId = (activeId && active?.sessions.find((s) => s.id === activeSessions[activeId])?.projectId) || active?.projectId || null
  const [commands, setCommands] = useState<CustomCommand[]>([])
  useEffect(() => {
    setCommands([])
    if (!activeProjectId) return
    let alive = true
    const load = (): void => void ide.listCommands(activeProjectId).then((list) => alive && setCommands(list), () => alive && setCommands([]))
    load()
    const off = ide.onCommandsChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [activeProjectId])
  // Fixados sempre à esquerda; dentro de cada grupo vale a ordem das abas abertas.
  const openEnvs = openIds
    .map((id) => environments.find((e) => e.id === id))
    .filter((e): e is Environment => Boolean(e))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null)

  useEffect(() => {
    void ide.getWorkspace().then(setWorkspace)
    void ide.listAdapters().then(setAdapters)
    void ide.listSessionStates().then(setStateList)
    void ide.getUsage().then(setUsage)
    void ide.getPreferences().then(setPrefs)
    void ide.getUpdate().then(setUpdate)
    const offUpdate = ide.onUpdate(setUpdate)
    const offUsage = ide.onUsage(setUsage)
    const offContext = ide.onContext((sessionId, context) => setContexts((all) => ({ ...all, [sessionId]: context })))
    const offStates = ide.onSessionStates(setStateList)
    return () => {
      offUsage()
      offUpdate()
      offContext()
      offStates()
    }
  }, [])

  // Plugins valem para todas as abas: o aviso de reiniciar considera as sessões do Claude de todas.
  const [pluginsChangedAt, setPluginsChangedAt] = useState(0)
  const markPluginsChanged = useCallback(() => setPluginsChangedAt(Date.now()), [])
  const claudeSessions = useMemo(
    () =>
      openEnvs.flatMap((env) =>
        env.sessions.flatMap((s) => {
          const state = states.get(s.id)
          return s.adapterId === 'claude' && state?.running && state.startedAt ? [{ id: s.id, title: s.title, startedAt: state.startedAt }] : []
        })
      ),
    // openEnvs é recalculado a cada render; environments e openIds são a origem dele.
    [environments, openIds, states]
  )

  const activeSessionId = activeId ? activeSessions[activeId] : undefined
  const activeSession = active?.sessions.find((s) => s.id === activeSessionId)
  const activeClaude = activeSession?.adapterId === 'claude' ? activeSession : null
  useEffect(() => {
    if (!activeClaude) return
    const id = activeClaude.id
    void ide.getContext(id).then((context) => setContexts((all) => ({ ...all, [id]: context })))
  }, [activeClaude?.id])

  // Cache da sessão do Claude em uso: o transcript muda a cada resposta, então relê de tempos em tempos.
  const [cache, setCache] = useState<CacheInfo | null>(null)
  const cacheSessionId = prefs.showCache ? (activeClaude?.id ?? null) : null
  useEffect(() => {
    setCache(null)
    if (!cacheSessionId) return
    let alive = true
    const read = (): void => {
      ide.getCache(cacheSessionId).then(
        (info) => alive && setCache(info),
        () => alive && setCache(null)
      )
    }
    read()
    const timer = setInterval(read, 10000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [cacheSessionId])

  // Tokens da conversa inteira da sessão do Claude em uso, somados do transcript.
  const [tokens, setTokens] = useState<TokenTotals | null>(null)
  const tokensSessionId = prefs.showTokens ? (activeClaude?.id ?? null) : null
  useEffect(() => {
    setTokens(null)
    if (!tokensSessionId) return
    let alive = true
    const read = (): void => {
      ide.getTokens(tokensSessionId).then(
        (totals) => alive && setTokens(totals),
        () => alive && setTokens(null)
      )
    }
    read()
    const timer = setInterval(read, 10000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tokensSessionId])

  // Git da pasta da sessão em uso; sem sessão escolhida, o do projeto do ambiente.
  const gitCwd = activeSession?.cwd ?? active?.cwd ?? null
  const [git, setGit] = useState<GitStatus | null>(null)
  useEffect(() => {
    setGit(null)
    if (!gitCwd || !prefs.showGit) return
    let alive = true
    const read = (): void => {
      ide.gitStatus(gitCwd).then(
        (status) => alive && setGit(status),
        () => alive && setGit(null)
      )
    }
    read()
    const timer = setInterval(read, 5000)
    const off = ide.onGitChanged(read)
    return () => {
      alive = false
      clearInterval(timer)
      off()
    }
  }, [gitCwd, prefs.showGit])

  const changePrefs = (next: Preferences): void => {
    setPrefs(next)
    ide.savePreferences(next).catch((err) => setToast(errorMessage(err)))
  }

  // Volta como estava: as mesmas abas, com as sessões que rodavam já retomadas.
  useEffect(() => {
    if (!workspace || restoring.current) return
    restoring.current = true
    const restore = async (): Promise<void> => {
      const [list, tabs] = await Promise.all([ide.listEnvironments(), ide.getOpenTabs()])
      setEnvironments(list)
      const ids = tabs.openIds.filter((id) => list.some((e) => e.id === id))
      const resumed = await Promise.all(ids.map((id) => ide.resumeEnvironment(id)))
      setEnvironments(list.map((e) => resumed.find((r) => r.id === e.id) ?? e))
      setOpenIds(ids)
      setActiveId(tabs.activeId && ids.includes(tabs.activeId) ? tabs.activeId : null)
    }
    restore()
      .catch((err) => setToast(errorMessage(err)))
      .finally(() => setRestored(true))
  }, [workspace])

  useEffect(() => {
    if (restored) ide.saveOpenTabs({ openIds, activeId })
  }, [restored, openIds, activeId])

  // O último ambiente usado é o que está à vista, não o último aberto.
  useEffect(() => {
    if (!restored || !activeId) return
    const now = Date.now()
    setEnvironments((list) => list.map((e) => (e.id === activeId ? { ...e, lastOpenedAt: now } : e)))
    void ide.markEnvironmentOpened(activeId)
  }, [restored, activeId])

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
  }

  /** Ambiente já existente: se a aba está aberta, só leva até ela. */
  const resumeEnvironment = async (id: string): Promise<void> => {
    if (openIds.includes(id)) setActiveId(id)
    else openEnvironment(await ide.resumeEnvironment(id))
  }

  /** Uma conversa já aberta não pode rodar duas vezes: leva à aba onde ela está. */
  const showOpenEnvironment = (environmentId: string): boolean => {
    const holder = openEnvs.find((env) => env.id === environmentId)
    if (holder) setActiveId(holder.id)
    return Boolean(holder)
  }

  /** Ao fixar, a aba vai para o fim dos fixados; ao desafixar, para o começo dos demais. */
  const togglePin = (env: Environment): void => {
    const pinned = !env.pinned
    updateEnv({ ...env, pinned })
    void ide.pinEnvironment(env.id, pinned).catch((err) => setToast(errorMessage(err)))
    setOpenIds((ids) => {
      const rest = ids.filter((id) => id !== env.id)
      const isPinned = (id: string): boolean => Boolean(environments.find((e) => e.id === id)?.pinned)
      let at = 0
      rest.forEach((id, i) => {
        if (isPinned(id)) at = i + 1
      })
      return [...rest.slice(0, at), env.id, ...rest.slice(at)]
    })
  }

  /** Arrastar só reordena dentro do mesmo grupo: fixar e desafixar é pelo alfinete. */
  const sameGroup = (a: string, b: string): boolean =>
    Boolean(environments.find((e) => e.id === a)?.pinned) === Boolean(environments.find((e) => e.id === b)?.pinned)

  const moveTab = (id: string, target: string, after: boolean): void => {
    if (id === target || !sameGroup(id, target)) return
    setOpenIds((ids) => {
      const rest = ids.filter((i) => i !== id)
      const at = rest.indexOf(target) + (after ? 1 : 0)
      return [...rest.slice(0, at), id, ...rest.slice(at)]
    })
  }

  const removeTab = (env: Environment): void => {
    env.sessions.forEach((s) => disposeTerminal(s.id))
    apis.current.delete(env.id)
    shown.current.delete(env.id)
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

  const requestClose = (env: Environment): void => {
    const panels = apis.current.get(env.id)?.panels ?? []
    if (panels.some((p) => unsavedPanels.has(p.id)) && !window.confirm('Descartar as alterações não salvas?')) return
    panels.forEach((p) => unsavedPanels.delete(p.id))
    // Ambiente sempre confirma; sessão e terminal fecham direto.
    const running = env.sessions.some((s) => states.get(s.id)?.running)
    const question = running ? `Fechar o ambiente ${env.name}? As sessões em execução serão encerradas.` : `Fechar o ambiente ${env.name}?`
    if (!window.confirm(question)) return
    void closeSaved(env)
  }

  /** Só a pedido: o app fecha, instala e reabre; as sessões que rodavam voltam sem continuar a tarefa. */
  const installUpdate = (): void => {
    if (update?.status === 'available') {
      void ide.installUpdate()
      return
    }
    if (!update || update.status !== 'ready') return
    const unsaved = unsavedPanels.size > 0 ? ' Há arquivos com alterações não salvas, que serão descartadas.' : ''
    if (!window.confirm(`Reiniciar para atualizar para a versão ${update.available}? As sessões voltam abertas, sem continuar o que faziam.${unsaved}`)) return
    unsavedPanels.clear()
    void ide.installUpdate()
  }

  const renameEnvironment = (env: Environment, name: string): void => {
    setRenaming(null)
    const clean = name.trim()
    if (!clean || clean === env.name) return
    updateEnv({ ...env, name: clean })
    ide.renameEnvironment(env.id, clean).catch((err) => setToast(errorMessage(err)))
  }

  const submitTemplate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (modal?.kind !== 'template') return
    try {
      const template = await ide.saveTemplateFromEnvironment(modal.env.id, templateName, apis.current.get(modal.env.id)?.toJSON() ?? null)
      setModal(null)
      setToast(`Template ${template.name} salvo. Ele aparece em Templates, na tela inicial.`)
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  if (workspace === undefined || (workspace && !restored)) return <div className="app" />

  if (workspace === null) {
    return (
      <div className="app">
        <div className="home">
          <div className="home-inner">
            <div className="home-head">
              <h1>Onde a IDE deve guardar suas coisas?</h1>
            </div>
            <p className="home-note">
              Escolha uma pasta uma única vez. Ambientes, templates e configurações da IDE ficam nela; seus projetos ficam onde você escolher. Prefira uma pasta fora de repositórios.
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
          onClick={() => {
            setActiveId(null)
            setNewEnvironmentAt(0)
            // Já na tela inicial, num passo interno: volta ao menu.
            setHomeVisit((n) => n + 1)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
          </svg>
        </button>
        <div className="tab-list" role="tablist" aria-label="Ambientes abertos">
          {openEnvs.map((env) => (
            <div
              key={env.id}
              className={`tab ${env.id === activeId ? 'on' : ''} ${env.pinned ? 'pinned' : ''} ${dragging === env.id ? 'dragging' : ''} ${
                dropHint?.id === env.id ? (dropHint.after ? 'drop-after' : 'drop-before') : ''
              }`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', env.id)
                setDragging(env.id)
              }}
              onDragOver={(e) => {
                if (!dragging || dragging === env.id || !sameGroup(dragging, env.id)) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                const after = e.clientX > box.left + box.width / 2
                if (dropHint?.id !== env.id || dropHint.after !== after) setDropHint({ id: env.id, after })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragging && dropHint) moveTab(dragging, dropHint.id, dropHint.after)
                setDragging(null)
                setDropHint(null)
              }}
              onDragEnd={() => {
                setDragging(null)
                setDropHint(null)
              }}
            >
              {renaming === env.id ? (
                <input
                  className="tab-rename env-rename"
                  aria-label="Nome do ambiente"
                  autoFocus
                  defaultValue={env.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => renameEnvironment(env, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={env.id === activeId}
                  data-tip="Clique duas vezes para renomear"
                  onClick={() => setActiveId(env.id)}
                  onDoubleClick={() => setRenaming(env.id)}
                >
                  {env.name}
                </button>
              )}
              {env.sessions.some((s) => s.interrupted) && (
                <span className="attention-mark" role="img" aria-label="Pede atenção" data-tip={INTERRUPTED_TIP}>
                  !
                </span>
              )}
              <IconButton icon="pin" label={env.pinned ? `Desafixar ${env.name}` : `Fixar ${env.name}`} className="env-pin" onClick={() => togglePin(env)} />
              <IconButton icon="close" label={`Fechar ${env.name}`} className="env-close" onClick={() => requestClose(env)} />
              {env.id === activeId && <CommandButtons commands={commands} onRun={(c) => commandRunners.get(env.id)?.(c)} />}
            </div>
          ))}
        </div>
        <IconButton
          icon="plus"
          label="Novo ambiente"
          className="tab-new"
          onClick={() => {
            setActiveId(null)
            setNewEnvironmentAt(Date.now())
          }}
        />
        <div className="tabs-space" />
        {active && (
          <IconButton
            icon="save"
            label="Salvar como template"
            onClick={() => {
              setTemplateName(active.name)
              setModal({ kind: 'template', env: active })
            }}
          />
        )}
        {(update?.status === 'ready' || update?.status === 'available') && (
          <IconButton
            icon="download"
            label={
              update.status === 'ready' ? `Versão ${update.available} pronta. Clique para reiniciar e atualizar` : `Versão ${update.available} disponível. Clique para baixar`
            }
            className="update-ready"
            onClick={installUpdate}
          />
        )}
        <IconButton icon="openFolder" label="Abrir pasta da IDE" onClick={() => void ide.openWorkspaceFolder()} />
      </header>

      <main className="environments">
        {activeId === null && (
          <Home
            key={`${homeVisit}-${newEnvironmentAt}`}
            start={newEnvironmentAt ? { name: 'new', template: null } : undefined}
            environments={environments}
            openIds={openIds}
            onOpen={openEnvironment}
            onResume={resumeEnvironment}
            showOpenEnvironment={showOpenEnvironment}
            onDeleted={(id) => setEnvironments((list) => list.filter((e) => e.id !== id))}
            toast={setToast}
          />
        )}
        {openEnvs.filter((env) => shown.current.has(env.id)).map((env) => (
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
            railExpanded={railExpanded}
            toggleRail={toggleRail}
            openSettings={() => setModal({ kind: 'settings' })}
            claudeSessions={claudeSessions}
            pluginsChangedAt={pluginsChangedAt}
            onPluginsChanged={markPluginsChanged}
            onActiveSession={(sessionId) => setActiveSessions((all) => (all[env.id] === sessionId ? all : { ...all, [env.id]: sessionId }))}
          />
        ))}
      </main>

      {(prefs.showUsage || prefs.showContext || prefs.showCache || prefs.showTokens || prefs.showGit) && (
        <UsageBar
          usage={usage}
          context={activeClaude ? { title: activeClaude.title, data: contexts[activeClaude.id] ?? null } : null}
          showUsage={prefs.showUsage}
          showContext={prefs.showContext}
          cache={cacheSessionId ? { data: cache } : null}
          tokens={tokensSessionId ? { data: tokens } : null}
          git={prefs.showGit && activeId ? git : null}
          openGitMenu={(anchor) => activeId && footerGitMenus.get(activeId)?.(anchor)}
        />
      )}

      {modal?.kind === 'settings' && (
        <SettingsDialog prefs={prefs} changePrefs={changePrefs} update={update} installUpdate={installUpdate} onClose={() => setModal(null)} />
      )}

      {modal?.kind === 'template' && (
        <Overlay onClose={() => setModal(null)}>
          <form className="modal small" role="dialog" aria-label="Salvar como template" onSubmit={(e) => void submitTemplate(e)}>
            <h2>Salvar como template</h2>
            <p>Guarda os projetos, as sessões e o layout deste ambiente, sem as conversas, para abrir outros iguais.</p>
            <input type="text" aria-label="Nome do template" autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Salvar
              </button>
            </div>
          </form>
        </Overlay>
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
