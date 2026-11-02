import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginInfo, PluginItem } from '../shared/types'
import { childEnv } from './childEnv'

/** Nos testes, um falso `claude` evita mexer nos plugins de verdade da pessoa. */
const TEST_CLI = process.env.AGENT_IDE_TEST_PLUGIN_CLI

/**
 * Usa os comandos oficiais `claude plugin`: o próprio Claude Code decide em que arquivo gravar,
 * confere dependências e mantém o formato dos settings, que é dele.
 */
function claude(args: string[], cwd: string): Promise<string> {
  const env = childEnv(process.env)
  const [file, fullArgs] = TEST_CLI
    ? [process.execPath, [TEST_CLI, ...args]]
    : process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'claude', ...args]]
      : ['claude', args]
  if (TEST_CLI) env.ELECTRON_RUN_AS_NODE = '1'
  return new Promise((resolve, reject) => {
    execFile(file, fullArgs, { cwd, env, timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      // enable e disable saem com código 1 também quando o plugin já estava no estado pedido.
      if (stdout.trim()) resolve(stdout)
      else reject(new Error(stderr.trim() || err?.message || 'O Claude Code não respondeu.'))
    })
  })
}

const lastLine = (text: string): string => text.trim().split(/\r?\n/).pop() ?? ''

/** Lê `name` e `description` do cabeçalho YAML simples dos arquivos .md de plugin. */
function frontmatter(path: string): Record<string, string> {
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8'))
    const fields: Record<string, string> = {}
    for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
      const field = /^(name|description):\s*(.*)$/.exec(line)
      if (field) fields[field[1]!] = field[2]!.trim().replace(/^["']|["']$/g, '')
    }
    return fields
  } catch {
    return {}
  }
}

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()
const list = (dir: string): string[] => (isDir(dir) ? readdirSync(dir).sort() : [])

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** O que o plugin traz, pela organização padrão de pastas. */
export function readPluginFolder(root: string): Pick<PluginInfo, 'description' | 'skills' | 'commands' | 'agents' | 'mcpServers' | 'hasHooks'> {
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json')) ?? {}
  const skills: PluginItem[] = list(join(root, 'skills'))
    .filter((name) => existsSync(join(root, 'skills', name, 'SKILL.md')))
    .map((name) => {
      const meta = frontmatter(join(root, 'skills', name, 'SKILL.md'))
      return { name: meta.name || name, description: meta.description ?? '' }
    })
  const markdown = (dir: string): PluginItem[] =>
    list(join(root, dir))
      .filter((name) => name.endsWith('.md'))
      .map((name) => {
        const meta = frontmatter(join(root, dir, name))
        return { name: meta.name || name.slice(0, -3), description: meta.description ?? '' }
      })
  const mcp = readJson(join(root, '.mcp.json'))
  const mcpMap = (mcp && typeof mcp.mcpServers === 'object' ? mcp.mcpServers : mcp) as Record<string, unknown> | null
  const inline = typeof manifest.mcpServers === 'object' && manifest.mcpServers ? Object.keys(manifest.mcpServers) : []
  return {
    description: typeof manifest.description === 'string' ? manifest.description : '',
    skills,
    commands: markdown('commands'),
    agents: markdown('agents'),
    mcpServers: [...new Set([...Object.keys(mcpMap ?? {}), ...inline])],
    hasHooks: existsSync(join(root, 'hooks', 'hooks.json')) || Boolean(manifest.hooks)
  }
}

interface ListedPlugin {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath?: string
  readFromFolder?: string
  mcpServers?: Record<string, unknown>
  errors?: string[]
}

/** Plugins instalados e o estado que vale para a pasta `cwd`. */
export async function listPlugins(cwd: string): Promise<PluginInfo[]> {
  const listed = JSON.parse(await claude(['plugin', 'list', '--json'], cwd)) as ListedPlugin[]
  return listed
    .map((p) => {
      const [name = p.id, marketplace = ''] = p.id.split('@')
      const folder = p.readFromFolder ?? p.installPath ?? ''
      const details = folder && isDir(folder) ? readPluginFolder(folder) : readPluginFolder('')
      return {
        id: p.id,
        name,
        marketplace,
        version: p.version,
        scope: p.scope,
        enabled: p.enabled,
        errors: p.errors ?? [],
        ...details,
        mcpServers: [...new Set([...details.mcpServers, ...Object.keys(p.mcpServers ?? {})])]
      }
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
}

/** Liga ou desliga. Sem `--scope`, o Claude Code grava no escopo que já decide sobre o plugin. */
export async function setPluginEnabled(cwd: string, id: string, enabled: boolean): Promise<void> {
  // O id vai para o cmd.exe no Windows: só os caracteres de um id de plugin.
  if (!/^[\w.-]+@[\w.-]+$/.test(id)) throw new Error('Plugin inválido.')
  const result = JSON.parse(lastLine(await claude(['plugin', enabled ? 'enable' : 'disable', id, '--json'], cwd))) as {
    outcome?: string
    alreadyInGoalState?: boolean
    message?: string
  }
  if (result.outcome !== 'ok' && !result.alreadyInGoalState) throw new Error(result.message ?? 'O Claude Code não aplicou a mudança.')
}
