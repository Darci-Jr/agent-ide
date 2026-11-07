import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import type { HistoryEntry } from '../shared/types'
import { transcriptsRoot } from './cache'

const TITLE_LENGTH = 90

/** Regra que o Claude Code usa para nomear a pasta de cada projeto. */
const encodePath = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

interface Summary {
  entry: HistoryEntry
  size: number
  mtimeMs: number
}

// Um transcript pode ter dezenas de MB; só é relido quando muda.
const cache = new Map<string, Summary>()

async function summarize(path: string, sessionId: string): Promise<HistoryEntry | null> {
  const info = await stat(path)
  const cached = cache.get(path)
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.entry

  let title = ''
  let lastPrompt = ''
  let cwd = ''
  let messages = 0
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (!cwd && typeof d.cwd === 'string') cwd = d.cwd
    if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle
    if (d.type === 'last-prompt' && d.lastPrompt) lastPrompt = d.lastPrompt
    if (d.type === 'user' && !d.isMeta && !d.isSidechain) messages++
  }
  if (messages === 0 || !cwd) return null
  const entry: HistoryEntry = {
    sessionId,
    title: (title || lastPrompt || 'Sem título').replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH),
    cwd,
    updatedAt: info.mtimeMs,
    messages
  }
  cache.set(path, { entry, size: info.size, mtimeMs: info.mtimeMs })
  return entry
}

/**
 * Lê só as pastas deste projeto e das worktrees dele, sem percorrer os demais.
 * A pasta de transcripts é separada para os testes poderem usar uma própria.
 */
export async function listHistory(
  projectPath: string,
  root = transcriptsRoot()
): Promise<HistoryEntry[]> {
  const encoded = encodePath(projectPath)
  const worktrees = `${projectPath}.worktrees`
  const dirs = (await readdir(root).catch(() => [] as string[])).filter((name) => {
    const lower = name.toLowerCase()
    return lower === encoded || lower.startsWith(`${encoded}-worktrees-`)
  })
  const entries: HistoryEntry[] = []
  for (const dir of dirs) {
    const files = await readdir(join(root, dir)).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const entry = await summarize(join(root, dir, file), file.slice(0, -'.jsonl'.length)).catch(() => null)
      // O nome da pasta pode coincidir em projetos diferentes; o cwd real decide.
      if (entry && (isInside(projectPath, entry.cwd) || isInside(worktrees, entry.cwd))) entries.push(entry)
    }
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
