import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_SESSIONS_PER_PROJECT, type Environment, type SessionGroup, type SessionSpec, type Template, type TemplateSlot } from '../shared/types'
import { hasParentSegment, isAbsoluteAnywhere, templateLayout } from './exchange'
import { writeJsonAtomic } from './workspace'

export const TEMPLATES_DIR = 'Templates'
const FORMAT = 'agent-ide-template'
const FORMAT_VERSION = 1
const PANEL_COMPONENTS = new Set(['terminal', 'editor', 'markdown', 'plugins', 'diff'])

const slug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'template'

/** Valida quantidades e projetos repetidos; o renderer não é confiável para limites. */
export function cleanGroups(groups: SessionGroup[], knownProjects: string[]): SessionGroup[] {
  if (!Array.isArray(groups) || groups.length === 0) throw new Error('Escolha ao menos um projeto.')
  const seen = new Set<string>()
  const clean = groups.map((g) => {
    if (!knownProjects.includes(g?.projectId)) throw new Error('Projeto não encontrado.')
    if (seen.has(g.projectId)) throw new Error('O mesmo projeto aparece duas vezes.')
    seen.add(g.projectId)
    const count = (n: unknown): number => Math.max(0, Math.min(MAX_SESSIONS_PER_PROJECT, Math.floor(Number(n) || 0)))
    return { projectId: g.projectId, claude: count(g.claude), terminals: count(g.terminals) }
  })
  if (clean.every((g) => g.claude + g.terminals === 0)) throw new Error('Abra ao menos uma sessão ou um terminal.')
  return clean
}

/** Títulos: "Sessão 1" num ambiente de um projeto; com vários, o nome do projeto vem antes. */
export function slotsFromGroups(groups: SessionGroup[], projectName: (id: string) => string): TemplateSlot[] {
  const multi = groups.length > 1
  const slots: TemplateSlot[] = []
  for (const g of groups) {
    const prefix = multi ? `${projectName(g.projectId)} · ` : ''
    for (let i = 1; i <= g.claude; i++) slots.push({ slot: `slot-${slots.length}`, projectId: g.projectId, adapterId: 'claude', title: `${prefix}Sessão ${i}` })
    for (let i = 1; i <= g.terminals; i++) slots.push({ slot: `slot-${slots.length}`, projectId: g.projectId, adapterId: 'shell', title: `${prefix}Terminal ${i}` })
  }
  return slots
}

/** As quantidades por projeto de um conjunto de sessões, na ordem em que os projetos aparecem. */
export function groupsOf(slots: Array<{ projectId: string; adapterId: string }>): SessionGroup[] {
  const groups: SessionGroup[] = []
  for (const s of slots) {
    let g = groups.find((x) => x.projectId === s.projectId)
    if (!g) groups.push((g = { projectId: s.projectId, claude: 0, terminals: 0 }))
    if (s.adapterId === 'shell') g.terminals++
    else g.claude++
  }
  return groups
}

export const sameGroups = (a: SessionGroup[], b: SessionGroup[]): boolean =>
  a.length === b.length && a.every((g, i) => g.projectId === b[i]!.projectId && g.claude === b[i]!.claude && g.terminals === b[i]!.terminals)

/** Molde a partir de um ambiente: reaproveita a exportação, que tira conversas e caminhos da máquina. */
export function templateFromEnvironment(env: Environment, name: string, layout: unknown): Template {
  if (env.sessions.length === 0) throw new Error('O ambiente não tem sessões para virar template.')
  const slots = env.sessions.map((s, i) => ({ slot: `slot-${i}`, projectId: s.projectId ?? env.projectId, adapterId: s.adapterId, title: s.title }))
  return { id: randomUUID(), name: cleanName(name), slots, layout: templateLayout(env, layout), updatedAt: Date.now() }
}

export function cleanName(name: string): string {
  const clean = String(name ?? '').trim().slice(0, 80)
  if (!clean) throw new Error('Dê um nome ao template.')
  return clean
}

/** Sessões novas para um ambiente: troca cada slot por um id e devolve o layout já com os ids. */
export function instantiate(
  slots: TemplateSlot[],
  layout: unknown | null,
  cwdOf: (projectId: string) => string
): { sessions: SessionSpec[]; layout: unknown | null } {
  let text = JSON.stringify(layout ?? null)
  const sessions = slots.map((s) => {
    const id = randomUUID()
    // O limite de palavra evita que slot-1 também troque parte de slot-10.
    text = text.replace(new RegExp(`\\b${s.slot}\\b`, 'g'), id)
    return { id, adapterId: s.adapterId, title: s.title, cwd: cwdOf(s.projectId), projectId: s.projectId, started: false }
  })
  return { sessions, layout: JSON.parse(text) }
}

/** Arquivo para compartilhar: projetos pelo nome, nunca pelo caminho ou id da máquina. */
export function exportTemplate(template: Template, projectName: (id: string) => string): string {
  const projects = [...new Set(template.slots.map((s) => s.projectId))]
  return JSON.stringify(
    {
      format: FORMAT,
      version: FORMAT_VERSION,
      name: template.name,
      projects: projects.map((id) => projectName(id)),
      slots: template.slots.map((s) => ({ slot: s.slot, project: projects.indexOf(s.projectId), adapterId: s.adapterId, title: s.title })),
      layout: template.layout
    },
    null,
    2
  )
}

export interface ParsedTemplate {
  name: string
  projects: string[]
  slots: Array<{ slot: string; project: number; adapterId: string; title: string }>
  layout: unknown | null
}

/** O arquivo vem de outra pessoa: só agentes conhecidos, slots válidos e nenhum caminho. */
export function parseTemplateFile(text: string, knownAdapters: string[]): ParsedTemplate {
  const fail = (reason: string): never => {
    throw new Error(`Arquivo de template inválido: ${reason}.`)
  }
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return fail('não é um JSON válido')
  }
  if (data?.format !== FORMAT) fail('formato desconhecido')
  if (data.version !== FORMAT_VERSION) fail(`versão ${data.version} não suportada`)
  const name = cleanName(data.name)
  if (!Array.isArray(data.projects) || data.projects.some((p: unknown) => typeof p !== 'string' || !p.trim())) fail('lista de projetos inválida')
  if (!Array.isArray(data.slots) || data.slots.length === 0) fail('sem sessões')
  const slots = data.slots.map((s: any) => {
    if (typeof s?.slot !== 'string' || !/^slot-\d+$/.test(s.slot)) fail('sessão sem marcador')
    if (!knownAdapters.includes(s.adapterId)) fail(`agente desconhecido "${s.adapterId}"`)
    if (!Number.isInteger(s.project) || s.project < 0 || s.project >= data.projects.length) fail('sessão sem projeto')
    return { slot: s.slot, project: s.project, adapterId: s.adapterId, title: String(s.title ?? '').slice(0, 120) }
  })
  // O layout passa pela mesma checagem de painéis da importação de ambientes.
  const panels = Object.values<any>(data.layout?.panels ?? {})
  for (const panel of panels) {
    if (!PANEL_COMPONENTS.has(panel?.contentComponent)) fail('painel desconhecido')
    const params = panel?.params ?? {}
    if (params.kind === 'terminal' && !slots.some((s: { slot: string }) => s.slot === params.sessionId)) fail('painel sem sessão')
    if (params.path != null && (typeof params.path !== 'string' || isAbsoluteAnywhere(params.path) || hasParentSegment(params.path))) {
      fail('caminho fora do projeto')
    }
    if (params.kind === 'diff') panel.params = { kind: 'diff', cwd: null }
  }
  return { name, projects: data.projects, slots, layout: data.layout ?? null }
}

/** Um arquivo por template, em `Templates/` na pasta de trabalho. */
export class TemplateStore {
  private dir: string

  constructor(workspaceDir: string) {
    this.dir = join(workspaceDir, TEMPLATES_DIR)
    mkdirSync(this.dir, { recursive: true })
  }

  private files(): Array<{ path: string; template: Template }> {
    const list: Array<{ path: string; template: Template }> = []
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue
      const path = join(this.dir, name)
      try {
        list.push({ path, template: JSON.parse(readFileSync(path, 'utf8')) as Template })
      } catch {
        console.error(`Template ignorado: ${path}`)
      }
    }
    return list
  }

  list(): Template[] {
    return this.files()
      .map((f) => f.template)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  get(id: string): Template {
    const found = this.files().find((f) => f.template.id === id)
    if (!found) throw new Error('Template não encontrado.')
    return found.template
  }

  save(template: Template): Template {
    const old = this.files().find((f) => f.template.id === template.id)
    const path = join(this.dir, `${slug(template.name)}-${template.id.slice(0, 8)}.json`)
    writeJsonAtomic(path, template)
    if (old && old.path !== path) rmSync(old.path, { force: true })
    return template
  }

  remove(id: string): void {
    for (const f of this.files()) if (f.template.id === id) rmSync(f.path, { force: true })
  }
}
