import { existsSync, mkdirSync, readFileSync, rmSync, unwatchFile, watch, watchFile, writeFileSync, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeUsage, Preferences, SessionContext } from '../shared/types'
import { writeJsonAtomic } from './workspace'

/**
 * Executado pelo Claude Code como linha de status. Guarda os limites da conta e o contexto da
 * sessão e, se a pessoa tinha uma linha de status própria, executa a dela e repassa o resultado.
 * É CommonJS puro porque roda pelo executável do Electron, fora do pacote do app.
 */
export const STATUS_LINE_SCRIPT = `const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const [usagePath, contextDir, sessionId, original] = process.argv.slice(2)
const save = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value))
  fs.renameSync(file + '.tmp', file)
}
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    const limits = data.rate_limits || {}
    const pick = (w) => (w && typeof w.used_percentage === 'number' ? { usedPercentage: w.used_percentage, resetsAt: w.resets_at * 1000 } : null)
    const usage = { fiveHour: pick(limits.five_hour), sevenDay: pick(limits.seven_day), updatedAt: Date.now() }
    if (usage.fiveHour || usage.sevenDay) save(usagePath, usage)
    const context = data.context_window || {}
    if (contextDir && /^[\\w-]+$/.test(sessionId || '') && typeof context.used_percentage === 'number') {
      const size = typeof context.context_window_size === 'number' ? context.context_window_size : null
      save(path.join(contextDir, sessionId + '.json'), { usedPercentage: context.used_percentage, size, updatedAt: Date.now() })
    }
  } catch {}
  if (!original) return
  try {
    const command = Buffer.from(original, 'base64').toString('utf8')
    process.stdout.write(execSync(command, { input, shell: process.env.SHELL || true, timeout: 10000 }))
  } catch {}
})
`

const DEFAULT_PREFERENCES: Preferences = { showUsage: true, showContext: true, showCache: true, showTokens: true, showGit: true }
const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>

/** Cuida dos arquivos da linha de status e das preferências, todos no perfil do app. */
export class UsageTracker {
  private usagePath: string
  private contextDir: string
  private scriptPath: string
  private settingsDir: string
  private prefsPath: string
  private contextWatcher: FSWatcher | null = null

  constructor(
    userData: string,
    onUsage: (usage: ClaudeUsage | null) => void,
    onContext: (sessionId: string, context: SessionContext | null) => void
  ) {
    this.usagePath = join(userData, 'uso-claude.json')
    this.contextDir = join(userData, 'contexto')
    this.scriptPath = join(userData, 'statusline.cjs')
    this.settingsDir = join(userData, 'claude-settings')
    this.prefsPath = join(userData, 'preferencias.json')
    for (const dir of [this.settingsDir, this.contextDir]) mkdirSync(dir, { recursive: true })
    // Regravado a cada abertura: muda junto com o app.
    writeFileSync(this.scriptPath, STATUS_LINE_SCRIPT)
    watchFile(this.usagePath, { interval: 1000 }, () => onUsage(this.usage()))
    this.contextWatcher = watch(this.contextDir, (_event, file) => {
      const name = file?.toString() ?? ''
      if (name.endsWith('.json')) {
        const id = name.slice(0, -'.json'.length)
        onContext(id, this.context(id))
      }
    })
  }

  dispose(): void {
    unwatchFile(this.usagePath)
    this.contextWatcher?.close()
  }

  usage(): ClaudeUsage | null {
    try {
      return JSON.parse(readFileSync(this.usagePath, 'utf8')) as ClaudeUsage
    } catch {
      return null
    }
  }

  context(sessionId: string): SessionContext | null {
    if (!/^[\w-]+$/.test(sessionId)) return null
    try {
      return JSON.parse(readFileSync(join(this.contextDir, `${sessionId}.json`), 'utf8')) as SessionContext
    } catch {
      return null
    }
  }

  /** A sessão saiu do ambiente: os arquivos dela não servem mais. */
  forget(sessionId: string): void {
    if (!/^[\w-]+$/.test(sessionId)) return
    for (const file of [join(this.contextDir, `${sessionId}.json`), join(this.settingsDir, `${sessionId}.json`)]) rmSync(file, { force: true })
  }

  preferences(): Preferences {
    try {
      const saved = JSON.parse(readFileSync(this.prefsPath, 'utf8')) as Partial<Preferences>
      // Indicador novo vem ligado: só o que a pessoa desligou fica desligado.
      return Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, saved[k] !== false])) as unknown as Preferences
    } catch {
      return { ...DEFAULT_PREFERENCES }
    }
  }

  savePreferences(prefs: Preferences): void {
    writeJsonAtomic(this.prefsPath, Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, Boolean(prefs[k])])))
  }

  /**
   * Arquivo para `claude --settings`. Não depende da preferência: o rodapé da IDE e o terminal
   * são independentes. O comando roda no shell do Claude Code, que no Windows é o Git Bash.
   */
  settingsFor(sessionId: string, cwd: string): string {
    const unix = (p: string): string => `"${p.split('\\').join('/')}"`
    const original = originalStatusLine(cwd)
    const args = [this.scriptPath, this.usagePath, this.contextDir].map(unix)
    if (original) args.push(sessionId, Buffer.from(original).toString('base64'))
    else args.push(sessionId)
    const command = `ELECTRON_RUN_AS_NODE=1 ${unix(process.execPath)} ${args.join(' ')}`
    const path = join(this.settingsDir, `${sessionId}.json`)
    writeJsonAtomic(path, { statusLine: { type: 'command', command } })
    return path
  }
}

/** A linha de status que a pessoa configurou, na mesma ordem de prioridade do Claude Code. */
function originalStatusLine(cwd: string): string | null {
  const files = [join(cwd, '.claude', 'settings.local.json'), join(cwd, '.claude', 'settings.json'), join(homedir(), '.claude', 'settings.json')]
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const command = (JSON.parse(readFileSync(file, 'utf8')) as { statusLine?: { command?: unknown } }).statusLine?.command
      if (typeof command === 'string' && command.trim()) return command
    } catch {
      // Um arquivo inválido é ignorado, como faria o próprio Claude Code.
    }
  }
  return null
}
