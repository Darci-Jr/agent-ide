import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { COMMAND_ICONS, type CommandDraft, type CommandIcon, type CustomCommand, type Preferences } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'

const EMPTY: CommandDraft = { command: '', name: '', icon: 'play', scope: 'project' }

const ICON_LABELS: Record<CommandIcon, string> = {
  play: 'Executar',
  flask: 'Testes',
  hammer: 'Build',
  bug: 'Depurar',
  rocket: 'Publicar',
  broom: 'Limpar',
  package: 'Pacote',
  database: 'Banco de dados',
  globe: 'Web',
  worktree: 'Git',
  check: 'Verificar',
  stop: 'Parar',
  refresh: 'Recarregar',
  upload: 'Enviar',
  download: 'Baixar',
  terminal: 'Terminal'
}

function CommandForm(props: { projectId: string; editing: CustomCommand | null; onDone(): void }): ReactNode {
  const [draft, setDraft] = useState<CommandDraft>(props.editing ?? EMPTY)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<CommandDraft>): void => setDraft({ ...draft, ...patch })

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await ide.saveCommand(props.projectId, draft, props.editing?.id)
      props.onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form className="command-form" onSubmit={(e) => void submit(e)}>
      <h2>{props.editing ? 'Editar comando' : 'Novo comando'}</h2>
      <label>
        Comando
        <input type="text" autoFocus className="mono" value={draft.command} onChange={(e) => set({ command: e.target.value })} />
      </label>
      <label>
        Nome
        <input type="text" placeholder="Opcional" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <fieldset>
        <legend>Vale para</legend>
        <label className="setting">
          <input type="radio" name="scope" checked={draft.scope === 'project'} onChange={() => set({ scope: 'project' })} />
          Este projeto
        </label>
        <label className="setting">
          <input type="radio" name="scope" checked={draft.scope === 'global'} onChange={() => set({ scope: 'global' })} />
          Todos os projetos
        </label>
      </fieldset>
      <fieldset>
        <legend>Ícone</legend>
        <div className="icon-picker" role="radiogroup" aria-label="Ícone">
          {COMMAND_ICONS.map((icon) => (
            <span key={icon} className={draft.icon === icon ? 'on' : ''} role="radio" aria-checked={draft.icon === icon}>
              <IconButton icon={icon} label={`Ícone ${ICON_LABELS[icon]}`} onClick={() => set({ icon })} />
            </span>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="worktree-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onDone}>
          Cancelar
        </button>
        <button type="submit" className="primary" disabled={!draft.command.trim()}>
          Salvar
        </button>
      </div>
    </form>
  )
}

export function SettingsDialog(props: {
  prefs: Preferences
  changePrefs(next: Preferences): void
  /** Projeto do ambiente aberto. Sem ele, não há comandos para mostrar. */
  projectId: string | null
  onClose(): void
}): ReactNode {
  const { prefs, changePrefs, projectId } = props
  const [commands, setCommands] = useState<CustomCommand[]>([])
  const [form, setForm] = useState<{ editing: CustomCommand | null } | null>(null)

  useEffect(() => {
    if (!projectId) return
    const load = (): void => void ide.listCommands(projectId).then(setCommands, () => setCommands([]))
    load()
    return ide.onCommandsChanged(load)
  }, [projectId])

  return (
    <div className="overlay">
      <div
        className="modal small settings-dialog"
        role="dialog"
        aria-label="Configurações"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          if (form) setForm(null)
          else props.onClose()
        }}
      >
        {form && projectId ? (
          <CommandForm projectId={projectId} editing={form.editing} onDone={() => setForm(null)} />
        ) : (
          <>
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
            </div>
            {projectId && (
              <section className="commands-section">
                <div className="commands-head">
                  <h3>Comandos</h3>
                  <IconButton icon="plus" label="Novo comando" onClick={() => setForm({ editing: null })} />
                </div>
                <ul className="command-list">
                  {commands.map((c) => (
                    <li key={c.id}>
                      <IconButton icon={c.icon} label={c.command} />
                      <span className="command-text">
                        <strong>{c.name || c.command}</strong>
                        {c.name && <code>{c.command}</code>}
                      </span>
                      <span className="command-scope">{c.scope === 'global' ? 'Todos' : 'Projeto'}</span>
                      <IconButton icon="pencil" label={`Editar ${c.name || c.command}`} onClick={() => setForm({ editing: c })} />
                      <IconButton icon="trash" label={`Apagar ${c.name || c.command}`} onClick={() => void ide.deleteCommand(projectId, c.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="modal-actions">
              <button type="button" className="primary" onClick={props.onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
