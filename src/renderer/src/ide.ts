import type { IdeApi } from '../../shared/types'

declare global {
  interface Window {
    ide: IdeApi
  }
}

export const ide: IdeApi = window.ide

export const errorMessage = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err)
  // O Electron prefixa os erros vindos do processo principal.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
