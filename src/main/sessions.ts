import { spawn, type IPty } from '@lydell/node-pty'
import type { SessionSpec, SessionState } from '../shared/types'
import { getAdapter } from './adapters'
import { childEnv } from './childEnv'

const BUSY_WINDOW_MS = 2000
/** Ao abrir, a CLI redesenha a tela: essa saída não significa trabalho. */
const STARTUP_GRACE_MS = 5000
/** Um Claude parado no prompt também solta saídas isoladas; trabalho é atividade contínua. */
const SUSTAINED_ACTIVITY_MS = 4000

interface Live {
  pty: IPty
  lastOutput: number
  startedAt: number
  /** Início da atividade atual; nulo enquanto ociosa. */
  busySince: number | null
}

export interface SessionEvents {
  data(id: string, data: string): void
  states(states: SessionState[]): void
}

/** Mantém os processos. O que persiste entre reinícios fica nos ambientes. */
export class SessionManager {
  private live = new Map<string, Live>()
  private states = new Map<string, SessionState>()
  private timer: NodeJS.Timeout

  constructor(private events: SessionEvents) {
    this.timer = setInterval(() => this.tick(), 1000)
  }

  list = (): SessionState[] => [...this.states.values()]
  write = (id: string, data: string): void => this.live.get(id)?.pty.write(data)

  resize(id: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return
    try {
      this.live.get(id)?.pty.resize(cols, rows)
    } catch {
      // O processo pode ter acabado de sair; a saída é tratada em onExit.
    }
  }

  async start(spec: SessionSpec): Promise<void> {
    if (this.live.has(spec.id)) return
    const { file, args } = await getAdapter(spec.adapterId).spawn({ sessionId: spec.id, started: spec.started, cwd: spec.cwd })
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: spec.cwd,
      env: childEnv(process.env)
    })
    const live: Live = { pty, lastOutput: Date.now(), startedAt: Date.now(), busySince: Date.now() }
    this.live.set(spec.id, live)
    this.states.set(spec.id, { id: spec.id, running: true, busy: true, working: false, startedAt: live.startedAt })
    pty.onData((data) => {
      live.lastOutput = Date.now()
      this.events.data(spec.id, data)
    })
    pty.onExit(({ exitCode }) => {
      // Se a sessão já foi removida ou reiniciada, o evento é de um processo antigo.
      if (this.live.get(spec.id) !== live) return
      this.live.delete(spec.id)
      this.states.set(spec.id, { id: spec.id, running: false, busy: false, working: false, exitCode })
      this.events.states(this.list())
    })
    this.events.states(this.list())
  }

  stop(id: string): void {
    this.live.get(id)?.pty.kill()
  }

  remove(id: string): void {
    const live = this.live.get(id)
    this.live.delete(id)
    this.states.delete(id)
    live?.pty.kill()
    this.events.states(this.list())
  }

  dispose(): void {
    clearInterval(this.timer)
    const all = [...this.live.values()]
    this.live.clear()
    for (const { pty } of all) pty.kill()
  }

  private tick(): void {
    let changed = false
    for (const [id, live] of this.live) {
      const state = this.states.get(id)
      const now = Date.now()
      const busy = now - live.lastOutput < BUSY_WINDOW_MS
      if (!busy) live.busySince = null
      else live.busySince ??= now
      const working =
        busy && now - live.startedAt >= STARTUP_GRACE_MS && live.busySince !== null && now - live.busySince >= SUSTAINED_ACTIVITY_MS
      if (state && (state.busy !== busy || state.working !== working)) {
        state.busy = busy
        state.working = working
        changed = true
      }
    }
    if (changed) this.events.states(this.list())
  }
}
