import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CreateSessionRequest, Environment, TemplateId } from '../shared/types'
import { adapterIds, listAdapters } from './adapters'
import { exportEnvironment, importEnvironment } from './exchange'
import { denyRead, getProtection, listConfigFiles, listTree, readProjectFile, writeProjectFile } from './files'
import { SessionManager } from './sessions'
import { EnvironmentStore } from './store'
import { createWorktree } from './worktree'

// Os testes usam um perfil separado e escolhem as pastas sem abrir diálogos.
if (process.env.AGENT_IDE_USER_DATA) app.setPath('userData', process.env.AGENT_IDE_USER_DATA)
const TEST_DIRECTORY = process.env.AGENT_IDE_TEST_DIRECTORY
const TEST_EXCHANGE_FILE = process.env.AGENT_IDE_TEST_EXCHANGE_FILE

let win: BrowserWindow | null = null
let manager: SessionManager
let store: EnvironmentStore

const send = (channel: string, ...args: unknown[]): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

async function pickDirectory(): Promise<string | null> {
  if (TEST_DIRECTORY) return TEST_DIRECTORY
  const result = await dialog.showOpenDialog(win!, { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

const sessionOf = (env: Environment, id: string) => {
  const session = env.sessions.find((s) => s.id === id)
  if (!session) throw new Error(`Sessão não encontrada: ${id}`)
  return session
}

function registerIpc(): void {
  ipcMain.handle('adapters:list', () => listAdapters())

  ipcMain.handle('env:list', () => store.all())
  ipcMain.handle('env:create', async (_e, template: TemplateId) => {
    const cwd = await pickDirectory()
    if (!cwd) return null
    const env: Environment = { id: randomUUID(), name: basename(cwd) || cwd, cwd, template, sessions: [], layout: null }
    store.add(env)
    return env
  })
  ipcMain.handle('env:delete', (_e, id: string) => {
    // As worktrees continuam no disco: podem ter trabalho ainda não salvo.
    for (const s of store.get(id).sessions) manager.remove(s.id)
    store.remove(id)
  })
  ipcMain.on('env:layout', (_e, id: string, layout: unknown) => {
    store.get(id).layout = layout
    store.saveSoon()
  })
  ipcMain.handle('env:export', async (_e, id: string, layout: unknown) => {
    const env = store.get(id)
    const target =
      TEST_EXCHANGE_FILE ??
      (await dialog.showSaveDialog(win!, {
        title: 'Exportar ambiente',
        defaultPath: `${env.name}.ambiente.json`,
        filters: [{ name: 'Ambiente', extensions: ['json'] }]
      })).filePath
    if (!target) return false
    await writeFile(target, exportEnvironment(env, layout), 'utf8')
    return true
  })
  ipcMain.handle('env:import', async () => {
    const source =
      TEST_EXCHANGE_FILE ??
      (await dialog.showOpenDialog(win!, {
        title: 'Importar ambiente',
        filters: [{ name: 'Ambiente', extensions: ['json'] }],
        properties: ['openFile']
      })).filePaths[0]
    if (!source) return null
    const text = await readFile(source, 'utf8')
    // Valida antes de perguntar a pasta, para um arquivo ruim falhar logo.
    importEnvironment(text, '', adapterIds())
    const cwd = await pickDirectory()
    if (!cwd) return null
    const env = importEnvironment(text, cwd, adapterIds())
    store.add(env)
    return env
  })

  ipcMain.handle('session:create', async (_e, req: CreateSessionRequest) => {
    const env = store.get(req.environmentId)
    const id = randomUUID()
    const worktree = req.worktree ? await createWorktree(env.cwd, id) : null
    const number = env.sessions.length + 1
    const session = {
      id,
      adapterId: req.adapterId,
      title: `Sessão ${number}`,
      cwd: worktree?.path ?? env.cwd,
      worktreeBranch: worktree?.branch,
      started: true
    }
    env.sessions.push(session)
    store.flush()
    await manager.start({ ...session, started: false })
    return { session, missingInWorktree: worktree?.missing ?? [] }
  })
  ipcMain.handle('session:start', async (_e, envId: string, id: string) => {
    const session = sessionOf(store.get(envId), id)
    await manager.start(session)
    session.started = true
    store.flush()
  })
  ipcMain.handle('session:stop', (_e, id: string) => manager.stop(id))
  ipcMain.handle('session:remove', (_e, envId: string, id: string) => {
    const env = store.get(envId)
    manager.remove(id)
    env.sessions = env.sessions.filter((s) => s.id !== id)
    store.flush()
  })
  ipcMain.handle('session:rename', (_e, envId: string, id: string, title: string) => {
    sessionOf(store.get(envId), id).title = title
    store.flush()
  })
  ipcMain.handle('session:states', () => manager.list())
  ipcMain.on('pty:write', (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))

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
  store = new EnvironmentStore(join(app.getPath('userData'), 'environments.json'))
  manager = new SessionManager({
    data: (id, data) => send('pty:data', id, data),
    states: (states) => send('session:states', states)
  })
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  manager?.dispose()
  store?.flush()
  app.quit()
})
