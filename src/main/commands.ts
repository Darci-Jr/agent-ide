import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { COMMAND_ICONS, type CommandDraft, type CustomCommand } from '../shared/types'
import { writeJsonAtomic } from './workspace'

function readList(path: string): CustomCommand[] {
  try {
    const list = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return Array.isArray(list) ? (list as CustomCommand[]) : []
  } catch {
    return []
  }
}

/** Um comando é uma linha só: uma quebra executaria outro comando escondido. */
export function cleanDraft(draft: CommandDraft): CommandDraft {
  const command = String(draft.command ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (!command) throw new Error('Informe o comando.')
  if (command.length > 500) throw new Error('O comando passa de 500 caracteres.')
  if (!COMMAND_ICONS.includes(draft.icon)) throw new Error('Escolha um ícone.')
  if (draft.scope !== 'global' && draft.scope !== 'project') throw new Error('Escolha onde o comando vale.')
  return { command, name: String(draft.name ?? '').trim().slice(0, 40), icon: draft.icon, scope: draft.scope }
}

/**
 * Comandos gerais ficam no perfil do app; os de projeto, na pasta de trabalho, por id de projeto.
 * Nenhum fica no repositório, para um projeto baixado não trazer comandos prontos para executar.
 */
export class CommandStore {
  constructor(
    private globalPath: string,
    private projectPath: () => string | null
  ) {}

  private projectMap(): Record<string, CustomCommand[]> {
    const path = this.projectPath()
    if (!path) return {}
    try {
      const map = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, CustomCommand[]>) : {}
    } catch {
      return {}
    }
  }

  list(projectId: string): CustomCommand[] {
    return [...readList(this.globalPath), ...(this.projectMap()[projectId] ?? [])]
  }

  /** Cria, ou substitui quando o id já existe. Trocar o escopo move o comando de arquivo. */
  save(projectId: string, draft: CommandDraft, id?: string): CustomCommand {
    const clean = cleanDraft(draft)
    this.remove(projectId, id)
    const command: CustomCommand = { ...clean, id: id ?? randomUUID() }
    if (clean.scope === 'global') {
      writeJsonAtomic(this.globalPath, [...readList(this.globalPath), command])
    } else {
      const path = this.requireProjectPath()
      const map = this.projectMap()
      map[projectId] = [...(map[projectId] ?? []), command]
      writeJsonAtomic(path, map)
    }
    return command
  }

  remove(projectId: string, id: string | undefined): void {
    if (!id) return
    const global = readList(this.globalPath)
    if (global.some((c) => c.id === id)) writeJsonAtomic(this.globalPath, global.filter((c) => c.id !== id))
    const map = this.projectMap()
    if (map[projectId]?.some((c) => c.id === id)) {
      map[projectId] = map[projectId]!.filter((c) => c.id !== id)
      writeJsonAtomic(this.requireProjectPath(), map)
    }
  }

  private requireProjectPath(): string {
    const path = this.projectPath()
    if (!path) throw new Error('Escolha a pasta de trabalho primeiro.')
    return path
  }
}
