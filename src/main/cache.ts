import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { CacheInfo } from '../shared/types'

const FIVE_MINUTES = 5 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000
/** Só o fim do transcript: ele passa de dezenas de MB em conversas longas. */
const TAIL_BYTES = 512 * 1024

/**
 * Transcripts que a IDE lê (cache e histórico). Nos testes, uma pasta própria no lugar de ~/.claude/projects.
 * O adaptador não usa: quem retoma é o Claude Code de verdade, que lê a pasta real.
 */
export const transcriptsRoot = (): string => process.env.AGENT_IDE_TEST_TRANSCRIPTS ?? join(homedir(), '.claude', 'projects')

/**
 * Lê o cache do prompt a partir das linhas do transcript. Cada resposta renova o prazo,
 * que é de 5 minutos ou 1 hora conforme o tipo que a conversa vem criando
 * (`cache_creation.ephemeral_5m/1h_input_tokens`). Formato interno do Claude Code.
 */
export function readCacheInfo(text: string): CacheInfo | null {
  let lastAt: number | null = null
  let ttlMs: number | null = null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0 && (lastAt === null || ttlMs === null); i--) {
    const line = lines[i]
    if (!line || !line.includes('"usage"')) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue // A primeira linha do trecho pode vir cortada.
    }
    // Subagentes têm cache próprio; o que importa é o da conversa principal.
    if (entry?.type !== 'assistant' || entry.isSidechain || !entry.message?.usage) continue
    const usage = entry.message.usage
    const at = Date.parse(entry.timestamp)
    if (lastAt === null && Number.isFinite(at) && (usage.cache_read_input_tokens > 0 || usage.cache_creation_input_tokens > 0)) lastAt = at
    if (ttlMs === null) {
      if (usage.cache_creation?.ephemeral_1h_input_tokens > 0) ttlMs = ONE_HOUR
      else if (usage.cache_creation?.ephemeral_5m_input_tokens > 0) ttlMs = FIVE_MINUTES
    }
  }
  if (lastAt === null) return null
  // Sem criação no trecho lido, vale o prazo menor: melhor avisar cedo do que tarde.
  const ttl = ttlMs ?? FIVE_MINUTES
  return { lastAt, ttlMs: ttl, expiresAt: lastAt + ttl }
}

async function transcriptPath(cwd: string, sessionId: string): Promise<string | null> {
  const root = transcriptsRoot()
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  const direct = join(root, encoded, `${sessionId}.jsonl`)
  if (await stat(direct).then(() => true, () => false)) return direct
  // Em sistemas que diferenciam maiúsculas, a pasta pode ter outra grafia.
  const dirs = await readdir(root).catch(() => [] as string[])
  const dir = dirs.find((d) => d.toLowerCase() === encoded.toLowerCase())
  return dir ? join(root, dir, `${sessionId}.jsonl`) : null
}

/**
 * O transcript informado pela linha de status vale só se for um .jsonl dentro da pasta de transcripts:
 * o arquivo que o guarda pode ter sido mexido.
 */
export function reportedTranscript(root: string, reported: string | null): string | null {
  if (!reported || !reported.endsWith('.jsonl')) return null
  const rel = relative(resolve(root), resolve(reported))
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? resolve(reported) : null
}

/**
 * `reported` é o transcript da conversa atual, que muda com /clear ou /resume. Sem ele, antes da
 * primeira resposta, vale o transcript com o id da sessão.
 */
export async function sessionCache(cwd: string, sessionId: string, reported: string | null = null): Promise<CacheInfo | null> {
  const path = reportedTranscript(transcriptsRoot(), reported) ?? (await transcriptPath(cwd, sessionId))
  if (!path) return null
  const file = await open(path, 'r').catch(() => null)
  if (!file) return null
  try {
    const { size } = await file.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, size - length)
    return readCacheInfo(buffer.toString('utf8'))
  } finally {
    await file.close()
  }
}
