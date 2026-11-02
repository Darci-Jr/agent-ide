import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CustomCommand, FilePanelParams, TerminalPanelParams } from '../../../shared/types'
import { INTERRUPTED_TIP, useEnv } from '../context'
import { IconButton } from '../icons'
import { ide } from '../ide'

type Params = TerminalPanelParams | FilePanelParams

/** Botões visíveis na aba; os demais ficam no menu, para a aba não estourar. */
const VISIBLE_COMMANDS = 4

const stateLabel = (running: boolean, busy: boolean): string =>
  !running ? 'Parada' : busy ? 'Ativa' : 'Ociosa'

const commandTip = (c: CustomCommand): string => (c.name ? `${c.name}: ${c.command}` : c.command)

export function PanelTab({ api, params }: IDockviewPanelHeaderProps<Params>): ReactNode {
  const { env, states, focusId, setFocus, closePanel, renameSession, acknowledgeSession, commands } = useEnv()
  const [title, setTitle] = useState(api.title ?? '')
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLSpanElement>(null)
  const [menuAt, setMenuAt] = useState({ left: 0, top: 0 })
  const focused = focusId === api.id

  useEffect(() => {
    const sub = api.onDidTitleChange((e) => setTitle(e.title))
    return () => sub.dispose()
  }, [api])

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    // Na captura, porque os botões da aba interrompem a propagação do clique.
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [menuOpen])

  const sessionId = params.kind === 'terminal' ? params.sessionId : null
  const session = sessionId ? env.sessions.find((s) => s.id === sessionId) : null
  const state = sessionId ? states.get(sessionId) : null
  // Comandos são de terminal: nunca vão para o prompt de uma sessão do Claude.
  const tabCommands = session?.adapterId === 'shell' ? commands : []
  const running = state?.running ?? false

  const run = (c: CustomCommand): void => {
    setMenuOpen(false)
    if (sessionId) ide.write(sessionId, `${c.command}\r`)
  }

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
      {tabCommands.length > 0 && (
        <span className="tab-commands">
          {tabCommands.slice(0, VISIBLE_COMMANDS).map((c) => (
            <IconButton key={c.id} icon={c.icon} label={commandTip(c)} disabled={!running} onClick={() => run(c)} />
          ))}
          {tabCommands.length > VISIBLE_COMMANDS && (
            <span ref={moreRef} className="tab-command-more">
              <IconButton
                icon="more"
                label="Mais comandos"
                disabled={!running}
                onClick={() => {
                  const box = moreRef.current?.getBoundingClientRect()
                  if (box) setMenuAt({ left: box.left, top: box.bottom + 2 })
                  setMenuOpen(!menuOpen)
                }}
              />
              {/* No body: a barra de abas corta o que passa dela. */}
              {menuOpen &&
                createPortal(
                  <div ref={menuRef} className="tab-command-menu" role="menu" style={menuAt}>
                    {tabCommands.slice(VISIBLE_COMMANDS).map((c) => (
                      <button key={c.id} type="button" role="menuitem" data-tip={c.command} onClick={() => run(c)}>
                        {c.name || c.command}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
