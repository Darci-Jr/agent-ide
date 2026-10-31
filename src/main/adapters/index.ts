import { execFile } from 'node:child_process'
import type { AdapterInfo } from '../../shared/types'
import { claudeAdapter } from './claude'
import type { AgentAdapter } from './types'

/** Terminal comum: já permite rodar outras CLIs enquanto elas não têm adaptador próprio. */
const shellAdapter: AgentAdapter = {
  id: 'shell',
  label: 'Terminal',
  spawn: async () => ({
    file: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? 'bash'),
    args: []
  })
}

const adapters = [claudeAdapter, shellAdapter]

export const adapterIds = (): string[] => adapters.map((a) => a.id)

export function getAdapter(id: string): AgentAdapter {
  const adapter = adapters.find((a) => a.id === id)
  if (!adapter) throw new Error(`Agente desconhecido: ${id}`)
  return adapter
}

const onPath = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [command], (err) => resolve(!err))
  })

export const listAdapters = (): Promise<AdapterInfo[]> =>
  Promise.all(
    adapters.map(async (a) => ({
      id: a.id,
      label: a.label,
      available: a.detectCommand ? await onPath(a.detectCommand) : true
    }))
  )
