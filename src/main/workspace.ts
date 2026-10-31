import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Project } from '../shared/types'

export const PROJECTS_DIR = 'Projetos'
export const ENVIRONMENTS_DIR = 'Ambientes'
export const DRAFTS_DIR = 'Temporarios'

export function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2))
  renameSync(temp, path)
}

const samePath = (a: string, b: string): boolean => {
  const clean = (p: string): string => {
    const full = resolve(p)
    return process.platform === 'win32' ? full.toLowerCase() : full
  }
  return clean(a) === clean(b)
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** O nome vira uma pasta, então não pode conter separadores nem nomes reservados. */
export function validateProjectName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('Dê um nome ao projeto.')
  if (/[<>:"/\\|?*\x00-\x1f]/.test(clean) || /^\.+$/.test(clean) || /[. ]$/.test(clean) || RESERVED.test(clean)) {
    throw new Error('Esse nome não pode ser usado em uma pasta. Evite caracteres como / \\ : * ? " < > |.')
  }
  return clean
}

/**
 * A pasta de trabalho é escolhida uma vez. O app guarda só o caminho dela; todo o
 * resto fica lá dentro, visível e fácil de copiar.
 */
export class Workspace {
  private list: Project[] = []
  dir: string | null = null

  constructor(private pointerPath: string) {
    try {
      const saved = JSON.parse(readFileSync(pointerPath, 'utf8')) as { workspaceDir?: string }
      // Uma pasta removida faz a escolha ser pedida de novo.
      if (saved.workspaceDir && existsSync(saved.workspaceDir)) this.use(saved.workspaceDir)
    } catch {
      // Primeiro uso.
    }
  }

  choose(dir: string): void {
    this.use(dir)
    writeJsonAtomic(this.pointerPath, { workspaceDir: dir })
  }

  private use(dir: string): void {
    for (const sub of [PROJECTS_DIR, ENVIRONMENTS_DIR, DRAFTS_DIR]) mkdirSync(join(dir, sub), { recursive: true })
    this.dir = dir
    try {
      this.list = JSON.parse(readFileSync(this.registryPath(), 'utf8')) as Project[]
    } catch {
      this.list = []
    }
  }

  private registryPath(): string {
    return join(this.dir!, 'projetos.json')
  }

  private save(): void {
    writeJsonAtomic(this.registryPath(), this.list)
  }

  projects(): Project[] {
    return [...this.list].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  }

  get(id: string): Project {
    const project = this.list.find((p) => p.id === id)
    if (!project) throw new Error('Projeto não encontrado.')
    return project
  }

  touch(id: string): void {
    this.get(id).lastUsedAt = Date.now()
    this.save()
  }

  createManaged(name: string): Project {
    const clean = validateProjectName(name)
    const path = join(this.dir!, PROJECTS_DIR, clean)
    if (existsSync(path)) throw new Error(`Já existe uma pasta chamada ${clean} em Projetos.`)
    mkdirSync(path)
    return this.register(path, clean, true)
  }

  addExisting(path: string): Project {
    if (!statSync(path).isDirectory()) throw new Error('Escolha uma pasta.')
    const known = this.list.find((p) => samePath(p.path, path))
    if (known) {
      this.touch(known.id)
      return known
    }
    return this.register(path, basename(path) || path, false)
  }

  /** Só tira da lista. A pasta e os arquivos do projeto continuam intactos. */
  remove(id: string): void {
    this.list = this.list.filter((p) => p.id !== id)
    this.save()
  }

  private register(path: string, name: string, managed: boolean): Project {
    const project: Project = { id: randomUUID(), name, path, managed, lastUsedAt: Date.now() }
    this.list.push(project)
    this.save()
    return project
  }
}
