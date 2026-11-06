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
  getWorkspace: () => invoke('workspace:get'),
  chooseWorkspace: () => invoke('workspace:choose'),
  openWorkspaceFolder: () => invoke('workspace:open'),
  openProjectFolder: (id) => invoke('project:open', id),

  listProjects: () => invoke('project:list'),
  createProject: (name, parent) => invoke('project:create', name, parent),
  pickProjectParent: () => invoke('project:pick-parent'),
  addExistingProject: () => invoke('project:add'),
  removeProject: (id) => invoke('project:remove', id),
  listHistory: (id) => invoke('history:list', id),
  openFromHistory: (id, entry) => invoke('history:open', id, entry),

  listEnvironments: () => invoke('env:list'),
  createEnvironment: (req) => invoke('env:create', req),
  newEnvironment: (req) => invoke('env:new', req),
  renameEnvironment: (id, name) => invoke('env:rename', id, name),
  markEnvironmentOpened: (id) => invoke('env:opened', id),
  resumeEnvironment: (id) => invoke('env:resume', id),
  getOpenTabs: () => invoke('tabs:get'),
  saveOpenTabs: (tabs) => ipcRenderer.send('tabs:save', tabs),
  closeEnvironment: (id) => invoke('env:close', id),
  pinEnvironment: (id, pinned) => invoke('env:pin', id, pinned),
  deleteEnvironment: (id) => invoke('env:delete', id),
  saveLayout: (id, layout) => ipcRenderer.send('env:layout', id, layout),

  listTemplates: () => invoke('template:list'),
  saveTemplate: (draft, id) => invoke('template:save', draft, id),
  saveTemplateFromEnvironment: (envId, name, layout) => invoke('template:from-env', envId, name, layout),
  deleteTemplate: (id) => invoke('template:delete', id),
  exportTemplate: (id) => invoke('template:export', id),
  importTemplate: () => invoke('template:import'),

  createSession: (req) => invoke('session:create', req),
  startSession: (envId, id) => invoke('session:start', envId, id),
  stopSession: (id) => invoke('session:stop', id),
  removeSession: (envId, id) => invoke('session:remove', envId, id),
  renameSession: (envId, id, title) => invoke('session:rename', envId, id, title),
  acknowledgeSession: (envId, id) => invoke('session:acknowledge', envId, id),
  listSessionStates: () => invoke('session:states'),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  onData: (cb) => listen('pty:data', cb),
  onSessionStates: (cb) => listen('session:states', cb),

  getUsage: () => invoke('usage:get'),
  onUsage: (cb) => listen('usage:changed', cb),
  getContext: (id) => invoke('context:get', id),
  getCache: (id) => invoke('cache:get', id),
  onContext: (cb) => listen('context:changed', cb),
  gitStatus: (cwd) => invoke('git:status', cwd),
  gitBranches: (cwd) => invoke('git:branches', cwd),
  gitWorktrees: (cwd) => invoke('git:worktrees', cwd),
  gitAction: (cwd, action) => invoke('git:action', cwd, action),
  removeWorktree: (cwd, path) => invoke('git:remove-worktree', cwd, path),
  openWorktreeFolder: (cwd, path) => invoke('git:open-folder', cwd, path),
  gitChanges: (cwd) => invoke('git:changes', cwd),
  gitFileDiff: (cwd, path) => invoke('git:file-diff', cwd, path),
  onGitChanged: (cb) => listen('git:changed', cb),
  listCommands: (projectId) => invoke('commands:list', projectId),
  saveCommand: (projectId, draft, id) => invoke('commands:save', projectId, draft, id),
  deleteCommand: (projectId, id) => invoke('commands:delete', projectId, id),
  onCommandsChanged: (cb) => listen('commands:changed', cb),
  listPlugins: (cwd) => invoke('plugins:list', cwd),
  setPluginEnabled: (cwd, id, enabled) => invoke('plugins:set', cwd, id, enabled),
  getPreferences: () => invoke('prefs:get'),
  savePreferences: (prefs) => invoke('prefs:save', prefs),

  listTree: (cwd) => invoke('files:tree', cwd),
  listConfigFiles: (cwd) => invoke('files:config', cwd),
  readFile: (cwd, path) => invoke('files:read', cwd, path),
  writeFile: (cwd, path, content, mtime) => invoke('files:write', cwd, path, content, mtime),
  getProtection: (cwd, path) => invoke('files:protection', cwd, path),
  denyRead: (cwd, path) => invoke('files:deny', cwd, path)
}

contextBridge.exposeInMainWorld('ide', api)
