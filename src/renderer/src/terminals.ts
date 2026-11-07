import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { ide } from './ide'

export type Theme = 'light' | 'dark'

const THEMES: Record<Theme, ITheme> = {
  light: {
    background: '#ffffff',
    foreground: '#14202b',
    cursor: '#14202b',
    selectionBackground: '#b8d4e8',
    black: '#14202b',
    red: '#b3261e',
    green: '#1a7a3c',
    yellow: '#8a5a00',
    blue: '#1f5fa8',
    magenta: '#8a3ea8',
    cyan: '#0f7285',
    // Branco ANSI sobre fundo branco sumiria.
    white: '#5d6f7d',
    brightBlack: '#5d6f7d',
    brightRed: '#c9352c',
    brightGreen: '#208a45',
    brightYellow: '#9c6800',
    brightBlue: '#2a6fc0',
    brightMagenta: '#9c4cbc',
    brightCyan: '#128399',
    brightWhite: '#14202b'
  },
  dark: {
    background: '#101a24',
    foreground: '#e6edf2',
    cursor: '#e6edf2',
    selectionBackground: '#38506a'
  }
}

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
}

const entries = new Map<string, Entry>()
const pendingFocus = new Set<string>()
let currentTheme: Theme = 'light'

/**
 * Cada terminal tem um único elemento, criado uma vez. Painéis apenas o recebem,
 * então destacar, arrastar ou trocar de ambiente nunca reinicia a sessão.
 */
const IS_MAC = navigator.userAgent.includes('Mac OS X')

function entry(sessionId: string): Entry {
  const existing = entries.get(sessionId)
  if (existing) return existing
  const host = document.createElement('div')
  host.className = 'terminal-host'
  const term = new Terminal({
    fontFamily: "'Cascadia Mono', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
    fontSize: 13,
    scrollback: 10000,
    theme: THEMES[currentTheme]
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => ide.write(sessionId, data))
  term.onResize(({ cols, rows }) => ide.resize(sessionId, cols, rows))
  // Deixa o navegador tratar colar e copiar, que o xterm recebe como eventos.
  term.attachCustomKeyEventHandler((e) => {
    // Sozinho, o xterm envia o mesmo Enter e a CLI submete. ESC + CR é o Alt+Enter, que as
    // CLIs entendem como quebra de linha. Bloqueia também o keypress, que enviaria outro CR.
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.type === 'keydown') {
        e.preventDefault()
        ide.write(sessionId, '\x1b\r')
      }
      return false
    }
    // No Mac, copiar e colar são Cmd+C e Cmd+V, pelo menu Editar; Ctrl+C e Ctrl+V vão para o terminal.
    if (e.type !== 'keydown' || !e.ctrlKey || IS_MAC) return true
    const key = e.key.toLowerCase()
    if (key === 'v') return false
    if (key === 'c' && (e.shiftKey || term.hasSelection())) {
      document.execCommand('copy')
      return false
    }
    return true
  })
  const created = { term, fit, host, opened: false }
  entries.set(sessionId, created)
  new ResizeObserver(() => fitIfVisible(created)).observe(host)
  return created
}

function fitIfVisible(e: Entry): void {
  // Um terminal oculto mediria zero e encolheria o processo por engano.
  if (!e.opened || e.host.clientWidth === 0 || e.host.clientHeight === 0) return
  e.fit.fit()
}

ide.onData((sessionId, data) => entry(sessionId).term.write(data))

export function attachTerminal(sessionId: string, container: HTMLElement): void {
  const e = entry(sessionId)
  if (e.host.parentElement !== container) container.appendChild(e.host)
  if (!e.opened) {
    e.term.open(e.host)
    e.opened = true
  }
  fitIfVisible(e)
  ide.resize(sessionId, e.term.cols, e.term.rows)
  if (pendingFocus.delete(sessionId)) {
    e.term.focus()
    // O dockview ainda ativa o painel novo depois de anexá-lo e pode levar o foco junto.
    requestAnimationFrame(() => e.term.focus())
  }
}

/** Um processo novo nasce com o tamanho padrão e precisa receber o tamanho do painel. */
export function syncTerminalSize(sessionId: string): void {
  const e = entries.get(sessionId)
  if (!e) return
  fitIfVisible(e)
  ide.resize(sessionId, e.term.cols, e.term.rows)
}

/** Um terminal recém-criado ainda não está na tela: recebe o foco quando for anexado. */
export function focusTerminal(sessionId: string): void {
  const e = entries.get(sessionId)
  if (e?.opened) e.term.focus()
  else pendingFocus.add(sessionId)
}

/** Antes de retomar: a CLI redesenha a conversa, e o texto antigo a duplicaria. */
export const resetTerminal = (sessionId: string): void => entries.get(sessionId)?.term.reset()

export function disposeTerminal(sessionId: string): void {
  const e = entries.get(sessionId)
  if (!e) return
  e.term.dispose()
  e.host.remove()
  entries.delete(sessionId)
}

export function setTerminalTheme(theme: Theme): void {
  currentTheme = theme
  for (const e of entries.values()) e.term.options.theme = THEMES[theme]
}
