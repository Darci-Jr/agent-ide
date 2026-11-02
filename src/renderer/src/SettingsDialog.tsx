import type { ReactNode } from 'react'
import type { Preferences } from '../../shared/types'

/** Só o que aparece no rodapé. Os comandos têm ícone próprio na barra lateral. */
export function SettingsDialog(props: { prefs: Preferences; changePrefs(next: Preferences): void; onClose(): void }): ReactNode {
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
            <input type="checkbox" checked={prefs.showGit} onChange={(e) => changePrefs({ ...prefs, showGit: e.target.checked })} />
            Mostrar Git no rodapé
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={props.onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
