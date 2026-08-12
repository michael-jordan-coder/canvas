import type { ReactElement } from 'react'

export interface IconProps {
  size?: number
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function Svg({ size = 16, children }: IconProps & { children: ReactElement }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

export function MoveIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M4 2.5 12 8.2l-3.5.8L7 12.8z" />
    </Svg>
  )
}

export function HandIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M5 8V4.2a1 1 0 0 1 2 0V8m0-.6V3.2a1 1 0 0 1 2 0V8m0-.6V4.2a1 1 0 0 1 2 0V9m0-2.2a1 1 0 0 1 2 0v3.6a3.2 3.2 0 0 1-3.2 3.2H8a3 3 0 0 1-3-3V8" />
    </Svg>
  )
}

export function FrameIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M4.5 2v12M11.5 2v12M2 4.5h12M2 11.5h12" />
    </Svg>
  )
}

export function RectangleIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <rect {...stroke} x="2.5" y="3.5" width="11" height="9" rx="1" />
    </Svg>
  )
}

export function EllipseIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <circle {...stroke} cx="8" cy="8" r="5.5" />
    </Svg>
  )
}

export function DownloadIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 2.5v7.5m0 0L5 7.2M8 10l3-2.8M2.8 12.2v1.3h10.4v-1.3" />
    </Svg>
  )
}

export function UploadIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 10.5V3m0 0L5 5.8M8 3l3 2.8M2.8 12.2v1.3h10.4v-1.3" />
    </Svg>
  )
}

export function VisibleIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M1.8 8S4.2 4.2 8 4.2 14.2 8 14.2 8 11.8 11.8 8 11.8 1.8 8 1.8 8Z" />
        <circle {...stroke} cx="8" cy="8" r="1.6" />
      </g>
    </Svg>
  )
}

export function HiddenIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M2.6 5.6C1.9 6.6 1.8 8 1.8 8S4.2 11.8 8 11.8c1 0 1.9-.3 2.7-.7M13 9.9c.9-1 1.2-1.9 1.2-1.9S11.8 4.2 8 4.2c-.5 0-1 .1-1.4.2" />
        <path {...stroke} d="M3 3l10 10" />
      </g>
    </Svg>
  )
}
