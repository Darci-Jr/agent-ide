import type { IDockviewPanelProps } from 'dockview-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { TerminalPanelParams } from '../../../shared/types'
import { useEnv } from '../context'
import { attachTerminal, focusTerminal } from '../terminals'

export function TerminalPanel({ api, params }: IDockviewPanelProps<TerminalPanelParams>): ReactNode {
  const { env, states, startSession, acknowledgeSession } = useEnv()
  const container = useRef<HTMLDivElement>(null)
  const { sessionId } = params
  const session = env.sessions.find((s) => s.id === sessionId)
  const running = states.get(sessionId)?.running ?? false

  useEffect(() => {
    if (container.current) attachTerminal(sessionId, container.current)
  }, [sessionId])

  // Na captura, porque o xterm interrompe a propagação das teclas que trata.
  const answered = (): void => {
    if (session?.interrupted) acknowledgeSession(sessionId)
  }

  return (
    <div
      className="terminal-panel"
      onMouseDown={() => {
        // O xterm não avisa o dockview: sem isto, a sessão clicada não vira a atual.
        api.setActive()
        focusTerminal(sessionId)
      }}
      onPasteCapture={answered}
      onKeyDownCapture={(e) => {
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) answered()
      }}
    >
      <div ref={container} className="terminal-slot" />
      {!running && (
        <div className="terminal-stopped">
          <button type="button" className="primary" onClick={() => startSession(sessionId)}>
            {session?.started ? 'Retomar' : 'Iniciar'}
          </button>
        </div>
      )}
    </div>
  )
}
