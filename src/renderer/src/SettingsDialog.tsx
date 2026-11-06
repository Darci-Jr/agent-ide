import type { ReactNode } from 'react'
import type { Preferences, UpdateState } from '../../shared/types'
import { ide } from './ide'

function updateText(u: UpdateState): string {
  switch (u.status) {
    case 'disabled':
      return 'Atualizações só funcionam no app instalado.'
    case 'checking':
      return 'Procurando atualizações…'
    case 'current':
      return 'Você está na versão mais recente.'
    case 'downloading':
      return `Baixando a versão ${u.available ?? ''}… ${u.percent ?? 0}%`
    case 'ready':
      return `Versão ${u.available} pronta. Reinicie para atualizar.`
    case 'error':
      return `Não foi possível procurar atualizações: ${u.error ?? 'erro desconhecido'}`
    default:
      return ''
  }
}

/** O que aparece no rodapé e a versão do app. Os comandos têm ícone próprio na barra lateral. */
export function SettingsDialog(props: {
  prefs: Preferences
  changePrefs(next: Preferences): void
  update: UpdateState | null
  installUpdate(): void
  onClose(): void
}): ReactNode {
  const { update } = props
  const { prefs, changePrefs } = props
  return (
    <div className="overlay">
      <div
        className="modal small settings-dialog"
        role="dialog"
        aria-label="Configurações"
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <h2>Configurações</h2>
        <div className="settings-list">
          <label className="setting">
            <input type="checkbox" autoFocus checked={prefs.showUsage} onChange={(e) => changePrefs({ ...prefs, showUsage: e.target.checked })} />
            Mostrar uso do Claude no rodapé
          </label>
          <label className="setting">
            <input type="checkbox" checked={prefs.showContext} onChange={(e) => changePrefs({ ...prefs, showContext: e.target.checked })} />
            Mostrar janela de contexto no rodapé
          </label>
          <label className="setting">
            <input type="checkbox" checked={prefs.showCache} onChange={(e) => changePrefs({ ...prefs, showCache: e.target.checked })} />
            Mostrar cache da sessão no rodapé
          </label>
          <label className="setting">
            <input type="checkbox" checked={prefs.showGit} onChange={(e) => changePrefs({ ...prefs, showGit: e.target.checked })} />
            Mostrar Git no rodapé
          </label>
        </div>
        {update && (
          <section className="settings-version" aria-label="Versão">
            <h3>Agent IDE {update.version}</h3>
            <p role="status">{updateText(update)}</p>
            {update.status === 'ready' ? (
              <button type="button" className="primary" onClick={props.installUpdate}>
                Reiniciar e atualizar
              </button>
            ) : (
              <button
                type="button"
                className="ghost"
                disabled={update.status === 'disabled' || update.status === 'checking' || update.status === 'downloading'}
                onClick={() => void ide.checkUpdate()}
              >
                Procurar atualizações
              </button>
            )}
          </section>
        )}
        <div className="modal-actions">
          <button type="button" className="primary" onClick={props.onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
