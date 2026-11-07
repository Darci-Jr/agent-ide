import { open } from 'node:fs/promises'
import type { TokenTotals } from '../shared/types'

interface Usage {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

/**
 * Lê linhas do transcript e guarda o uso de cada resposta. O transcript repete a mesma resposta
 * (mesmo `message.id`) em várias linhas, uma por bloco: somar todas contaria quase três vezes.
 * Fica o uso da última linha de cada resposta. Subagentes entram: também gastam tokens.
 * Formato interno do Claude Code. Exportado para os testes.
 */
export function collectUsage(lines: string[], into: Map<string, Usage>): void {
  for (const line of lines) {
    if (!line.includes('"usage"')) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const usage = entry?.message?.usage
    if (entry?.type !== 'assistant' || !usage) continue
    const id = entry.message.id ?? entry.uuid
    if (!id) continue
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    into.set(id, {
      input: n(usage.input_tokens),
      cacheWrite: n(usage.cache_creation_input_tokens),
      cacheRead: n(usage.cache_read_input_tokens),
      output: n(usage.output_tokens)
    })
  }
}

export function totalsOf(usages: Map<string, Usage>): TokenTotals {
  const t = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, responses: usages.size }
  for (const u of usages.values()) {
    t.input += u.input
    t.cacheWrite += u.cacheWrite
    t.cacheRead += u.cacheRead
    t.output += u.output
  }
  return { ...t, total: t.input + t.cacheWrite + t.cacheRead + t.output }
}

interface Tally {
  path: string
  offset: number
  /**
   * Pedaço de linha no fim da última leitura, ainda sendo gravado. Fica em bytes: cortado no meio
   * de um caractere acentuado, virar texto antes da hora o estragaria.
   */
  rest: Buffer
  usages: Map<string, Usage>
}

/**
 * Tokens da conversa inteira, por sessão. O transcript chega a dezenas de MB: cada consulta lê
 * só o que entrou desde a anterior.
 */
export class TokenTally {
  private tallies = new Map<string, Tally>()

  async read(sessionId: string, path: string | null): Promise<TokenTotals | null> {
    if (!path) return null
    let tally = this.tallies.get(sessionId)
    if (!tally || tally.path !== path) {
      tally = { path, offset: 0, rest: Buffer.alloc(0), usages: new Map() }
      this.tallies.set(sessionId, tally)
    }
    const file = await open(path, 'r').catch(() => null)
    if (!file) return tally.usages.size ? totalsOf(tally.usages) : null
    try {
      const { size } = await file.stat()
      // Arquivo menor que o já lido: foi reescrito, recomeça.
      if (size < tally.offset) Object.assign(tally, { offset: 0, rest: Buffer.alloc(0), usages: new Map() })
      if (size > tally.offset) {
        const fresh = Buffer.alloc(size - tally.offset)
        await file.read(fresh, 0, fresh.length, tally.offset)
        tally.offset = size
        const data = Buffer.concat([tally.rest, fresh])
        const end = data.lastIndexOf(0x0a) + 1
        tally.rest = data.subarray(end)
        collectUsage(data.subarray(0, end).toString('utf8').split('\n'), tally.usages)
      }
    } finally {
      await file.close()
    }
    return tally.usages.size ? totalsOf(tally.usages) : null
  }

  forget(sessionId: string): void {
    this.tallies.delete(sessionId)
  }
}
