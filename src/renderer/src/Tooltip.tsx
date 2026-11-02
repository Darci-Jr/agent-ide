import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const SHOW_DELAY_MS = 150
const GAP = 6

interface Tip {
  text: string
  target: DOMRect
}

/**
 * A dica nativa do navegador demora a aparecer e parece ausente. Esta é única para
 * o app inteiro e fica em posição fixa, então painéis com rolagem não a cortam.
 */
export function Tooltip(): ReactNode {
  const [tip, setTip] = useState<Tip | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pressedAt = 0
    const show = (e: Event): void => {
      clearTimeout(timer)
      // O clique também dá foco ao botão: sem isto, a dica voltaria por cima de um menu recém-aberto.
      if (e.type === 'focusin' && Date.now() - pressedAt < 300) return
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (!el) {
        setTip(null)
        return
      }
      const text = el.getAttribute('data-tip') ?? ''
      const target = el.getBoundingClientRect()
      // O teclado não espera: quem navega com Tab precisa da dica na hora.
      timer = setTimeout(() => setTip({ text, target }), e.type === 'focusin' ? 0 : SHOW_DELAY_MS)
    }
    const hide = (e: Event): void => {
      if (e.type === 'mousedown') pressedAt = Date.now()
      clearTimeout(timer)
      setTip(null)
    }
    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    // Em captura: os ícones interrompem a propagação do clique para não iniciar arrastes.
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !box.current) return
    const { width, height } = box.current.getBoundingClientRect()
    const { target } = tip
    // Na barra lateral a dica fica à direita; nos demais casos, abaixo do ícone.
    const beside = target.left < 60
    const left = beside ? target.right + GAP : target.left + target.width / 2 - width / 2
    const top = beside ? target.top + target.height / 2 - height / 2 : target.bottom + GAP
    setPosition({
      left: Math.max(4, Math.min(left, window.innerWidth - width - 4)),
      top: top + height > window.innerHeight - 4 ? target.top - height - GAP : top
    })
  }, [tip])

  if (!tip) return null
  return (
    <div ref={box} className="tooltip" role="tooltip" style={position}>
      {tip.text}
    </div>
  )
}
