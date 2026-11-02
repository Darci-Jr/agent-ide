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
  worktree: <path d="M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a9 9 0 0 1-9 9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  git: <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12zM9 8.5l3 3M12 11.5v4.5M12 11.5l3-3" />,
  play: <path d="M7 4l13 8-13 8z" />,
  flask: <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10" />,
  hammer: <path d="M14 7l-9.5 9.5a2 2 0 0 0 3 3L17 10M12 5l4-2 5 5-2 4z" />,
  bug: <path d="M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM12 9v10M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2M9 5l1 2M15 5l-1 2" />,
  rocket: <path d="M5 15c-1 1-1.5 4-1.5 4s3-.5 4-1.5M9 15l-3-3c1-4 4-8 13-9-1 9-5 12-9 13zM14.5 9.5h.01M9 12l-3 0-2 2 4 1M12 15v3l-2 2-1-4" />,
  broom: <path d="M19 3l-7 7M9 11l4 4M9 11c-3 0-5 2-6 8 2 0 4 1 6 1 4 0 6-3 6-5z" />,
  package: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9M8 5.2l8 4.6" />,
  database: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z" />,
  commands: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  plugins: <path d="M9 4h6v3a2 2 0 1 0 0 0h4v5h-3a2 2 0 1 0 0 4h3v4H5v-4h3a2 2 0 1 0 0-4H5V7h4z" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5L20 7" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M4 15v5h16v-5" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 15v5h16v-5" />,
  sun: <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6L4.5 4.5M19.5 19.5L18 18M6 18l-1.5 1.5M19.5 4.5L18 6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  stop: <rect x="6" y="6" width="12" height="12" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />,
  back: <path d="M11 5l-7 7 7 7M4 12h16" />,
  home: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />,
  openFolder: <path d="M3 19V6h6l2 2h8v3M3 19l3-8h15l-3 8z" />,
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
      data-tip={props.label}
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
