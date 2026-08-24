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

export function TextIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M3 4V3h10v1M8 3v10M5.5 13h5" />
    </Svg>
  )
}

export function CodeIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M5.5 5 3 8l2.5 3M10.5 5 13 8l-2.5 3M9 4.5l-2 7" />
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

export function ChevronIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M6 4.5 9.5 8 6 11.5" />
    </Svg>
  )
}

/*
 * Collapse all: two chevrons folding toward the line between them.
 *
 * Not the row chevron repeated. That one points the way a row will open and is rotated by
 * CSS to say which state it is in, so reusing it here would read as one row's control that
 * had drifted into the header.
 */
export function CollapseAllIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M4.5 3 8 6.5 11.5 3" />
        <path {...stroke} d="M4.5 13 8 9.5 11.5 13" />
      </g>
    </Svg>
  )
}

export function LockedIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <rect {...stroke} x="3.5" y="7" width="9" height="6.5" rx="1" />
        <path {...stroke} d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
      </g>
    </Svg>
  )
}

export function UnlockedIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <rect {...stroke} x="3.5" y="7" width="9" height="6.5" rx="1" />
        <path {...stroke} d="M5.5 7V5.2a2.5 2.5 0 0 1 4.9-.7" />
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

/*
 * Align, distribute and flip. Each pair of rectangles sits against the guide line the way
 * the command leaves them, so the icon shows the result rather than a symbol for it.
 */

export function AlignLeftIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M3 2v12" />
        <rect {...stroke} x="3" y="4" width="7" height="3" />
        <rect {...stroke} x="3" y="9" width="4" height="3" />
      </g>
    </Svg>
  )
}

export function AlignCenterXIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M8 2v12" />
        <rect {...stroke} x="5" y="4" width="6" height="3" />
        <rect {...stroke} x="6.5" y="9" width="3" height="3" />
      </g>
    </Svg>
  )
}

export function AlignRightIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M13 2v12" />
        <rect {...stroke} x="6" y="4" width="7" height="3" />
        <rect {...stroke} x="9" y="9" width="4" height="3" />
      </g>
    </Svg>
  )
}

export function AlignTopIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M2 3h12" />
        <rect {...stroke} x="4" y="3" width="3" height="7" />
        <rect {...stroke} x="9" y="3" width="3" height="4" />
      </g>
    </Svg>
  )
}

export function AlignCenterYIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M2 8h12" />
        <rect {...stroke} x="4" y="5" width="3" height="6" />
        <rect {...stroke} x="9" y="6.5" width="3" height="3" />
      </g>
    </Svg>
  )
}

export function AlignBottomIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M2 13h12" />
        <rect {...stroke} x="4" y="6" width="3" height="7" />
        <rect {...stroke} x="9" y="9" width="3" height="4" />
      </g>
    </Svg>
  )
}

export function DistributeHorizontalIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <rect {...stroke} x="2" y="4" width="2.5" height="8" />
        <rect {...stroke} x="6.75" y="4" width="2.5" height="8" />
        <rect {...stroke} x="11.5" y="4" width="2.5" height="8" />
      </g>
    </Svg>
  )
}

export function DistributeVerticalIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <rect {...stroke} x="4" y="2" width="8" height="2.5" />
        <rect {...stroke} x="4" y="6.75" width="8" height="2.5" />
        <rect {...stroke} x="4" y="11.5" width="8" height="2.5" />
      </g>
    </Svg>
  )
}

export function FlipHorizontalIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M8 2v12" strokeDasharray="1.4 1.4" />
        <path {...stroke} d="M2.5 5v6l4-3z" />
        <path {...stroke} d="M13.5 5v6l-4-3z" />
      </g>
    </Svg>
  )
}

export function FlipVerticalIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M2 8h12" strokeDasharray="1.4 1.4" />
        <path {...stroke} d="M5 2.5h6l-3 4z" />
        <path {...stroke} d="M5 13.5h6l-3-4z" />
      </g>
    </Svg>
  )
}

/** Toggles the corner radius field between one value and four, one bracket per corner. */
export function CornersIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M3 6V3h3" />
        <path {...stroke} d="M13 6V3h-3" />
        <path {...stroke} d="M3 10v3h3" />
        <path {...stroke} d="M13 10v3h-3" />
      </g>
    </Svg>
  )
}

/*
 * Field labels for the number fields: each shows the measurement it stands for, drawn in
 * the same 1.25 stroke as the toolbar so a label and a button read as one family.
 */

export function AngleIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M12.5 12.5H3.5V3.5" />
        <path {...stroke} d="M8.5 12.5a5 5 0 0 0-5-5" />
      </g>
    </Svg>
  )
}

export function RadiusIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M3.5 12.5v-4a5 5 0 0 1 5-5h4" />
    </Svg>
  )
}

export function OpacityIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <circle {...stroke} cx="6.2" cy="8" r="4.4" />
        <path {...stroke} d="M9.8 3.7a4.4 4.4 0 0 1 0 8.6" strokeDasharray="1.6 1.7" />
      </g>
    </Svg>
  )
}

export function GapIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M4 3v10M12 3v10" />
        <path {...stroke} d="M6.5 8h3" />
      </g>
    </Svg>
  )
}

export function PaddingXIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M3 3.5v9M13 3.5v9" />
        <rect {...stroke} x="6.25" y="6.25" width="3.5" height="3.5" />
      </g>
    </Svg>
  )
}

export function PaddingYIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M3.5 3h9M3.5 13h9" />
        <rect {...stroke} x="6.25" y="6.25" width="3.5" height="3.5" />
      </g>
    </Svg>
  )
}

export function ArrowRightIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M3 8h10m0 0L9.5 4.5M13 8l-3.5 3.5" />
    </Svg>
  )
}

export function ArrowDownIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 3v10m0 0 3.5-3.5M8 13 4.5 9.5" />
    </Svg>
  )
}

/** Space between: children pushed to the ends of the axis. */
export function SpaceBetweenIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <g>
        <path {...stroke} d="M3 3v10M13 3v10" />
        <rect {...stroke} x="4.75" y="5.5" width="2" height="5" />
        <rect {...stroke} x="9.25" y="5.5" width="2" height="5" />
      </g>
    </Svg>
  )
}

export function MinusIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M3.5 8h9" />
    </Svg>
  )
}

export function AssistantIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 2.5 9.4 6.6 13.5 8 9.4 9.4 8 13.5 6.6 9.4 2.5 8 6.6 6.6z" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 3.5v9M3.5 8h9" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="m4.5 4.5 7 7m0-7-7 7" />
    </Svg>
  )
}

export function SendIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7" />
    </Svg>
  )
}

export function PlayIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...stroke} d="M5.5 4 11.5 8 5.5 12z" />
    </Svg>
  )
}

export function StopIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <rect {...stroke} x="4.5" y="4.5" width="7" height="7" />
    </Svg>
  )
}
