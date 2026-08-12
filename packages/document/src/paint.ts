/**
 * Channels are 0..1 rather than 0..255 because that is what the GPU wants. Converting
 * per frame for every node is waste, so the document stores the GPU-native form and the
 * panels convert on the way in and out.
 */
export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface SolidPaint {
  type: 'solid'
  color: RGBA
}

export type Paint = SolidPaint

export type StrokeAlign = 'inside' | 'outside' | 'center'

export interface Stroke {
  paint: Paint
  weight: number
  align: StrokeAlign
}

export function solid(r: number, g: number, b: number, a = 1): SolidPaint {
  return { type: 'solid', color: { r, g, b, a } }
}

export function fromHex(hex: string, a = 1): SolidPaint {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const int = Number.parseInt(full, 16)
  return solid(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255, a)
}

export function toHex(color: RGBA): string {
  const channel = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}
