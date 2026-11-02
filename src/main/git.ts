import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, relative, resolve, isAbsolute } from 'node:path'
import type { DiffLine, FileDiff, GitAction, GitChange, GitChanges, GitStatus, GitWorktree } from '../shared/types'
import { childEnv } from './childEnv'

function git(cwd: string, args: string[], timeout = 15000): Promise<string> {
  // Sem terminal para pedir senha: um fetch ou push travaria esperando resposta.
  const env = { ...childEnv(process.env), GIT_TERMINAL_PROMPT: '0' }
  return new Promise((ok, fail) => {
    execFile('git', ['-C', cwd, ...args], { env, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) fail(new Error(stderr.trim() || err.message))
      else ok(stdout)
    })
  })
}

const samePath = (a: string, b: string): boolean => {
  const clean = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  return clean(a) === clean(b)
}

/** Lê `git status --porcelain=v2 --branch`. Exportado para os testes. */
export function parseStatus(text: string): Pick<GitStatus, 'branch' | 'detached' | 'ahead' | 'behind' | 'upstream' | 'changed' | 'tracked'> {
  let branch: string | null = null
  let oid = ''
  let ahead = 0
  let behind = 0
  let upstream = false
  let changed = 0
  let tracked = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length)
    else if (line.startsWith('# branch.upstream ')) upstream = true
    else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice('# branch.ab '.length).split(' ')
      ahead = Math.abs(Number(a))
      behind = Math.abs(Number(b))
    } else if (/^[12u] /.test(line)) {
      changed++
      tracked++
    } else if (line.startsWith('? ')) changed++
  }
  const detached = branch === '(detached)'
  return { branch: detached ? oid.slice(0, 7) : branch, detached, ahead, behind, upstream, changed, tracked }
}

/** Estado do repositório da pasta, ou nulo quando ela não é um repositório. */
export async function gitStatus(cwd: string): Promise<GitStatus | null> {
  let root: string
  let gitDir: string
  let commonDir: string
  try {
    ;[root = '', gitDir = '', commonDir = ''] = (await git(cwd, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'])).trim().split(/\r?\n/)
  } catch {
    return null
  }
  const parsed = parseStatus(await git(cwd, ['status', '--porcelain=v2', '--branch']))
  // Numa worktree ligada, a pasta do Git é própria e a comum fica no repositório principal.
  const linked = !samePath(gitDir, resolve(cwd, commonDir))
  return { ...parsed, root, worktree: linked ? basename(root) : null }
}

export async function listBranches(cwd: string): Promise<string[]> {
  return (await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split(/\r?\n/).filter(Boolean)
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const status = await gitStatus(cwd)
  if (!status) return []
  const blocks = (await git(cwd, ['worktree', 'list', '--porcelain'])).split(/\r?\n\r?\n/).filter((b) => b.trim())
  return blocks.map((block, i) => {
    const path = /^worktree (.*)$/m.exec(block)?.[1] ?? ''
    const branch = /^branch refs\/heads\/(.*)$/m.exec(block)?.[1] ?? null
    return { path, name: basename(path), branch, main: i === 0, current: samePath(path, status.root) }
  })
}

/** Só caminhos que o próprio Git lista como worktrees deste repositório. */
export async function requireWorktree(cwd: string, path: string): Promise<GitWorktree> {
  const found = (await listWorktrees(cwd)).find((w) => samePath(w.path, path))
  if (!found) throw new Error('Esta pasta não é uma worktree deste repositório.')
  return found
}

async function validBranchName(cwd: string, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean || clean.startsWith('-')) throw new Error('Dê um nome à branch.')
  try {
    return (await git(cwd, ['check-ref-format', '--branch', clean])).trim()
  } catch {
    throw new Error(`"${clean}" não é um nome de branch válido.`)
  }
}

/** Ações do menu Git. Nenhuma força nada: o Git recusa o que perderia trabalho. */
export async function runGitAction(cwd: string, action: GitAction): Promise<string> {
  const status = await gitStatus(cwd)
  if (!status) throw new Error('Esta pasta não é um repositório Git.')
  switch (action.kind) {
    case 'switch': {
      if (status.tracked > 0) throw new Error('Há alterações não commitadas. Faça commit ou guarde-as antes de trocar de branch.')
      const branches = await listBranches(cwd)
      if (!branches.includes(action.branch)) throw new Error('Branch não encontrada.')
      await git(cwd, ['switch', action.branch])
      return `Agora em ${action.branch}.`
    }
    case 'create': {
      const name = await validBranchName(cwd, action.branch)
      await git(cwd, ['switch', '-c', name])
      return `Branch ${name} criada.`
    }
    case 'fetch':
      await git(cwd, ['fetch', '--prune'], 60000)
      return 'Busca concluída.'
    case 'pull':
      await git(cwd, ['pull', '--ff-only'], 60000)
      return 'Branch atualizada.'
    case 'push': {
      if (status.detached || !status.branch) throw new Error('Não há branch para enviar.')
      await git(cwd, status.upstream ? ['push'] : ['push', '--set-upstream', 'origin', status.branch], 60000)
      return 'Enviado.'
    }
  }
}

/** Sem `--force`: o Git recusa uma worktree com alterações. A branch continua existindo. */
export async function removeWorktree(cwd: string, path: string): Promise<void> {
  const worktree = await requireWorktree(cwd, path)
  if (worktree.main) throw new Error('A pasta principal do repositório não pode ser removida.')
  const main = (await listWorktrees(cwd)).find((w) => w.main)!
  await git(main.path, ['worktree', 'remove', worktree.path])
}

/** Árvore vazia do Git: base de comparação num repositório ainda sem commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Acima disso o diff aparece cortado, para o painel não travar. */
const MAX_DIFF_LINES = 5000
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

async function diffBase(root: string): Promise<string> {
  try {
    await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
    return 'HEAD'
  } catch {
    return EMPTY_TREE
  }
}

const STATUS_BY_LETTER: Record<string, GitChange['status']> = { A: 'added', D: 'deleted', R: 'renamed', C: 'added' }

/** Lê `--name-status -z` e `--numstat -z` do mesmo diff. Exportado para os testes. */
export function parseChanges(nameStatus: string, numstat: string): GitChange[] {
  const files = new Map<string, GitChange>()
  const ns = nameStatus.split('\0')
  for (let i = 0; i < ns.length - 1; ) {
    const letter = (ns[i++] ?? '').charAt(0)
    const from = letter === 'R' || letter === 'C' ? (ns[i++] ?? null) : null
    const path = ns[i++] ?? ''
    files.set(path, { path, from: letter === 'R' ? from : null, status: STATUS_BY_LETTER[letter] ?? 'modified', additions: 0, deletions: 0, binary: false })
  }
  const nums = numstat.split('\0')
  for (let i = 0; i < nums.length - 1; ) {
    const [add = '', del = '', inline = ''] = (nums[i++] ?? '').split('\t')
    // Renomeado: o caminho vem vazio na linha e os dois nomes nos campos seguintes.
    let path = inline
    if (!inline) {
      i++
      path = nums[i++] ?? ''
    }
    const file = files.get(path)
    if (!file) continue
    file.binary = add === '-'
    file.additions = Number(add) || 0
    file.deletions = Number(del) || 0
  }
  return [...files.values()]
}

const isBinary = (data: Buffer): boolean => data.subarray(0, 8000).includes(0)

/** Alterações em relação ao último commit, com stage e sem stage juntos, mais os arquivos novos. */
export async function gitChanges(cwd: string): Promise<GitChanges | null> {
  const status = await gitStatus(cwd)
  if (!status) return null
  const root = status.root
  const base = await diffBase(root)
  const [nameStatus, numstat, untracked] = await Promise.all([
    git(root, ['diff', base, '-M', '--name-status', '-z', '--no-ext-diff']),
    git(root, ['diff', base, '-M', '--numstat', '-z', '--no-ext-diff']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--full-name'])
  ])
  const files = parseChanges(nameStatus, numstat)
  for (const path of untracked.split('\0').filter(Boolean)) {
    const file: GitChange = { path, from: null, status: 'untracked', additions: 0, deletions: 0, binary: false }
    try {
      const data = await readFile(resolve(root, path))
      file.binary = isBinary(data)
      const text = data.toString('utf8').replace(/\r?\n$/, '')
      if (!file.binary && text) file.additions = text.split(/\r?\n/).length
    } catch {
      // Apagado entre a listagem e a leitura: aparece sem contagem.
    }
    files.push(file)
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { root, branch: status.branch, files }
}

/** Lê um diff unificado. Exportado para os testes. */
export function parseDiff(text: string, max = MAX_DIFF_LINES): FileDiff {
  const lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!inHunk && /^Binary files /.test(line)) return { binary: true, truncated: false, lines: [] }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (hunk) {
      inHunk = true
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      if (lines.length >= max) return { binary: false, truncated: true, lines }
      lines.push({ type: 'hunk', oldNo: null, newNo: null, text: line })
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    if (lines.length >= max) return { binary: false, truncated: true, lines }
    const mark = line[0]
    const body = line.slice(1)
    if (mark === '+') lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: body })
    else if (mark === '-') lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: body })
    else if (mark === ' ') lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: body })
  }
  return { binary: false, truncated: false, lines }
}

/** Diff de um arquivo da lista de alterações; qualquer outro caminho é recusado. */
export async function fileDiff(cwd: string, path: string): Promise<FileDiff> {
  const changes = await gitChanges(cwd)
  const change = changes?.files.find((f) => f.path === path)
  if (!changes || !change) throw new Error('Este arquivo não está mais entre as alterações.')
  if (change.binary) return { binary: true, truncated: false, lines: [] }
  if (change.status === 'untracked') {
    const full = resolve(changes.root, change.path)
    const rel = relative(changes.root, full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Arquivo fora do repositório.')
    const data = await readFile(full)
    if (isBinary(data)) return { binary: true, truncated: false, lines: [] }
    const text = data.subarray(0, MAX_UNTRACKED_BYTES).toString('utf8').replace(/\r?\n$/, '')
    const all = text ? text.split(/\r?\n/) : []
    const lines: DiffLine[] = all.slice(0, MAX_DIFF_LINES).map((t, i) => ({ type: 'add', oldNo: null, newNo: i + 1, text: t }))
    return { binary: false, truncated: all.length > MAX_DIFF_LINES || data.length > MAX_UNTRACKED_BYTES, lines }
  }
  const paths = change.from ? [change.from, change.path] : [change.path]
  const base = await diffBase(changes.root)
  return parseDiff(await git(changes.root, ['diff', base, '-M', '--no-color', '--no-ext-diff', '--', ...paths]))
}
