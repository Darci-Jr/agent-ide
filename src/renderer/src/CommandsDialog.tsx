import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { COMMAND_ICONS, type CommandDraft, type CommandIcon, type CustomCommand } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { Overlay } from './Overlay'

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

/** Comandos que viram botões nas abas de terminal: os gerais e os do projeto do ambiente. */
export function CommandsDialog(props: { projectId: string; onClose(): void }): ReactNode {
  const { projectId } = props
  const [commands, setCommands] = useState<CustomCommand[]>([])
  const [form, setForm] = useState<{ editing: CustomCommand | null } | null>(null)

  useEffect(() => {
    const load = (): void => void ide.listCommands(projectId).then(setCommands, () => setCommands([]))
    load()
    return ide.onCommandsChanged(load)
  }, [projectId])

  return (
    <Overlay onClose={props.onClose}>
      <div
        className="modal small settings-dialog"
        role="dialog"
        aria-label="Comandos"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          if (form) setForm(null)
          else props.onClose()
        }}
      >
        {form ? (
          <CommandForm projectId={projectId} editing={form.editing} onDone={() => setForm(null)} />
        ) : (
          <>
            <div className="commands-head">
              <h2>Comandos</h2>
              <IconButton icon="plus" label="Novo comando" onClick={() => setForm({ editing: null })} />
            </div>
            {commands.length === 0 && <p className="commands-empty">Nenhum comando. Os comandos viram botões nas abas de terminal.</p>}
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
            <div className="modal-actions">
              <button type="button" className="primary" autoFocus onClick={props.onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  )
}
