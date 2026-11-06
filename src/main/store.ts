import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Environment } from '../shared/types'
import { DRAFTS_DIR, ENVIRONMENTS_DIR, writeJsonAtomic } from './workspace'

const slug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'ambiente'

/** O processo vai embora no meio do trabalho: a sessão passa a pedir atenção. */
export function markInterrupted(env: Environment): void {
  for (const session of env.sessions) {
    if (!session.working) continue
    session.working = false
    session.interrupted = true
  }
}

/**
 * Ambientes temporários não existem mais: os de versões anteriores são apagados.
 * As conversas continuam no histórico de cada projeto.
 */
function removeOldDrafts(workspaceDir: string): void {
  const dir = join(workspaceDir, DRAFTS_DIR)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) if (name.endsWith('.json')) rmSync(join(dir, name), { force: true })
  try {
    rmdirSync(dir)
  } catch {
    // Sobrou algo que não é da IDE: a pasta fica.
  }
}

/** Cada ambiente é um arquivo em Ambientes, para dar para vê-los, copiá-los e fazer backup. */
export class EnvironmentStore {
  private environments: Environment[] = []
  private written = new Map<string, { path: string; text: string }>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private workspaceDir: string) {
    removeOldDrafts(workspaceDir)
    {
      const dir = join(workspaceDir, ENVIRONMENTS_DIR)
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue
        const path = join(dir, name)
        try {
          const text = readFileSync(path, 'utf8')
          const env = JSON.parse(text) as Environment
          if (env.draft) {
            rmSync(path, { force: true })
            continue
          }
          delete env.draft
          this.environments.push(env)
          this.written.set(env.id, { path, text: JSON.stringify(env, null, 2) })
          // Ao carregar, nenhum processo sobrevive: quem trabalhava foi interrompido.
          markInterrupted(env)
        } catch {
          // Um arquivo danificado não impede o uso dos demais.
          console.error(`Ambiente ignorado: ${path}`)
        }
      }
    }
  }

  all = (): Environment[] => this.environments

  get(id: string): Environment {
    const env = this.environments.find((e) => e.id === id)
    if (!env) throw new Error('Ambiente não encontrado.')
    return env
  }

  add(env: Environment): void {
    this.environments.push(env)
    this.flush()
  }

  remove(id: string): void {
    this.environments = this.environments.filter((e) => e.id !== id)
    const written = this.written.get(id)
    if (written) rmSync(written.path, { force: true })
    this.written.delete(id)
  }

  /** O layout muda a cada arraste; agrupa as gravações. */
  saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  private pathFor(env: Environment): string {
    const dir = join(this.workspaceDir, ENVIRONMENTS_DIR)
    return join(dir, `${slug(env.name)}-${env.id.slice(0, 8)}.json`)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    for (const env of this.environments) {
      const text = JSON.stringify(env, null, 2)
      const path = this.pathFor(env)
      const previous = this.written.get(env.id)
      if (previous?.path === path && previous.text === text) continue
      writeJsonAtomic(path, env)
      // Ao renomear, o arquivo muda de nome.
      if (previous && previous.path !== path) rmSync(previous.path, { force: true })
      this.written.set(env.id, { path, text })
    }
  }
}
