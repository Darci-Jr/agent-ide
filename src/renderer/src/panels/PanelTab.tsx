import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FilePanelParams, TerminalPanelParams } from '../../../shared/types'
import { CommandButtons } from '../CommandButtons'
import { INTERRUPTED_TIP, useEnv } from '../context'
import { IconButton } from '../icons'

type Params = TerminalPanelParams | FilePanelParams

const stateLabel = (running: boolean, busy: boolean): string =>
  !running ? 'Parada' : busy ? 'Ativa' : 'Ociosa'

export function PanelTab({ api, params }: IDockviewPanelHeaderProps<Params>): ReactNode {
  const { env, states, focusId, setFocus, closePanel, renameSession, acknowledgeSession, commands, runCommand } = useEnv()
  const [title, setTitle] = useState(api.title ?? '')
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const focused = focusId === api.id

  useEffect(() => {
    const sub = api.onDidTitleChange((e) => setTitle(e.title))
    return () => sub.dispose()
  }, [api])

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const sessionId = params.kind === 'terminal' ? params.sessionId : null
  const session = sessionId ? env.sessions.find((s) => s.id === sessionId) : null
  const state = sessionId ? states.get(sessionId) : null
  // Nas abas do Claude não: os comandos ficam na aba do ambiente e nunca vão para o prompt.
  const tabCommands = session?.adapterId === 'shell' ? commands : []
  const commit = (): void => {
    setEditing(false)
    const next = input.current?.value.trim()
    if (sessionId && next && next !== title) renameSession(sessionId, next)
  }

  return (
    <div className="panel-tab" title={session?.worktreeBranch}>
      <IconButton
        icon={focused ? 'collapse' : 'expand'}
        label={focused ? 'Voltar à visão geral' : 'Destacar'}
        onClick={() => setFocus(focused ? null : api.id)}
      />
      {editing ? (
        <input
          ref={input}
          className="tab-rename"
          aria-label="Nome da sessão"
          defaultValue={title}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="tab-title" onDoubleClick={() => sessionId && setEditing(true)}>
          {title}
        </span>
      )}
      {sessionId && session?.interrupted && (
        <button
          type="button"
          className="tab-attention"
          data-tip={`${INTERRUPTED_TIP} Clique para dispensar.`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            acknowledgeSession(sessionId)
          }}
        >
          ! Atenção
        </button>
      )}
      {sessionId && (
        <span className={`tab-state ${state?.running ? (state.busy ? 'busy' : 'idle') : 'stopped'}`}>
          {stateLabel(state?.running ?? false, state?.busy ?? false)}
        </span>
      )}
      <IconButton icon="close" label="Fechar" className="tab-close" onClick={() => closePanel(api.id)} />
      <CommandButtons commands={tabCommands} onRun={runCommand} />
    </div>
  )
}
