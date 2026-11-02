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
  /** O processo estava rodando quando foi visto pela última vez: volta ao reabrir o ambiente. */
  shouldRun?: boolean
  /** Estava trabalhando na última gravação. Sobrevive a uma queda do app. */
  working?: boolean
  /** A IDE ou a aba foi encerrada no meio de um trabalho, e a pessoa ainda não voltou à sessão. */
  interrupted?: boolean
}

export interface SessionState {
  id: string
  running: boolean
  /** O terminal produziu saída nos últimos segundos. */
  busy: boolean
  /** Em atividade, sem contar a saída inicial de um processo recém-aberto. */
  working: boolean
  /** Quando o processo atual começou. Uma mudança de plugin depois disso ainda não vale para ele. */
  startedAt?: number
  exitCode?: number
}

/** Uma janela de limite da conta do Claude, como a linha de status do Claude Code informa. */
export interface UsageWindow {
  usedPercentage: number
  /** Em milissegundos. */
  resetsAt: number
}

/** Limites da conta lidos pela linha de status. Só existe para assinantes, depois da primeira resposta. */
export interface ClaudeUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  updatedAt: number
}

/** Estado do Git da pasta de uma sessão, mostrado no rodapé. */
export interface GitStatus {
  /** Nome da branch, ou o commit curto quando não há branch. */
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  upstream: boolean
  /** Arquivos alterados, inclusive os novos. */
  changed: number
  /** Só os já versionados: são os que uma troca de branch poderia perder. */
  tracked: number
  root: string
  /** Nome da worktree, quando a pasta é uma worktree ligada. */
  worktree: string | null
}

export interface GitWorktree {
  path: string
  name: string
  branch: string | null
  /** A pasta principal do repositório. */
  main: boolean
  /** A worktree da sessão em uso. */
  current: boolean
}

export type GitAction =
  | { kind: 'switch'; branch: string }
  | { kind: 'create'; branch: string }
  | { kind: 'fetch' }
  | { kind: 'pull' }
  | { kind: 'push' }

/** Um arquivo alterado em relação ao último commit, somando stage e não stage. */
export interface GitChange {
  /** Caminho a partir da raiz do repositório. */
  path: string
  /** Caminho antigo, quando o arquivo foi renomeado. */
  from: string | null
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  additions: number
  deletions: number
  binary: boolean
}

export interface GitChanges {
  root: string
  branch: string | null
  files: GitChange[]
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface FileDiff {
  binary: boolean
  /** Diff grande demais: só as primeiras linhas vieram. */
  truncated: boolean
  lines: DiffLine[]
}

/** Painel de alterações. Sem pasta (ambiente importado), usa a do ambiente. */
export interface DiffPanelParams {
  kind: 'diff'
  cwd: string | null
}

/** Ícones que um comando pode usar. Os desenhos ficam em `renderer/src/icons.tsx`. */
export const COMMAND_ICONS = [
  'play',
  'flask',
  'hammer',
  'bug',
  'rocket',
  'broom',
  'package',
  'database',
  'globe',
  'worktree',
  'check',
  'stop',
  'refresh',
  'upload',
  'download',
  'terminal'
] as const
export type CommandIcon = (typeof COMMAND_ICONS)[number]

/** Comando que vira botão nas abas de terminal. */
export interface CommandDraft {
  command: string
  /** Opcional: aparece na dica junto do comando. */
  name: string
  icon: CommandIcon
  /** `project` vale só para o projeto do ambiente; `global`, para todos. */
  scope: 'project' | 'global'
}

export interface CustomCommand extends CommandDraft {
  id: string
}

export interface PluginItem {
  name: string
  description: string
}

/** Plugin do Claude Code instalado, com o estado que vale para o projeto. */
export interface PluginInfo {
  /** `nome@marketplace`. */
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  enabled: boolean
  description: string
  errors: string[]
  skills: PluginItem[]
  commands: PluginItem[]
  agents: PluginItem[]
  mcpServers: string[]
  hasHooks: boolean
}

export interface PluginsPanelParams {
  kind: 'plugins'
}

/** Janela de contexto de uma sessão do Claude, como a linha de status informa. */
export interface SessionContext {
  usedPercentage: number
  /** Tamanho da janela em tokens, quando informado. */
  size: number | null
  updatedAt: number
}

/** O que aparece no rodapé da IDE. Não muda nada no terminal. */
export interface Preferences {
  showUsage: boolean
  showContext: boolean
  showGit: boolean
}

/** O que estava aberto, para a IDE voltar como estava. `activeId` nulo é a tela inicial. */
export interface OpenTabs {
  openIds: string[]
  activeId: string | null
}

export interface Project {
  id: string
  name: string
  path: string
  /** A pasta foi criada pela IDE, dentro da pasta de trabalho. */
  managed: boolean
  lastUsedAt: number
}

/** Conversa encontrada no histórico de um projeto. */
export interface HistoryEntry {
  sessionId: string
  title: string
  cwd: string
  updatedAt: number
  messages: number
}

export interface CreateEnvironmentRequest {
  projectId: string
  template: TemplateId
  /** Usa um ambiente salvo como modelo, no lugar de `template`. */
  fromEnvironmentId?: string
  /** Sessão rápida: fica em Temporarios até ser salva. */
  draft?: boolean
}

export interface Environment {
  id: string
  name: string
  projectId: string
  /** Ambiente temporário, criado por uma sessão rápida. */
  draft: boolean
  lastOpenedAt: number
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
  /** Cria a sessão em uma worktree própria. Nome nulo gera um código aleatório. */
  worktree?: { name: string | null }
  /** Abre um terminal avulso na pasta desta sessão; sem ela, na pasta do ambiente. */
  terminalOfSessionId?: string
  /** Abre o terminal nesta worktree do repositório do ambiente. */
  terminalInWorktree?: string
  /** Id de um comando salvo do projeto: o terminal novo o executa assim que o prompt aparece. */
  runCommandId?: string
}

export interface CreateSessionResult {
  session: SessionSpec
  /** Arquivos ignorados pelo Git, como .env, que não foram para a worktree. */
  missingInWorktree: string[]
}

export interface IdeApi {
  listAdapters(): Promise<AdapterInfo[]>
  getWorkspace(): Promise<string | null>
  chooseWorkspace(): Promise<string | null>
  openWorkspaceFolder(): Promise<void>
  openProjectFolder(projectId: string): Promise<void>

  listProjects(): Promise<Project[]>
  createProject(name: string): Promise<Project>
  addExistingProject(): Promise<Project | null>
  removeProject(id: string): Promise<void>
  listHistory(projectId: string): Promise<HistoryEntry[]>
  openFromHistory(projectId: string, entry: HistoryEntry): Promise<Environment>

  listEnvironments(): Promise<Environment[]>
  createEnvironment(req: CreateEnvironmentRequest): Promise<Environment>
  markEnvironmentOpened(id: string): Promise<void>
  /** Devolve o ambiente atualizado, com as sessões que estavam rodando já retomadas. */
  resumeEnvironment(id: string): Promise<Environment>
  getOpenTabs(): Promise<OpenTabs>
  saveOpenTabs(tabs: OpenTabs): void
  saveEnvironment(id: string, name: string): Promise<Environment>
  /** Fecha a aba e encerra as sessões; o ambiente continua salvo. */
  closeEnvironment(id: string): Promise<void>
  deleteEnvironment(id: string): Promise<void>
  saveLayout(id: string, layout: unknown): void
  exportEnvironment(id: string, layout: unknown): Promise<boolean>
  importEnvironment(projectId: string): Promise<Environment | null>

  createSession(req: CreateSessionRequest): Promise<CreateSessionResult>
  startSession(environmentId: string, sessionId: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  removeSession(environmentId: string, sessionId: string): Promise<void>
  renameSession(environmentId: string, sessionId: string, title: string): Promise<void>
  /** Tira o aviso de atenção da sessão. */
  acknowledgeSession(environmentId: string, sessionId: string): Promise<void>
  listSessionStates(): Promise<SessionState[]>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  onData(cb: (sessionId: string, data: string) => void): () => void
  onSessionStates(cb: (states: SessionState[]) => void): () => void

  getUsage(): Promise<ClaudeUsage | null>
  onUsage(cb: (usage: ClaudeUsage | null) => void): () => void
  getContext(sessionId: string): Promise<SessionContext | null>
  onContext(cb: (sessionId: string, context: SessionContext | null) => void): () => void
  gitStatus(cwd: string): Promise<GitStatus | null>
  gitBranches(cwd: string): Promise<string[]>
  gitWorktrees(cwd: string): Promise<GitWorktree[]>
  /** Devolve uma mensagem curta de sucesso. */
  gitAction(cwd: string, action: GitAction): Promise<string>
  removeWorktree(cwd: string, path: string): Promise<void>
  openWorktreeFolder(cwd: string, path: string): Promise<void>
  /** Alterações da pasta em relação ao último commit. Nulo se não for um repositório. */
  gitChanges(cwd: string): Promise<GitChanges | null>
  /** Só aceita um arquivo da lista de alterações. */
  gitFileDiff(cwd: string, path: string): Promise<FileDiff>
  /** Alguma ação de Git terminou: o rodapé relê o estado. */
  onGitChanged(cb: () => void): () => void
  /** Gerais e do projeto, nessa ordem. */
  listCommands(projectId: string): Promise<CustomCommand[]>
  saveCommand(projectId: string, draft: CommandDraft, id?: string): Promise<CustomCommand>
  deleteCommand(projectId: string, id: string): Promise<void>
  onCommandsChanged(cb: () => void): () => void
  listPlugins(cwd: string): Promise<PluginInfo[]>
  setPluginEnabled(cwd: string, id: string, enabled: boolean): Promise<void>
  getPreferences(): Promise<Preferences>
  savePreferences(prefs: Preferences): Promise<void>

  listTree(cwd: string): Promise<TreeEntry[]>
  listConfigFiles(cwd: string): Promise<ConfigFile[]>
  readFile(cwd: string, path: string): Promise<FileContent>
  writeFile(cwd: string, path: string, content: string, expectedMtimeMs: number | null): Promise<SaveResult>
  getProtection(cwd: string, path: string): Promise<ProtectionStatus>
  denyRead(cwd: string, path: string): Promise<void>
}
