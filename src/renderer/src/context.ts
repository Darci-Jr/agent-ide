import { createContext, useContext } from 'react'
import type { Environment, SessionState } from '../../shared/types'
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
  openFile(path: string, asEditor?: boolean): void
  setDirty(panelId: string, dirty: boolean): void
  toast(message: string): void
}

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
