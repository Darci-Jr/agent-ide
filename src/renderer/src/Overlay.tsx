import type { ReactNode } from 'react'

/** Fundo dos modais: clicar fora do modal fecha. Pelo mousedown, para não fechar quando uma seleção de texto termina fora. */
export function Overlay(props: { onClose(): void; children: ReactNode }): ReactNode {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      {props.children}
    </div>
  )
}
