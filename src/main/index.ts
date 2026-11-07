import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CreateEnvironmentRequest, CreateSessionRequest, Environment, HistoryEntry, NewEnvironmentRequest, OpenTabs, Preferences, SessionSpec, SessionState, CommandDraft, GitAction, Template, TemplateDraft } from '../shared/types'
import { adapterIds, listAdapters } from './adapters'
import { setClaudeSettings } from './adapters/claude'
import { CommandStore } from './commands'
import { fileDiff, gitChanges, gitStatus, repositoryRoot, listBranches, listWorktrees, removeWorktree, requireWorktree, runGitAction } from './git'
import { listPlugins, setPluginEnabled } from './plugins'
import { UsageTracker } from './usage'
import { cleanGroups, cleanName, exportTemplate, groupsOf, instantiate, parseTemplateFile, sameGroups, slotsFromGroups, TemplateStore, templateFromEnvironment } from './templates'
import { denyRead, getProtection, listConfigFiles, listTree, readProjectFile, writeProjectFile } from './files'
import { listHistory } from './history'
import { sessionCache, transcriptPath } from './cache'
import { TokenTally } from './tokens'
import { SessionManager } from './sessions'
import { EnvironmentStore, markInterrupted } from './store'
import { validateProjectName, Workspace } from './workspace'
import { Updater } from './updater'
import { createWorktree } from './worktree'

// Os testes usam um perfil separado e escolhem as pastas sem abrir diálogos. Fora deles, a pasta
// é sempre "agent-ide": com o nome do instalador ("Agent IDE") o Electron usaria outra pasta, e quem
// já usava perderia a pasta de trabalho escolhida, as preferências e os comandos gerais.
app.setPath('userData', process.env.AGENT_IDE_USER_DATA ?? join(app.getPath('appData'), 'agent-ide'))
// O `electron-vite preview` (npm run start) define NODE_ENV=production, e os terminais da IDE herdariam:
// um `npm install` neles pularia as dependências de desenvolvimento sem avisar.
if (!app.isPackaged && process.env.NODE_ENV === 'production') delete process.env.NODE_ENV
const TEST_DIRECTORY = process.env.AGENT_IDE_TEST_DIRECTORY
const TEST_WORKSPACE = process.env.AGENT_IDE_TEST_WORKSPACE
const TEST_PROJECT_PARENT = process.env.AGENT_IDE_TEST_PROJECT_PARENT
const TEST_EXCHANGE_FILE = process.env.AGENT_IDE_TEST_EXCHANGE_FILE

let win: BrowserWindow | null = null
let manager: SessionManager
let store: EnvironmentStore | null = null
let templates: TemplateStore | null = null
let workspace: Workspace
let usage: UsageTracker
let commands: CommandStore
let updater: Updater
const tokenTally = new TokenTally()

const send = (channel: string, ...args: unknown[]): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  // O seletor do Windows já tem "Nova pasta"; no Mac, createDirectory liga o botão.
  const result = await dialog.showOpenDialog(win!, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

const sessionOf = (env: Environment, id: string) => {
  const session = env.sessions.find((s) => s.id === id)
  if (!session) throw new Error(`Sessão não encontrada: ${id}`)
  return session
}

function requireStore(): EnvironmentStore {
  if (!store) throw new Error('Escolha a pasta de trabalho primeiro.')
  return store
}

function useWorkspace(dir: string): void {
  workspace.choose(dir)
  store = new EnvironmentStore(dir)
  templates = new TemplateStore(dir)
  migrateOldEnvironments()
}

/** Ambientes da versão anterior ficavam em um único arquivo, sem projeto. */
function migrateOldEnvironments(): void {
  const old = join(app.getPath('userData'), 'environments.json')
  if (!existsSync(old) || !store) return
  try {
    const list = JSON.parse(readFileSync(old, 'utf8')) as Environment[]
    for (const env of list) {
      if (!existsSync(env.cwd)) continue
      const project = workspace.addExisting(env.cwd)
      store.add({ ...env, projectId: project.id, lastOpenedAt: 0 })
    }
    renameSync(old, `${old}.migrado`)
  } catch (err) {
    console.error('Falha ao migrar ambientes antigos:', err)
  }
}

/**
 * Grava o estado a cada mudança, para valer também em uma queda. Sessões sem estado ficam como
 * estão: ao fechar a aba o processo some, mas a sessão continua marcada para voltar.
 */
function recordSessionStates(states: SessionState[]): void {
  if (!store) return
  const byId = new Map(states.map((s) => [s.id, s]))
  let changed = false
  for (const env of store.all()) {
    for (const session of env.sessions) {
      const state = byId.get(session.id)
      if (!state) continue
      if (Boolean(session.shouldRun) === state.running && Boolean(session.working) === state.working) continue
      session.shouldRun = state.running
      session.working = state.working
      changed = true
    }
  }
  if (changed) store.saveSoon()
}

function requireTemplates(): TemplateStore {
  if (!templates) throw new Error('Escolha a pasta de trabalho primeiro.')
  return templates
}

const projectName = (id: string): string => {
  try {
    return workspace.get(id).name
  } catch {
    return 'Projeto removido'
  }
}

/** Projetos do ambiente: o principal e os das sessões. */
const projectsOf = (env: Environment): string[] => [...new Set([env.projectId, ...env.sessions.map((s) => s.projectId ?? env.projectId)])]

const dateLabel = (): string => new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')

/** Inicia as sessões de um ambiente novo; cada uma é marcada como já iniciada, como em session:create. */
async function startNew(sessions: SessionSpec[]): Promise<void> {
  await Promise.all(
    sessions.map(async (s) => {
      await manager.start({ ...s, started: false }).catch((err) => console.error(`Sessão não iniciada: ${s.id}`, err))
      s.started = true
    })
  )
}

function uniqueName(base: string): string {
  const taken = new Set(requireStore().all().map((e) => e.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

function registerIpc(): void {
  ipcMain.handle('adapters:list', () => listAdapters())

  ipcMain.handle('workspace:get', () => workspace.dir)
  ipcMain.handle('update:get', () => updater.get())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:install', () => updater.install())
  ipcMain.handle('workspace:choose', async () => {
    if (TEST_WORKSPACE) {
      useWorkspace(TEST_WORKSPACE)
      return TEST_WORKSPACE
    }
    for (;;) {
      const dir = await pickDirectory('Escolha a pasta de trabalho da IDE')
      if (!dir) return null
      // Só avisa: dados da IDE dentro de um repositório se misturam com o código dele.
      const repo = await repositoryRoot(dir)
      if (repo) {
        const { response } = await dialog.showMessageBox(win!, {
          type: 'warning',
          title: 'Pasta dentro de um repositório Git',
          message: 'Esta pasta está dentro de um repositório Git.',
          detail: `${repo}\n\nAmbientes, abas, comandos e a lista de projetos da IDE ficariam junto com o código dele.`,
          buttons: ['Escolher outra', 'Usar mesmo assim'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 0) continue
      }
      useWorkspace(dir)
      return dir
    }
  })
  ipcMain.handle('workspace:open', () => shell.openPath(workspace.dir ?? ''))
  ipcMain.handle('project:open', (_e, id: string) => shell.openPath(workspace.get(id).path))

  ipcMain.handle('project:list', () => workspace.projects())
  ipcMain.handle('project:create', async (_e, name: string, parent?: string) => {
    const clean = validateProjectName(name)
    const where =
      typeof parent === 'string' && parent ? parent : TEST_PROJECT_PARENT ?? (await pickDirectory(`Onde criar "${clean}"?`, workspace.lastProjectParent ?? app.getPath('documents')))
    return where ? workspace.createProject(where, clean) : null
  })
  ipcMain.handle('project:pick-parent', async () =>
    TEST_PROJECT_PARENT ?? (await pickDirectory('Onde criar a pasta nova?', workspace.lastProjectParent ?? app.getPath('documents')))
  )
  ipcMain.handle('project:add', async () => {
    const dir = TEST_DIRECTORY ?? (await pickDirectory('Escolha a pasta do projeto'))
    return dir ? workspace.addExisting(dir) : null
  })
  ipcMain.handle('project:remove', (_e, id: string) => workspace.remove(id))
  ipcMain.handle('history:list', (_e, id: string) => listHistory(workspace.get(id).path))
  ipcMain.handle('history:open', async (_e, projectId: string, entry: HistoryEntry) => {
    const project = workspace.get(projectId)
    if (!existsSync(entry.cwd)) throw new Error(`A pasta desta conversa não existe mais: ${entry.cwd}`)
    const session = { id: entry.sessionId, adapterId: 'claude', title: entry.title, cwd: entry.cwd, started: true }
    const env: Environment = {
      id: randomUUID(),
      name: uniqueName(`${project.name} ${dateLabel()}`),
      projectId,
      lastOpenedAt: Date.now(),
      cwd: project.path,
      sessions: [session],
      layout: null
    }
    requireStore().add(env)
    workspace.touch(projectId)
    await manager.start(session)
    return env
  })

  ipcMain.handle('env:list', () => store?.all() ?? [])
  // Sessão rápida: o renderer abre a primeira sessão ao montar o ambiente vazio.
  ipcMain.handle('env:create', (_e, req: CreateEnvironmentRequest) => {
    const project = workspace.get(req.projectId)
    const env: Environment = {
      id: randomUUID(),
      name: uniqueName(`${project.name} ${dateLabel()}`),
      projectId: project.id,
      lastOpenedAt: Date.now(),
      cwd: project.path,
      sessions: [],
      layout: null
    }
    requireStore().add(env)
    workspace.touch(project.id)
    return env
  })
  ipcMain.handle('env:new', async (_e, req: NewEnvironmentRequest) => {
    const groups = cleanGroups(req?.groups, workspace.projects().map((p) => p.id))
    const template = req.templateId ? requireTemplates().get(req.templateId) : null
    // O layout do template só serve se as sessões pedidas são as mesmas dele.
    const fromTemplate = template && sameGroups(groupsOf(template.slots), groups) ? template : null
    const slots = fromTemplate ? fromTemplate.slots : slotsFromGroups(groups, projectName)
    const { sessions, layout } = instantiate(slots, fromTemplate?.layout ?? null, (id) => workspace.get(id).path)
    const main = workspace.get(groups[0]!.projectId)
    const base = template ? template.name : groups.map((g) => projectName(g.projectId)).join(' + ')
    const env: Environment = { id: randomUUID(), name: uniqueName(base), projectId: main.id, lastOpenedAt: Date.now(), cwd: main.path, sessions, layout }
    requireStore().add(env)
    for (const g of groups) workspace.touch(g.projectId)
    await startNew(sessions)
    requireStore().flush()
    return env
  })
  ipcMain.handle('env:rename', (_e, id: string, name: string) => {
    const clean = String(name ?? '').trim().slice(0, 80)
    if (!clean) throw new Error('Dê um nome ao ambiente.')
    requireStore().get(id).name = clean
    requireStore().flush()
  })

  ipcMain.handle('template:list', () => templates?.list() ?? [])
  ipcMain.handle('template:save', (_e, draft: TemplateDraft, id?: string) => {
    const groups = cleanGroups(draft?.groups, workspace.projects().map((p) => p.id))
    const old = id ? requireTemplates().get(id) : null
    // Mesmas sessões: guarda o layout; senão as sessões voltam a ficar em grade.
    const keep = old && sameGroups(groupsOf(old.slots), groups)
    const template: Template = {
      id: old?.id ?? randomUUID(),
      name: cleanName(draft.name),
      slots: keep ? old.slots : slotsFromGroups(groups, projectName),
      layout: keep ? old.layout : null,
      updatedAt: Date.now()
    }
    return requireTemplates().save(template)
  })
  ipcMain.handle('template:from-env', (_e, envId: string, name: string, layout: unknown) =>
    requireTemplates().save(templateFromEnvironment(requireStore().get(envId), name, layout))
  )
  ipcMain.handle('template:delete', (_e, id: string) => requireTemplates().remove(id))
  ipcMain.handle('template:export', async (_e, id: string) => {
    const template = requireTemplates().get(id)
    const target =
      TEST_EXCHANGE_FILE ??
      (await dialog.showSaveDialog(win!, {
        title: 'Exportar template',
        defaultPath: `${template.name}.template.json`,
        filters: [{ name: 'Template', extensions: ['json'] }]
      })).filePath
    if (!target) return false
    await writeFile(target, exportTemplate(template, projectName), 'utf8')
    return true
  })
  ipcMain.handle('template:import', async () => {
    const source =
      TEST_EXCHANGE_FILE ??
      (await dialog.showOpenDialog(win!, {
        title: 'Importar template',
        filters: [{ name: 'Template', extensions: ['json'] }],
        properties: ['openFile']
      })).filePaths[0]
    if (!source) return null
    const parsed = parseTemplateFile(await readFile(source, 'utf8'), adapterIds())
    // Projetos pelo nome; os que não existem aqui, a pessoa aponta a pasta.
    const ids: string[] = []
    for (const name of parsed.projects) {
      const known = workspace.projects().find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (known) {
        ids.push(known.id)
        continue
      }
      const dir = TEST_DIRECTORY ?? (await pickDirectory(`Onde está o projeto "${name}" deste template?`))
      if (!dir) return null
      ids.push(workspace.addExisting(dir).id)
    }
    const template: Template = {
      id: randomUUID(),
      name: parsed.name,
      slots: parsed.slots.map((s) => ({ slot: s.slot, projectId: ids[s.project]!, adapterId: s.adapterId, title: s.title })),
      layout: parsed.layout,
      updatedAt: Date.now()
    }
    return requireTemplates().save(template)
  })
  ipcMain.handle('env:opened', (_e, id: string) => {
    const env = requireStore().get(id)
    env.lastOpenedAt = Date.now()
    workspace.touch(env.projectId)
    requireStore().saveSoon()
  })
  ipcMain.handle('env:resume', async (_e, id: string) => {
    const env = requireStore().get(id)
    const toResume = env.sessions.filter((s) => s.shouldRun)
    // Uma sessão que não abre, como a de uma pasta apagada, fica parada com o botão Retomar.
    await Promise.all(toResume.map((s) => manager.start(s).catch((err) => console.error(`Sessão não retomada: ${s.id}`, err))))
    return env
  })
  ipcMain.handle('tabs:get', () => workspace.tabs())
  ipcMain.on('tabs:save', (_e, tabs: OpenTabs) => workspace.saveTabs(tabs))
  ipcMain.handle('env:pin', (_e, id: string, pinned: boolean) => {
    requireStore().get(id).pinned = pinned === true
    requireStore().flush()
  })
  ipcMain.handle('env:close', (_e, id: string) => {
    const env = requireStore().get(id)
    // As sessões que rodavam continuam marcadas (shouldRun): reabrir pelo histórico as retoma.
    env.closedAt = Date.now()
    markInterrupted(env)
    for (const s of env.sessions) manager.remove(s.id)
    requireStore().flush()
  })
  ipcMain.handle('env:delete', (_e, id: string) => {
    // As worktrees continuam no disco: podem ter trabalho ainda não salvo.
    for (const s of requireStore().get(id).sessions) {
      manager.remove(s.id)
      usage.forget(s.id)
    }
    requireStore().remove(id)
  })
  ipcMain.on('env:layout', (_e, id: string, layout: unknown) => {
    requireStore().get(id).layout = layout
    requireStore().saveSoon()
  })
  ipcMain.handle('session:create', async (_e, req: CreateSessionRequest) => {
    const env = requireStore().get(req.environmentId)
    const id = randomUUID()
    const origin = env.sessions.find((s) => s.id === req.terminalOfSessionId)
    // Projeto da sessão em uso; só vale um dos projetos do ambiente.
    const projectId = origin?.projectId ?? req.projectId ?? env.projectId
    if (!projectsOf(env).includes(projectId)) throw new Error('Projeto fora deste ambiente.')
    const project = workspace.get(projectId)
    const worktree = req.worktree ? await createWorktree(project.path, id, req.worktree.name) : null
    const number = env.sessions.length + 1
    // Só uma worktree que o Git lista para o repositório do projeto.
    const inWorktree = req.terminalInWorktree ? (await requireWorktree(project.path, req.terminalInWorktree)).path : null
    // Só comandos salvos para o projeto; o renderer não manda texto para executar.
    const command = req.runCommandId ? commands.list(projectId).find((c) => c.id === req.runCommandId) : undefined
    if (req.runCommandId && (!command || req.adapterId !== 'shell')) throw new Error('Comando não encontrado.')
    const session = {
      id,
      adapterId: req.adapterId,
      title: worktree?.name ?? (command ? command.name || command.command : `${req.adapterId === 'shell' ? 'Terminal' : 'Sessão'} ${number}`),
      cwd: worktree?.path ?? inWorktree ?? origin?.cwd ?? project.path,
      projectId,
      worktreeBranch: worktree?.branch,
      started: true
    }
    env.sessions.push(session)
    requireStore().flush()
    await manager.start({ ...session, started: false }, command ? `${command.command}\r` : undefined)
    return { session, missingInWorktree: worktree?.missing ?? [] }
  })
  ipcMain.handle('session:start', async (_e, envId: string, id: string) => {
    const session = sessionOf(requireStore().get(envId), id)
    await manager.start(session)
    session.started = true
    requireStore().flush()
  })
  ipcMain.handle('session:stop', (_e, id: string) => manager.stop(id))
  ipcMain.handle('session:remove', (_e, envId: string, id: string) => {
    const env = requireStore().get(envId)
    manager.remove(id)
    usage.forget(id)
    tokenTally.forget(id)
    env.sessions = env.sessions.filter((s) => s.id !== id)
    requireStore().flush()
  })
  ipcMain.handle('session:rename', (_e, envId: string, id: string, title: string) => {
    sessionOf(requireStore().get(envId), id).title = title
    requireStore().flush()
  })
  ipcMain.handle('session:acknowledge', (_e, envId: string, id: string) => {
    sessionOf(requireStore().get(envId), id).interrupted = false
    requireStore().flush()
  })
  ipcMain.handle('session:states', () => manager.list())
  ipcMain.on('pty:write', (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))

  const requireDir = (cwd: string): string => {
    if (typeof cwd !== 'string' || !existsSync(cwd)) throw new Error('A pasta não existe mais.')
    return cwd
  }
  ipcMain.handle('git:status', (_e, cwd: string) => (existsSync(cwd) ? gitStatus(cwd) : null))
  ipcMain.handle('git:changes', (_e, cwd: string) => (existsSync(cwd) ? gitChanges(cwd) : null))
  ipcMain.handle('git:file-diff', (_e, cwd: string, path: string) => fileDiff(requireDir(cwd), path))
  ipcMain.handle('git:branches', (_e, cwd: string) => listBranches(requireDir(cwd)))
  ipcMain.handle('git:worktrees', (_e, cwd: string) => listWorktrees(requireDir(cwd)))
  ipcMain.handle('git:action', async (_e, cwd: string, action: GitAction) => {
    try {
      return await runGitAction(requireDir(cwd), action)
    } finally {
      send('git:changed')
    }
  })
  ipcMain.handle('git:remove-worktree', async (_e, cwd: string, path: string) => {
    const worktree = await requireWorktree(requireDir(cwd), path)
    // Remover a pasta debaixo de um processo em uso deixaria a sessão quebrada.
    const inUse = (store?.all() ?? []).flatMap((env) => env.sessions).filter((s) => {
      const state = manager.list().find((st) => st.id === s.id)
      return state?.running && resolve(s.cwd).toLowerCase().startsWith(resolve(worktree.path).toLowerCase())
    })
    if (inUse.length > 0) throw new Error(`Feche antes as sessões que usam esta worktree: ${inUse.map((s) => s.title).join(', ')}.`)
    await removeWorktree(cwd, path)
    send('git:changed')
  })
  ipcMain.handle('git:open-folder', async (_e, cwd: string, path: string) => {
    await shell.openPath((await requireWorktree(requireDir(cwd), path)).path)
  })
  ipcMain.handle('commands:list', (_e, projectId: string) => commands.list(projectId))
  ipcMain.handle('commands:save', (_e, projectId: string, draft: CommandDraft, id?: string) => {
    const saved = commands.save(projectId, draft, typeof id === 'string' ? id : undefined)
    send('commands:changed')
    return saved
  })
  ipcMain.handle('commands:delete', (_e, projectId: string, id: string) => {
    commands.remove(projectId, id)
    send('commands:changed')
  })
  ipcMain.handle('plugins:list', (_e, cwd: string) => {
    if (!existsSync(cwd)) throw new Error('A pasta do projeto não existe mais.')
    return listPlugins(cwd)
  })
  ipcMain.handle('plugins:set', (_e, cwd: string, id: string, enabled: boolean) => {
    if (!existsSync(cwd)) throw new Error('A pasta do projeto não existe mais.')
    return setPluginEnabled(cwd, id, Boolean(enabled))
  })
  ipcMain.handle('usage:get', () => usage.usage())
  ipcMain.handle('prefs:get', () => usage.preferences())
  ipcMain.handle('context:get', (_e, id: string) => usage.context(id))
  ipcMain.handle('tokens:get', async (_e, id: string) => {
    const session = (store?.all() ?? []).flatMap((env) => env.sessions).find((s) => s.id === id)
    return session?.adapterId === 'claude' ? tokenTally.read(session.id, await transcriptPath(session.cwd, session.id)) : null
  })
  ipcMain.handle('cache:get', (_e, id: string) => {
    const session = (store?.all() ?? []).flatMap((env) => env.sessions).find((s) => s.id === id)
    return session?.adapterId === 'claude' ? sessionCache(session.cwd, session.id) : null
  })
  ipcMain.handle('prefs:save', (_e, prefs: Preferences) => usage.savePreferences(prefs))

  ipcMain.handle('files:tree', (_e, cwd: string) => listTree(cwd))
  ipcMain.handle('files:config', (_e, cwd: string) => listConfigFiles(cwd))
  ipcMain.handle('files:read', (_e, cwd: string, path: string) => readProjectFile(cwd, path))
  ipcMain.handle('files:write', (_e, cwd: string, path: string, content: string, mtime: number | null) =>
    writeProjectFile(cwd, path, content, mtime)
  )
  ipcMain.handle('files:protection', (_e, cwd: string, path: string) => getProtection(cwd, path))
  ipcMain.handle('files:deny', (_e, cwd: string, path: string) => denyRead(cwd, path))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Agent IDE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Links abrem no navegador; o app nunca navega para fora da própria tela.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Disparado quando há edições não salvas ao fechar a janela.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      message: 'Há arquivos com alterações não salvas.',
      buttons: ['Fechar sem salvar', 'Continuar editando'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice === 0) e.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  if (!process.env.ELECTRON_RENDERER_URL) {
    electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:"
          ]
        }
      })
    })
  }
  workspace = new Workspace(join(app.getPath('userData'), 'config.json'))
  usage = new UsageTracker(
    app.getPath('userData'),
    (current) => send('usage:changed', current),
    (sessionId, context) => send('context:changed', sessionId, context)
  )
  setClaudeSettings((sessionId, cwd) => usage.settingsFor(sessionId, cwd))
  commands = new CommandStore(join(app.getPath('userData'), 'comandos.json'), () =>
    workspace.dir ? join(workspace.dir, 'comandos.json') : null
  )
  if (workspace.dir) useWorkspace(workspace.dir)
  manager = new SessionManager({
    data: (id, data) => send('pty:data', id, data),
    states: (states) => {
      recordSessionStates(states)
      send('session:states', states)
    }
  })
  updater = new Updater((state) => send('update:changed', state))
  registerIpc()
  createWindow()
  updater.start()
})

app.on('window-all-closed', () => {
  updater?.dispose()
  manager?.dispose()
  usage?.dispose()
  store?.flush()
  app.quit()
})
