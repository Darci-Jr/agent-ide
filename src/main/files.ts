import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ConfigFile, FileContent, ProtectionStatus, SaveResult, TreeEntry } from '../shared/types'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TREE_ENTRIES = 20_000
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', '.venv', '__pycache__'])

const toPosix = (path: string): string => path.split(sep).join('/')

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Percorre o disco em vez de usar o Git: arquivos ignorados, como .env, são
 * justamente os que o usuário precisa encontrar aqui.
 */
export async function listTree(cwd: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  const queue = ['']
  while (queue.length > 0 && entries.length < MAX_TREE_ENTRIES) {
    const dir = queue.shift()!
    const children = await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      const path = dir ? `${dir}/${child.name}` : child.name
      if (child.isDirectory()) {
        if (SKIPPED_DIRS.has(child.name)) continue
        entries.push({ path, isDir: true })
        queue.push(path)
      } else if (child.isFile()) {
        entries.push({ path, isDir: false })
      }
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

const SENSITIVE = /(^|\/)(\.env(\..*)?|.*secret.*|.*credential.*|.*\.pem|.*\.key|id_rsa|id_ed25519)$/i

export const isSensitive = (path: string): boolean => {
  const posix = toPosix(path)
  // Modelos de exemplo são feitos para ir ao repositório.
  if (/\.(example|sample|template)$/i.test(posix)) return false
  return SENSITIVE.test(posix)
}

export async function listConfigFiles(cwd: string): Promise<ConfigFile[]> {
  const fixed = [
    'CLAUDE.md',
    'CLAUDE.local.md',
    '.claude/CLAUDE.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.mcp.json',
    'AGENTS.md',
    'package.json',
    'tsconfig.json',
    'docker-compose.yml',
    'pyproject.toml'
  ]
  const root = await readdir(cwd).catch(() => [] as string[])
  const envFiles = root.filter((name) => /^\.env(\.|$)/.test(name)).sort()
  const isFile = (path: string): Promise<boolean> => stat(path).then((s) => s.isFile(), () => false)

  const project = [...envFiles, ...fixed]
  const inProject = await Promise.all(project.map((p) => isFile(join(cwd, p))))
  const home = join(homedir(), '.claude')
  const user = ['CLAUDE.md', 'settings.json', 'keybindings.json']
  const inHome = await Promise.all(user.map((p) => isFile(join(home, p))))
  return [
    ...project.filter((_, i) => inProject[i]).map((path) => ({ label: path, path })),
    ...user.filter((_, i) => inHome[i]).map((p) => ({ label: `~/.claude/${p}`, path: join(home, p) }))
  ]
}

/** Só permite tocar no projeto e em ~/.claude, mesmo se o caminho passar por um symlink. */
async function resolveAllowed(cwd: string, path: string): Promise<string> {
  const real = await realpath(resolve(cwd, path))
  const roots = await Promise.all([cwd, join(homedir(), '.claude')].map((r) => realpath(r).catch(() => r)))
  if (!roots.some((root) => isInside(root, real))) {
    throw new Error('Este arquivo está fora do projeto e não pode ser aberto aqui.')
  }
  return real
}

export async function readProjectFile(cwd: string, path: string): Promise<FileContent> {
  const real = await resolveAllowed(cwd, path)
  const { size, mtimeMs } = await stat(real)
  if (size > MAX_FILE_BYTES) throw new Error(`Arquivo grande demais (${Math.round(size / 1048576)} MB).`)
  const data = await readFile(real)
  if (data.subarray(0, 8000).includes(0)) throw new Error('Arquivo binário não pode ser exibido.')
  return { content: data.toString('utf8'), mtimeMs }
}

/** Grava em um temporário ao lado e renomeia, para uma falha nunca deixar o arquivo pela metade. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

/** Com `expectedMtimeMs` nulo, sobrescreve mesmo que o arquivo tenha mudado no disco. */
export async function writeProjectFile(
  cwd: string,
  path: string,
  content: string,
  expectedMtimeMs: number | null
): Promise<SaveResult> {
  const real = await resolveAllowed(cwd, path)
  const current = await stat(real)
  if (expectedMtimeMs !== null && current.mtimeMs !== expectedMtimeMs) return { status: 'conflict' }
  await writeAtomic(real, content)
  return { status: 'saved', mtimeMs: (await stat(real)).mtimeMs }
}

const denyRule = (rel: string): string => `Read(./${rel})`

const readSettings = async (path: string): Promise<Record<string, any> | null> => {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  return JSON.parse(text) as Record<string, any>
}

export async function getProtection(cwd: string, path: string): Promise<ProtectionStatus> {
  const sensitive = isSensitive(path)
  const rel = relative(cwd, resolve(cwd, path))
  const canDeny = !rel.startsWith('..') && !isAbsolute(rel)
  if (!canDeny) return { sensitive, denied: false, canDeny }
  const rule = denyRule(toPosix(rel))
  const files = ['settings.json', 'settings.local.json'].map((f) => join(cwd, '.claude', f))
  const all = await Promise.all(files.map((f) => readSettings(f).catch(() => null)))
  const denied = all.some((s) => Array.isArray(s?.permissions?.deny) && s.permissions.deny.includes(rule))
  return { sensitive, denied, canDeny }
}

/** Usa o arquivo local, que é pessoal, e preserva todo o resto da configuração. */
export async function denyRead(cwd: string, path: string): Promise<void> {
  const rel = relative(cwd, resolve(cwd, path))
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Só é possível bloquear arquivos do projeto.')
  const file = join(cwd, '.claude', 'settings.local.json')
  let settings: Record<string, any>
  try {
    settings = (await readSettings(file)) ?? {}
  } catch {
    throw new Error('O arquivo .claude/settings.local.json tem um erro de JSON. Corrija-o e tente de novo.')
  }
  const rule = denyRule(toPosix(rel))
  const permissions = settings.permissions ?? {}
  const deny: string[] = Array.isArray(permissions.deny) ? permissions.deny : []
  if (deny.includes(rule)) return
  settings.permissions = { ...permissions, deny: [...deny, rule] }
  await mkdir(dirname(file), { recursive: true })
  await writeAtomic(file, JSON.stringify(settings, null, 2) + '\n')
}
