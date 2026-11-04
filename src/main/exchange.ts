import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Environment } from '../shared/types'

const FORMAT_VERSION = 1
const PANEL_COMPONENTS = new Set(['terminal', 'editor', 'markdown', 'plugins', 'diff'])

interface ExportedSession {
  slot: string
  adapterId: string
  title: string
}

const isAbsoluteAnywhere = (path: string): boolean =>
  isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\')

const hasParentSegment = (path: string): boolean => path.split(/[\\/]/).includes('..')

/** Painéis são reescritos um a um, então qualquer dado local fora desta lista não sai do app. */
function mapPanels(layout: any, map: (panel: any) => any): any {
  const panels: Record<string, any> = {}
  for (const [id, panel] of Object.entries<any>(layout?.panels ?? {})) panels[id] = map(panel)
  return { ...layout, panels }
}

/**
 * Gera o arquivo para compartilhar. Leva layout e painéis; não leva conteúdo,
 * conversas nem caminhos da máquina, e ids de sessão viram marcadores neutros.
 */
export function exportEnvironment(env: Environment, layout: unknown): string {
  const sessions: ExportedSession[] = env.sessions.map((s, i) => ({
    slot: `slot-${i}`,
    adapterId: s.adapterId,
    title: s.title
  }))
  let cleanLayout: any = layout
    ? mapPanels(layout, (panel) => {
        const params = panel.params ?? {}
        if (params.kind === 'editor' || params.kind === 'markdown') {
          const local = !params.path || isAbsoluteAnywhere(params.path) || hasParentSegment(params.path)
          return { ...panel, params: { ...params, path: local ? null : params.path }, title: local ? 'Arquivo' : panel.title }
        }
        // A pasta é desta máquina: quem importar vê as alterações do próprio projeto.
        if (params.kind === 'diff') return { ...panel, params: { kind: 'diff', cwd: null }, title: 'Alterações' }
        return panel
      })
    : null
  let text = JSON.stringify(cleanLayout)
  env.sessions.forEach((s, i) => {
    text = text.split(s.id).join(`slot-${i}`)
  })
  cleanLayout = JSON.parse(text)
  return JSON.stringify({ format: 'agent-ide-environment', version: FORMAT_VERSION, name: env.name, sessions, layout: cleanLayout }, null, 2)
}

const fail = (reason: string): never => {
  throw new Error(`Arquivo de ambiente inválido: ${reason}.`)
}

/**
 * O arquivo vem de outra pessoa, então é tratado como não confiável: não pode
 * indicar comandos, só agentes já conhecidos, nem apontar para fora do projeto.
 * Nenhuma sessão é iniciada ao importar.
 */
export function importEnvironment(text: string, cwd: string, projectId: string, knownAdapters: string[]): Environment {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return fail('não é um JSON válido')
  }
  if (data?.format !== 'agent-ide-environment') fail('formato desconhecido')
  if (data.version !== FORMAT_VERSION) fail(`versão ${data.version} não suportada`)
  if (typeof data.name !== 'string' || !data.name.trim()) fail('falta o nome')
  if (!Array.isArray(data.sessions)) fail('lista de sessões ausente')

  let layoutText = JSON.stringify(data.layout ?? null)
  const sessions = (data.sessions as ExportedSession[]).map((s) => {
    if (typeof s?.slot !== 'string' || !/^slot-\d+$/.test(s.slot)) fail('sessão sem marcador')
    if (!knownAdapters.includes(s.adapterId)) fail(`agente desconhecido "${s.adapterId}"`)
    if (typeof s.title !== 'string') fail('sessão sem título')
    const id = randomUUID()
    // O limite de palavra evita que slot-1 também troque parte de slot-10.
    layoutText = layoutText.replace(new RegExp(`\\b${s.slot}\\b`, 'g'), id)
    return { id, adapterId: s.adapterId, title: s.title.slice(0, 120), cwd, started: false }
  })
  const layout = JSON.parse(layoutText)
  const known = new Set(sessions.map((s) => s.id))
  for (const panel of Object.values<any>(layout?.panels ?? {})) {
    if (!PANEL_COMPONENTS.has(panel?.contentComponent)) fail('painel desconhecido')
    const params = panel.params ?? {}
    if (params.kind === 'terminal' && !known.has(params.sessionId)) fail('painel sem sessão')
    if (params.kind === 'diff') panel.params = { kind: 'diff', cwd: null }
    if (params.path != null) {
      if (typeof params.path !== 'string' || isAbsoluteAnywhere(params.path) || hasParentSegment(params.path)) {
        fail('caminho fora do projeto')
      }
    }
  }
  return {
    id: randomUUID(),
    name: data.name.slice(0, 80),
    projectId,
    draft: false,
    lastOpenedAt: Date.now(),
    cwd,
    sessions,
    layout
  }
}
