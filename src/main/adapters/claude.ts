import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAdapter } from './types'

/** Procura pelo id em vez de recalcular o nome da pasta, cuja regra é interna da CLI. */
async function hasTranscript(sessionId: string): Promise<boolean> {
  const root = join(homedir(), '.claude', 'projects')
  const dirs = await readdir(root).catch(() => [] as string[])
  for (const dir of dirs) {
    if (await stat(join(root, dir, `${sessionId}.jsonl`)).then(() => true, () => false)) return true
  }
  return false
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  detectCommand: 'claude',
  async spawn({ sessionId, started }) {
    // A CLI só grava o transcript na primeira mensagem. Uma sessão aberta e
    // fechada sem conversa não pode ser retomada, então recomeça com o mesmo id.
    const resume = started && (await hasTranscript(sessionId))
    const flags = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    // No Windows o npm instala um shim .cmd, que precisa passar pelo cmd.exe.
    return process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/c', 'claude', ...flags] }
      : { file: 'claude', args: flags }
  }
}
