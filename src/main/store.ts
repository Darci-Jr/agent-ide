import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Environment } from '../shared/types'

/** Ambientes ficam na pasta do app, fora dos repositórios. */
export class EnvironmentStore {
  private environments: Environment[] = []
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private path: string) {
    try {
      this.environments = JSON.parse(readFileSync(path, 'utf8')) as Environment[]
    } catch {
      // Primeira execução: ainda não há arquivo.
    }
  }

  all = (): Environment[] => this.environments

  get(id: string): Environment {
    const env = this.environments.find((e) => e.id === id)
    if (!env) throw new Error(`Ambiente não encontrado: ${id}`)
    return env
  }

  add(env: Environment): void {
    this.environments.push(env)
    this.flush()
  }

  remove(id: string): void {
    this.environments = this.environments.filter((e) => e.id !== id)
    this.flush()
  }

  /** O layout muda a cada arraste; agrupa as gravações. */
  saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(this.environments, null, 2))
    renameSync(temp, this.path)
  }
}
