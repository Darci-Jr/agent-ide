import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CustomCommand } from '../../shared/types'
import { IconButton } from './icons'

/** Botões visíveis; os demais ficam no menu, para a aba não estourar. */
const VISIBLE_COMMANDS = 4

const commandTip = (c: CustomCommand): string => `${c.name ? `${c.name}: ${c.command}` : c.command} (em um terminal novo)`

/** Botões dos comandos personalizados. Cada clique abre um terminal novo e executa o comando nele. */
export function CommandButtons(props: { commands: CustomCommand[]; onRun(command: CustomCommand): void }): ReactNode {
  const { commands } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAt, setMenuAt] = useState({ left: 0, top: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    // Na captura, porque os botões das abas interrompem a propagação do clique.
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [menuOpen])

  if (commands.length === 0) return null

  const run = (c: CustomCommand): void => {
    setMenuOpen(false)
    props.onRun(c)
  }

  return (
    <span className="tab-commands">
      {commands.slice(0, VISIBLE_COMMANDS).map((c) => (
        <IconButton key={c.id} icon={c.icon} label={commandTip(c)} onClick={() => run(c)} />
      ))}
      {commands.length > VISIBLE_COMMANDS && (
        <span ref={moreRef} className="tab-command-more">
          <IconButton
            icon="more"
            label="Mais comandos"
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
                {commands.slice(VISIBLE_COMMANDS).map((c) => (
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
  )
}
