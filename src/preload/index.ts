import { contextBridge, ipcRenderer } from 'electron'
import type { IdeApi } from '../shared/types'

const listen = <A extends unknown[]>(channel: string, cb: (...args: A) => void) => {
  const handler = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api: IdeApi = {
  listAdapters: () => invoke('adapters:list'),
  listEnvironments: () => invoke('env:list'),
  createEnvironment: (template) => invoke('env:create', template),
  deleteEnvironment: (id) => invoke('env:delete', id),
  saveLayout: (id, layout) => ipcRenderer.send('env:layout', id, layout),
  exportEnvironment: (id, layout) => invoke('env:export', id, layout),
  importEnvironment: () => invoke('env:import'),

  createSession: (req) => invoke('session:create', req),
  startSession: (envId, id) => invoke('session:start', envId, id),
  stopSession: (id) => invoke('session:stop', id),
  removeSession: (envId, id) => invoke('session:remove', envId, id),
  renameSession: (envId, id, title) => invoke('session:rename', envId, id, title),
  listSessionStates: () => invoke('session:states'),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  onData: (cb) => listen('pty:data', cb),
  onSessionStates: (cb) => listen('session:states', cb),

  listTree: (cwd) => invoke('files:tree', cwd),
  listConfigFiles: (cwd) => invoke('files:config', cwd),
  readFile: (cwd, path) => invoke('files:read', cwd, path),
  writeFile: (cwd, path, content, mtime) => invoke('files:write', cwd, path, content, mtime),
  getProtection: (cwd, path) => invoke('files:protection', cwd, path),
  denyRead: (cwd, path) => invoke('files:deny', cwd, path)
}

contextBridge.exposeInMainWorld('ide', api)
