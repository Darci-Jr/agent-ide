export type TemplateId = 'multi' | 'think' | 'blank'

export interface AdapterInfo {
  id: string
  label: string
  available: boolean
}

/** O que precisa sobreviver a um reinício do app. */
export interface SessionSpec {
  id: string
  adapterId: string
  title: string
  cwd: string
  /** Branch criada para a sessão, quando ela roda em uma worktree. */
  worktreeBranch?: string
  /** O agente já foi iniciado alguma vez; decide entre iniciar e retomar. */
  started: boolean
}

export interface SessionState {
  id: string
  running: boolean
  /** O terminal produziu saída nos últimos segundos. */
  busy: boolean
  exitCode?: number
}

export interface Environment {
  id: string
  name: string
  cwd: string
  template: TemplateId
  sessions: SessionSpec[]
  /** Layout serializado pelo dockview; opaco para o processo principal. */
  layout: unknown | null
}

/** Parâmetros dos painéis que não são terminais. O caminho é relativo ao projeto, se possível. */
export interface FilePanelParams {
  kind: 'editor' | 'markdown'
  path: string | null
}

export interface TerminalPanelParams {
  kind: 'terminal'
  sessionId: string
}

export interface TreeEntry {
  /** Relativo ao projeto, com `/`. */
  path: string
  isDir: boolean
}

export interface ConfigFile {
  label: string
  /** Relativo ao projeto, ou absoluto quando está em ~/.claude. */
  path: string
}

export interface FileContent {
  content: string
  mtimeMs: number
}

export type SaveResult = { status: 'saved'; mtimeMs: number } | { status: 'conflict' }

export interface ProtectionStatus {
  sensitive: boolean
  /** Existe uma regra de deny de leitura para o arquivo. */
  denied: boolean
  /** Arquivos fora do projeto não têm como receber a regra. */
  canDeny: boolean
}

export interface CreateSessionRequest {
  environmentId: string
  adapterId: string
  worktree: boolean
}

export interface CreateSessionResult {
  session: SessionSpec
  /** Arquivos ignorados pelo Git, como .env, que não foram para a worktree. */
  missingInWorktree: string[]
}

export interface IdeApi {
  listAdapters(): Promise<AdapterInfo[]>
  listEnvironments(): Promise<Environment[]>
  createEnvironment(template: TemplateId): Promise<Environment | null>
  deleteEnvironment(id: string): Promise<void>
  saveLayout(id: string, layout: unknown): void
  exportEnvironment(id: string, layout: unknown): Promise<boolean>
  importEnvironment(): Promise<Environment | null>

  createSession(req: CreateSessionRequest): Promise<CreateSessionResult>
  startSession(environmentId: string, sessionId: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  removeSession(environmentId: string, sessionId: string): Promise<void>
  renameSession(environmentId: string, sessionId: string, title: string): Promise<void>
  listSessionStates(): Promise<SessionState[]>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  onData(cb: (sessionId: string, data: string) => void): () => void
  onSessionStates(cb: (states: SessionState[]) => void): () => void

  listTree(cwd: string): Promise<TreeEntry[]>
  listConfigFiles(cwd: string): Promise<ConfigFile[]>
  readFile(cwd: string, path: string): Promise<FileContent>
  writeFile(cwd: string, path: string, content: string, expectedMtimeMs: number | null): Promise<SaveResult>
  getProtection(cwd: string, path: string): Promise<ProtectionStatus>
  denyRead(cwd: string, path: string): Promise<void>
}
