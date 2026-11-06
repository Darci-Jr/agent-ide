import { createContext, useContext } from 'react'
import type { CustomCommand, Environment, SessionState } from '../../shared/types'
import type { Theme } from './terminals'

export interface EnvContextValue {
  env: Environment
  states: Map<string, SessionState>
  theme: Theme
  focusId: string | null
  setFocus(panelId: string | null): void
  closePanel(panelId: string): void
  renameSession(sessionId: string, title: string): void
  startSession(sessionId: string): void
  acknowledgeSession(sessionId: string): void
  /** Sessões do Claude rodando em qualquer aba, com o início do processo atual. */
  claudeSessions: Array<{ id: string; title: string; startedAt: number }>
  pluginsChangedAt: number
  /** Comandos gerais e do projeto do ambiente, que viram botões nas abas de terminal. */
  commands: CustomCommand[]
  markPluginsChanged(): void
  /** Abre um terminal novo na pasta da sessão em uso e executa o comando nele. */
  runCommand(command: CustomCommand): void
  /** `root`: pasta do projeto do arquivo; sem ela, a do ambiente. */
  openFile(path: string, asEditor?: boolean, root?: string | null): void
  /** Pasta do projeto da sessão em uso. */
  projectCwd: string
  setDirty(panelId: string, dirty: boolean): void
  toast(message: string): void
}

export const INTERRUPTED_TIP = 'Estava trabalhando quando foi encerrada. A tarefa parou e precisa da sua atenção.'

/** Quem executa os comandos de cada ambiente aberto. A aba do ambiente, no App, usa daqui. */
export const commandRunners = new Map<string, (command: CustomCommand) => void>()

/** Editores com alterações não salvas, em todos os ambientes. */
export const unsavedPanels = new Set<string>()

window.addEventListener('beforeunload', (e) => {
  if (unsavedPanels.size > 0) e.preventDefault()
})

export const EnvContext = createContext<EnvContextValue | null>(null)

export function useEnv(): EnvContextValue {
  const value = useContext(EnvContext)
  if (!value) throw new Error('Painel fora de um ambiente.')
  return value
}
