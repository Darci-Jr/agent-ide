import type { ReactNode } from 'react'

const paths = {
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  collapse: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </>
  ),
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  terminal: <path d="M4 5l6 6-6 6M13 18h7" />,
  options: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5L20 7" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M4 15v5h16v-5" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 15v5h16v-5" />,
  sun: <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6L4.5 4.5M19.5 19.5L18 18M6 18l-1.5 1.5M19.5 4.5L18 6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  stop: <rect x="6" y="6" width="12" height="12" />,
  refresh: <path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" />
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function IconButton(props: {
  icon: IconName
  label: string
  onClick?: () => void
  className?: string
  disabled?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      className={`icon ${props.className ?? ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      // Dentro de uma aba, clicar no botão não pode iniciar um arraste.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick?.()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {paths[props.icon]}
      </svg>
    </button>
  )
}
