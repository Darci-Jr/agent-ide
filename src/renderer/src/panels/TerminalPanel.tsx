import type { IDockviewPanelProps } from 'dockview-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { TerminalPanelParams } from '../../../shared/types'
import { useEnv } from '../context'
import { attachTerminal, focusTerminal } from '../terminals'

export function TerminalPanel({ params }: IDockviewPanelProps<TerminalPanelParams>): ReactNode {
  const { env, states, startSession } = useEnv()
  const container = useRef<HTMLDivElement>(null)
  const { sessionId } = params
  const session = env.sessions.find((s) => s.id === sessionId)
  const running = states.get(sessionId)?.running ?? false

  useEffect(() => {
    if (container.current) attachTerminal(sessionId, container.current)
  }, [sessionId])

  return (
    <div className="terminal-panel" onMouseDown={() => focusTerminal(sessionId)}>
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
