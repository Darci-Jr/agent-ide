import { isAbsolute } from 'node:path'
import type { Environment } from '../shared/types'

export const isAbsoluteAnywhere = (path: string): boolean =>
  isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\')

export const hasParentSegment = (path: string): boolean => path.split(/[\\/]/).includes('..')

/** Painéis são reescritos um a um, então qualquer dado local fora desta lista não sai do app. */
function mapPanels(layout: any, map: (panel: any) => any): any {
  const panels: Record<string, any> = {}
  for (const [id, panel] of Object.entries<any>(layout?.panels ?? {})) panels[id] = map(panel)
  return { ...layout, panels }
}

/**
 * Layout que vai para um template, que pode ser exportado e compartilhado. Leva os painéis;
 * não leva conteúdo, conversas nem caminhos da máquina, e cada id de sessão vira `slot-<índice>`.
 */
export function templateLayout(env: Environment, layout: unknown): unknown | null {
  if (!layout) return null
  const clean = mapPanels(layout, (panel) => {
    const params = panel.params ?? {}
    if (params.kind === 'editor' || params.kind === 'markdown') {
      const local = !params.path || isAbsoluteAnywhere(params.path) || hasParentSegment(params.path)
      // A pasta do projeto é desta máquina; o arquivo abre na pasta do ambiente criado.
      return { ...panel, params: { kind: params.kind, path: local ? null : params.path }, title: local ? 'Arquivo' : panel.title }
    }
    // A pasta é desta máquina: quem usar o template vê as alterações do próprio projeto.
    if (params.kind === 'diff') return { ...panel, params: { kind: 'diff', cwd: null }, title: 'Alterações' }
    return panel
  })
  let text = JSON.stringify(clean)
  env.sessions.forEach((s, i) => {
    text = text.split(s.id).join(`slot-${i}`)
  })
  return JSON.parse(text)
}
