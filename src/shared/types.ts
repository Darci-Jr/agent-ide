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
  /** Projeto da sessão. Sem ele, o projeto principal do ambiente. */
  projectId?: string
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
  /**
   * Conversa do agente que está na sessão agora. Muda com /clear ou /resume; sem ele, vale o `id`.
   * Não vai para templates.
   */
  conversationId?: string
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

/** Tokens da conversa inteira, somados do transcript. */
export interface TokenTotals {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  total: number
  responses: number
}

/** Atualização do app instalado. `disabled` em desenvolvimento e nos testes. */
export interface UpdateState {
  /** Versão em uso. */
  version: string
  /** `available`: versão nova que precisa ser baixada à mão (Mac sem assinatura). */
  status: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'
  /** Versão nova encontrada ou já baixada. */
  available?: string
  percent?: number
  checkedAt?: number
  error?: string
}

/** Cache do prompt da conversa: cada resposta renova o prazo. */
export interface CacheInfo {
  /** Última resposta que leu ou criou cache. */
  lastAt: number
  /** 5 minutos ou 1 hora. */
  ttlMs: number
  expiresAt: number
}

/** O que aparece no rodapé da IDE. Não muda nada no terminal. */
export interface Preferences {
  showUsage: boolean
  showContext: boolean
  showCache: boolean
  showTokens: boolean
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
  /** Id da conversa no Claude Code. */
  sessionId: string
  title: string
  cwd: string
  updatedAt: number
  messages: number
  /** Sessão de um ambiente que está com esta conversa agora. */
  holder?: { environmentId: string; sessionId: string }
}

/** Sessão rápida: um ambiente com uma sessão no projeto. */
export interface CreateEnvironmentRequest {
  projectId: string
}

/** Quantas sessões de cada tipo abrir em um projeto. */
export interface SessionGroup {
  projectId: string
  claude: number
  terminals: number
}

/** Limite por projeto, para não abrir dezenas de processos por engano. */
export const MAX_SESSIONS_PER_PROJECT = 8

/** Uma sessão do molde. O layout do template se refere a ela pelo `slot`. */
export interface TemplateSlot {
  slot: string
  projectId: string
  adapterId: string
  title: string
}

/** Molde de ambiente: projetos, sessões e layout, sem conversas. Não aparece nas abas. */
export interface Template {
  id: string
  name: string
  slots: TemplateSlot[]
  /** Layout com `slot` no lugar dos ids de sessão; nulo arruma as sessões em grade. */
  layout: unknown | null
  updatedAt: number
}

export interface TemplateDraft {
  name: string
  groups: SessionGroup[]
}

/** Novo ambiente: cada grupo vira sessões já iniciadas. Com template e os mesmos grupos, usa o layout dele. */
export interface NewEnvironmentRequest {
  groups: SessionGroup[]
  templateId?: string
}

export interface Environment {
  id: string
  name: string
  /** Projeto principal. As sessões podem ser de outros projetos (`SessionSpec.projectId`). */
  projectId: string
  /** Formato antigo: os temporários são apagados ao carregar. */
  draft?: boolean
  lastOpenedAt: number
  cwd: string
  sessions: SessionSpec[]
  /** Layout serializado pelo dockview; opaco para o processo principal. */
  layout: unknown | null
  /** Quando a aba foi fechada pela última vez; ordena o histórico de ambientes. */
  closedAt?: number
  /** Fixado: a aba fica no grupo da esquerda, inclusive ao reabrir. Não vai para o template. */
  pinned?: boolean
}

/** Parâmetros dos painéis que não são terminais. O caminho é relativo ao projeto, se possível. */
export interface FilePanelParams {
  kind: 'editor' | 'markdown'
  path: string | null
  /** Pasta do projeto do arquivo, num ambiente com vários projetos. Sem ela, a do ambiente. */
  root?: string | null
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
  /** Projeto da nova sessão: o da sessão em uso. Sem ele, o principal do ambiente. */
  projectId?: string
  /** Cria a sessão em uma worktree própria. Nome nulo gera um código aleatório. */
  worktree?: { name: string | null }
  /** Abre um terminal avulso na pasta desta sessão; sem ela, na pasta do ambiente. */
  terminalOfSessionId?: string
  /** Abre a sessão (terminal ou Claude) nesta worktree do repositório do projeto. */
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
  /** Cria `<parent>/<name>`; sem `parent`, pergunta onde. Nulo se a pessoa cancelar. */
  createProject(name: string, parent?: string): Promise<Project | null>
  /** Seletor de pasta para escolher onde criar um projeto; abre no último lugar usado. */
  pickProjectParent(): Promise<string | null>
  addExistingProject(): Promise<Project | null>
  removeProject(id: string): Promise<void>
  listHistory(projectId: string): Promise<HistoryEntry[]>
  openFromHistory(projectId: string, entry: HistoryEntry): Promise<Environment>

  listEnvironments(): Promise<Environment[]>
  createEnvironment(req: CreateEnvironmentRequest): Promise<Environment>
  newEnvironment(req: NewEnvironmentRequest): Promise<Environment>
  renameEnvironment(id: string, name: string): Promise<void>
  markEnvironmentOpened(id: string): Promise<void>
  /** Devolve o ambiente atualizado, com as sessões que estavam rodando já retomadas. */
  resumeEnvironment(id: string): Promise<Environment>
  getOpenTabs(): Promise<OpenTabs>
  saveOpenTabs(tabs: OpenTabs): void
  /** Fecha a aba e encerra as sessões; o ambiente continua salvo. */
  closeEnvironment(id: string): Promise<void>
  pinEnvironment(id: string, pinned: boolean): Promise<void>
  deleteEnvironment(id: string): Promise<void>
  saveLayout(id: string, layout: unknown): void

  listTemplates(): Promise<Template[]>
  saveTemplate(draft: TemplateDraft, id?: string): Promise<Template>
  /** Copia projetos, sessões e layout do ambiente, sem as conversas. */
  saveTemplateFromEnvironment(environmentId: string, name: string, layout: unknown): Promise<Template>
  deleteTemplate(id: string): Promise<void>
  exportTemplate(id: string): Promise<boolean>
  /** Projetos do arquivo são procurados pelo nome; os que faltam, a pessoa aponta a pasta. */
  importTemplate(): Promise<Template | null>

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
  /** Lido do transcript da sessão do Claude; nulo antes da primeira resposta. */
  getCache(sessionId: string): Promise<CacheInfo | null>
  /** Somados do transcript; nulo antes da primeira resposta. */
  getTokens(sessionId: string): Promise<TokenTotals | null>
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

  getUpdate(): Promise<UpdateState>
  checkUpdate(): Promise<UpdateState>
  /** Reinicia na versão já baixada; no Mac, abre a página para baixar a nova. */
  installUpdate(): Promise<void>
  onUpdate(cb: (state: UpdateState) => void): () => void
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
