import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { updateError } from './updateError'

/** De quanto em quanto tempo procura uma versão nova enquanto o app está aberto. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
/** Onde baixar quando a atualização não pode ser instalada sozinha. */
export const RELEASES_URL = 'https://github.com/Darci-Jr/agent-ide/releases/latest'

/**
 * Atualizações pelas releases do GitHub. Baixa em segundo plano e nunca reinicia sozinho:
 * derrubaria sessões trabalhando. A versão nova entra ao reiniciar pelo aviso ou ao fechar o app.
 * No Mac, sem assinatura da Apple, o app não pode se trocar sozinho: só avisa e abre a página
 * da versão nova para baixar.
 */
export class Updater {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null

  private manual = process.platform === 'darwin'

  constructor(private notify: (state: UpdateState) => void) {
    // Fora do app instalado (dev, testes) não há de onde atualizar. O teste do pacote liga de propósito.
    const enabled = app.isPackaged && (!process.env.AGENT_IDE_USER_DATA || process.env.AGENT_IDE_TEST_UPDATES === '1')
    this.state = { version: app.getVersion(), status: enabled ? 'idle' : 'disabled' }
    if (!enabled) return
    autoUpdater.autoDownload = !this.manual
    autoUpdater.autoInstallOnAppQuit = !this.manual
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) =>
      this.set(this.manual ? { status: 'available', available: info.version } : { status: 'downloading', available: info.version, percent: 0 })
    )
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', available: info.version }))
    // Sem internet ou sem release publicada: só registra, o app segue normal.
    autoUpdater.on('error', (err) => this.set({ status: 'error', error: updateError(err) }))
  }

  get(): UpdateState {
    return this.state
  }

  start(): void {
    if (this.state.status === 'disabled') return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  async check(): Promise<UpdateState> {
    if (['disabled', 'downloading', 'ready', 'available'].includes(this.state.status)) return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', error: updateError(err) })
    }
    return this.state
  }

  /** Só a pedido da pessoa. As sessões que rodavam voltam ao reabrir, sem continuar a tarefa. */
  install(): void {
    if (this.state.status === 'available') void shell.openExternal(RELEASES_URL)
    if (this.state.status !== 'ready') return
    autoUpdater.quitAndInstall(true, true)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, error: undefined, ...patch }
    this.notify(this.state)
  }
}
