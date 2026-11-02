import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanel
} from 'dockview-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PluginsPanel } from './panels/PluginsPanel'
import { DiffPanel } from './panels/DiffPanel'
import type { AdapterInfo, CreateSessionRequest, CustomCommand, DiffPanelParams, Environment, FilePanelParams, PluginsPanelParams, SessionSpec, SessionState, TerminalPanelParams } from '../../shared/types'
import { commandRunners, EnvContext, INTERRUPTED_TIP, unsavedPanels, type EnvContextValue } from './context'
import { FileDrawer } from './FileDrawer'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { EditorPanel } from './panels/EditorPanel'
import { MarkdownPanel } from './panels/MarkdownPanel'
import { PanelTab } from './panels/PanelTab'
import { TerminalPanel } from './panels/TerminalPanel'
import { GitMenu } from './GitMenu'
import { CommandsDialog } from './CommandsDialog'
import { WorktreeDialog } from './WorktreeDialog'
import { disposeTerminal, focusTerminal, resetTerminal, syncTerminalSize, type Theme } from './terminals'

const components = { terminal: TerminalPanel, editor: EditorPanel, markdown: MarkdownPanel, plugins: PluginsPanel, diff: DiffPanel }

const termPanelId = (sessionId: string): string => `term:${sessionId}`
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path
const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+/g, '/').toLowerCase() === b.replace(/[\\/]+/g, '/').toLowerCase()

type AnyPanelParams = TerminalPanelParams | FilePanelParams | DiffPanelParams | PluginsPanelParams

const paramsOf = (panel: IDockviewPanel): AnyPanelParams => panel.params as unknown as AnyPanelParams

/** Divide o maior grupo pelo lado mais longo, formando uma grade naturalmente. */
function placeInGrid(api: DockviewApi): { referenceGroup: string; direction: 'right' | 'below' } | undefined {
  const largest = [...api.groups].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!largest) return undefined
  return { referenceGroup: largest.id, direction: largest.width >= largest.height ? 'right' : 'below' }
}

export function EnvironmentView(props: {
  env: Environment
  active: boolean
  theme: Theme
  adapters: AdapterInfo[]
  states: Map<string, SessionState>
  onChange(env: Environment): void
  onApi(id: string, api: DockviewApi): void
  toast(message: string): void
  toggleTheme(): void
  openSettings(): void
  /** A sessão em uso mudou: o rodapé mostra o contexto dela. */
  onActiveSession(sessionId: string): void
  claudeSessions: EnvContextValue['claudeSessions']
  pluginsChangedAt: number
  onPluginsChanged(): void
}): ReactNode {
  const { env, adapters, onChange, onApi, toast } = props
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  // Altura do ícone Git quando o menu está aberto; nulo com ele fechado.
  const [gitMenuAt, setGitMenuAt] = useState<number | null>(null)
  const gitButton = useRef<HTMLSpanElement>(null)
  const [commands, setCommands] = useState<CustomCommand[]>([])
  useEffect(() => {
    const load = (): void => void ide.listCommands(env.projectId).then(setCommands, () => setCommands([]))
    load()
    return ide.onCommandsChanged(load)
  }, [env.projectId])
  const [panelCount, setPanelCount] = useState(0)
  const envRef = useRef(env)
  envRef.current = env
  const apiRef = useRef<DockviewApi | null>(null)
  // Abrir um arquivo tira o foco da sessão, mas o terminal continua sendo o da última sessão usada.
  const lastSessionId = useRef('')
  const onActiveSessionRef = useRef(props.onActiveSession)
  onActiveSessionRef.current = props.onActiveSession

  const setFocus = useCallback((panelId: string | null) => {
    const dock = apiRef.current
    if (!dock) return
    if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
    const panel = panelId ? dock.getPanel(panelId) : undefined
    if (panel) {
      panel.api.setActive()
      panel.api.maximize()
      if (paramsOf(panel).kind === 'terminal') panel.api.setActive()
    }
    setFocusId(panel ? panel.id : null)
  }, [])

  const addTerminalPanel = useCallback((dock: DockviewApi, session: SessionSpec) => {
    if (dock.getPanel(termPanelId(session.id))) return
    dock.addPanel<TerminalPanelParams>({
      id: termPanelId(session.id),
      component: 'terminal',
      title: session.title,
      params: { kind: 'terminal', sessionId: session.id },
      position: placeInGrid(dock)
    })
  }, [])

  const updateSession = useCallback(
    (sessionId: string, patch: Partial<SessionSpec>) => {
      const current = envRef.current
      onChange({ ...current, sessions: current.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) })
    },
    [onChange]
  )

  const placeNewSession = useCallback(
    async (request: Omit<CreateSessionRequest, 'environmentId'>, takeFocus: boolean) => {
      const dock = apiRef.current
      if (!dock) return
      const { session, missingInWorktree } = await ide.createSession({ ...request, environmentId: envRef.current.id })
      const current = envRef.current
      onChange({ ...current, sessions: [...current.sessions, session] })
      if (dock.hasMaximizedGroup()) setFocus(null)
      addTerminalPanel(dock, session)
      if (takeFocus) focusTerminal(session.id)
      if (missingInWorktree.length > 0) {
        toast(`Não copiados para a worktree: ${missingInWorktree.join(', ')}`)
      }
    },
    [addTerminalPanel, onChange, setFocus, toast]
  )

  const createSession = useCallback(
    (adapterId: string, terminalOfSessionId?: string) =>
      placeNewSession({ adapterId, terminalOfSessionId }, terminalOfSessionId !== undefined).catch((err) => toast(errorMessage(err))),
    [placeNewSession, toast]
  )

  const runCommand = useCallback(
    (command: CustomCommand) =>
      placeNewSession({ adapterId: 'shell', terminalOfSessionId: lastSessionId.current || undefined, runCommandId: command.id }, true).catch((err) =>
        toast(errorMessage(err))
      ),
    [placeNewSession, toast]
  )
  useEffect(() => {
    commandRunners.set(env.id, runCommand)
    return () => {
      commandRunners.delete(env.id)
    }
  }, [env.id, runCommand])

  const claudeAvailable = adapters.some((a) => a.id === 'claude' && a.available)
  const defaultAdapter = adapters.find((a) => a.available)?.id ?? 'shell'
  const defaultAdapterRef = useRef(defaultAdapter)
  defaultAdapterRef.current = defaultAdapter

  const openFile = useCallback((path: string, asEditor = false) => {
    const dock = apiRef.current
    if (!dock) return
    if (dock.hasMaximizedGroup()) setFocus(null)
    const kind = /\.md$/i.test(path) && !asEditor ? 'markdown' : 'editor'
    const same = dock.panels.find((p) => {
      const params = paramsOf(p)
      return params.kind === kind && params.path === path
    })
    if (same) {
      same.api.setActive()
      return
    }
    // Um visualizador sem arquivo aberto é reaproveitado no lugar de abrir outro.
    if (kind === 'markdown') {
      const empty = dock.panels.find((p) => {
        const params = paramsOf(p)
        return params.kind === 'markdown' && !params.path
      })
      if (empty) {
        empty.api.updateParameters({ kind: 'markdown', path })
        empty.api.setTitle(baseName(path))
        empty.api.setActive()
        return
      }
    }
    const neighbour = dock.panels.find((p) => paramsOf(p).kind !== 'terminal')
    dock.addPanel<FilePanelParams>({
      id: `file:${crypto.randomUUID()}`,
      component: kind,
      title: baseName(path),
      params: { kind, path },
      position: neighbour ? { referencePanel: neighbour.id, direction: 'within' } : placeInGrid(dock)
    })
  }, [setFocus])

  /** Um painel de plugins por ambiente: se já existe, só traz para a frente. */
  const openPlugins = useCallback(() => {
    const dock = apiRef.current
    if (!dock) return
    if (dock.hasMaximizedGroup()) setFocus(null)
    const existing = dock.getPanel('plugins')
    if (existing) {
      existing.api.setActive()
      return
    }
    dock.addPanel<PluginsPanelParams>({ id: 'plugins', component: 'plugins', title: 'Plugins', params: { kind: 'plugins' }, position: placeInGrid(dock) })
  }, [setFocus])

  /** Um painel por pasta: abrir de novo a mesma pasta só traz o painel para a frente. */
  const openDiff = useCallback(
    (cwd: string) => {
      const dock = apiRef.current
      if (!dock) return
      if (dock.hasMaximizedGroup()) setFocus(null)
      const existing = dock.panels.find((p) => {
        const params = paramsOf(p)
        return params.kind === 'diff' && samePath(params.cwd ?? envRef.current.cwd, cwd)
      })
      if (existing) {
        existing.api.setActive()
        return
      }
      // Id aleatório, para o caminho não vazar na exportação.
      dock.addPanel<DiffPanelParams>({ id: `diff:${crypto.randomUUID()}`, component: 'diff', title: 'Alterações', params: { kind: 'diff', cwd }, position: placeInGrid(dock) })
    },
    [setFocus]
  )

  const closePanel = useCallback(
    (panelId: string) => {
      const dock = apiRef.current
      const panel = dock?.getPanel(panelId)
      if (!dock || !panel) return
      const params = paramsOf(panel)
      if (params.kind === 'terminal') {
        void ide.removeSession(envRef.current.id, params.sessionId)
        disposeTerminal(params.sessionId)
        const current = envRef.current
        onChange({ ...current, sessions: current.sessions.filter((s) => s.id !== params.sessionId) })
      } else if (unsavedPanels.has(panelId) && !window.confirm('Descartar as alterações não salvas?')) {
        return
      }
      unsavedPanels.delete(panelId)
      if (focusId === panelId) setFocus(null)
      panel.api.close()
    },
    [focusId, onChange, setFocus]
  )

  const context = useMemo<EnvContextValue>(
    () => ({
      env,
      states: props.states,
      theme: props.theme,
      focusId,
      setFocus,
      closePanel,
      toast,
      openFile,
      renameSession: (sessionId, title) => {
        void ide.renameSession(envRef.current.id, sessionId, title)
        updateSession(sessionId, { title })
        apiRef.current?.getPanel(termPanelId(sessionId))?.api.setTitle(title)
      },
      startSession: (sessionId) => {
        resetTerminal(sessionId)
        ide.startSession(envRef.current.id, sessionId).then(
          () => {
            updateSession(sessionId, { started: true })
            syncTerminalSize(sessionId)
          },
          (err) => toast(errorMessage(err))
        )
      },
      acknowledgeSession: (sessionId) => {
        void ide.acknowledgeSession(envRef.current.id, sessionId)
        updateSession(sessionId, { interrupted: false })
      },
      setDirty: (panelId, value) => {
        if (value) unsavedPanels.add(panelId)
        else unsavedPanels.delete(panelId)
      },
      commands,
      runCommand,
      claudeSessions: props.claudeSessions,
      pluginsChangedAt: props.pluginsChangedAt,
      markPluginsChanged: props.onPluginsChanged
    }),
    [closePanel, commands, runCommand, env, focusId, openFile, props.states, props.theme, props.claudeSessions, props.pluginsChangedAt, props.onPluginsChanged, setFocus, toast, updateSession]
  )

  const onReady = (event: DockviewReadyEvent): void => {
    const dock = event.api
    apiRef.current = dock
    setApi(dock)
    onApi(env.id, dock)
    const current = envRef.current
    if (current.layout) {
      try {
        dock.fromJSON(current.layout as never)
      } catch {
        toast('O layout salvo não pôde ser restaurado. Os painéis foram reorganizados.')
        dock.clear()
      }
    }
    for (const session of current.sessions) addTerminalPanel(dock, session)
    if (dock.hasMaximizedGroup()) setFocusId(dock.activePanel?.id ?? null)
    const rememberSession = (): void => {
      const params = dock.activePanel && paramsOf(dock.activePanel)
      if (params?.kind !== 'terminal') return
      lastSessionId.current = params.sessionId
      onActiveSessionRef.current(params.sessionId)
    }
    rememberSession()
    dock.onDidActivePanelChange(rememberSession)
    dock.onDidLayoutChange(() => {
      setPanelCount(dock.panels.length)
      ide.saveLayout(env.id, dock.toJSON())
    })
    setPanelCount(dock.panels.length)
    dock.onDidMaximizedGroupChange(() => {
      if (!dock.hasMaximizedGroup()) setFocusId(null)
      ide.saveLayout(env.id, dock.toJSON())
    })

    // Primeira abertura de um ambiente novo: monta o que o modelo promete.
    if (!current.layout && current.sessions.length === 0 && (current.template !== 'blank' || current.draft)) {
      void createSession(defaultAdapterRef.current).then(() => {
        if (current.template !== 'think') return
        dock.addPanel<FilePanelParams>({
          id: `file:${crypto.randomUUID()}`,
          component: 'markdown',
          title: 'Markdown',
          params: { kind: 'markdown', path: null },
          position: placeInGrid(dock)
        })
      })
    }
  }

  const empty = api !== null && panelCount === 0

  return (
    <div className="environment" style={{ display: props.active ? 'flex' : 'none' }}>
      <nav className="rail" aria-label="Ferramentas">
        <IconButton icon="grid" label="Visão geral" className={focusId ? '' : 'on'} onClick={() => setFocus(null)} />
        <IconButton icon="folder" label="Arquivos" className={filesOpen ? 'on' : ''} onClick={() => setFilesOpen(!filesOpen)} />
        <IconButton icon="plus" label="Nova sessão" onClick={() => void createSession(defaultAdapter)} />
        <IconButton icon="terminal" label="Abrir terminal na pasta da sessão atual" onClick={() => void createSession('shell', lastSessionId.current)} />
        <IconButton
          icon="worktree"
          label={claudeAvailable ? 'Nova sessão do Claude Code em worktree' : 'Claude Code não encontrado no PATH'}
          disabled={!claudeAvailable}
          onClick={() => setWorktreeOpen(true)}
        />
        <span ref={gitButton} className="rail-anchor">
          <IconButton
            icon="git"
            label="Git"
            className={gitMenuAt !== null ? 'on' : ''}
            onClick={() => setGitMenuAt(gitMenuAt === null ? (gitButton.current?.firstElementChild?.getBoundingClientRect().top ?? 100) : null)}
          />
        </span>
        <IconButton icon="plugins" label="Plugins" onClick={openPlugins} />
        <IconButton icon="commands" label="Comandos" className={commandsOpen ? 'on' : ''} onClick={() => setCommandsOpen(true)} />
        <IconButton icon="openFolder" label="Abrir pasta do projeto" onClick={() => void ide.openProjectFolder(env.projectId)} />
        <div className="rail-space" />
        <IconButton icon="settings" label="Configurações" onClick={props.openSettings} />
        <IconButton icon={props.theme === 'light' ? 'moon' : 'sun'} label={props.theme === 'light' ? 'Tema escuro' : 'Tema claro'} onClick={props.toggleTheme} />
      </nav>

      {gitMenuAt !== null && (
        <GitMenu
          cwd={env.sessions.find((s) => s.id === lastSessionId.current)?.cwd ?? env.cwd}
          top={gitMenuAt}
          sessionsInFolder={(root) =>
            env.sessions
              .filter((s) => s.id !== lastSessionId.current && props.states.get(s.id)?.running && samePath(s.cwd, root))
              .map((s) => s.title)
          }
          openTerminal={(path) => {
            setGitMenuAt(null)
            placeNewSession({ adapterId: 'shell', terminalInWorktree: path }, true).catch((err) => toast(errorMessage(err)))
          }}
          openDiff={(root) => {
            setGitMenuAt(null)
            openDiff(root)
          }}
          onClose={() => setGitMenuAt(null)}
        />
      )}

      {commandsOpen && <CommandsDialog projectId={env.projectId} onClose={() => setCommandsOpen(false)} />}

      {worktreeOpen && (
        <WorktreeDialog
          folderName={baseName(env.cwd)}
          onCreate={(name) => placeNewSession({ adapterId: 'claude', worktree: { name } }, true)}
          onClose={() => setWorktreeOpen(false)}
        />
      )}

      {filesOpen && <FileDrawer cwd={env.cwd} onOpen={openFile} />}

      <EnvContext.Provider value={context}>
        <div className="workspace">
          {focusId && (
            <div className="focus-strips" role="tablist" aria-label="Sessões">
              {env.sessions.map((s) => {
                const state = props.states.get(s.id)
                const on = focusId === termPanelId(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={`strip ${state?.running ? (state.busy ? 'busy' : 'idle') : 'stopped'} ${on ? 'on' : ''}`}
                    onClick={() => setFocus(termPanelId(s.id))}
                  >
                    {s.interrupted && <span className="attention-mark" aria-label="Pede atenção" data-tip={INTERRUPTED_TIP}>!</span>}
                    {s.title}
                  </button>
                )
              })}
            </div>
          )}
          <div className="dock">
            <DockviewReact
              components={components}
              defaultTabComponent={PanelTab as never}
              defaultRenderer="always"
              theme={props.theme === 'dark' ? themeDark : themeLight}
              onReady={onReady}
            />
            {empty && (
              <div className="dock-empty">
                <button type="button" className="primary" onClick={() => void createSession(defaultAdapter)}>
                  Nova sessão
                </button>
              </div>
            )}
          </div>
        </div>
      </EnvContext.Provider>
    </div>
  )
}
