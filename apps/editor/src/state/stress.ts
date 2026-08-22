import {
  createEllipse,
  createRectangle,
  fromHex,
  translation,
  uniformCornerRadii,
  type SceneDocument,
} from '@figma-canvas/document'

/** Spread out enough that most of them are off screen at 100%, which is the point. */
const SPACING = 120
const SIZE = 80

const FILLS = ['#0a7cff', '#1a1a1a', '#8a8a8a', '#ffffff'] as const

/** `?stress=10000` in the URL. Zero when absent, which is the normal case. */
export function stressCountFromLocation(): number {
  const raw = new URLSearchParams(window.location.search).get('stress')
  if (raw === null) return 0
  const count = Number.parseInt(raw, 10)
  return Number.isFinite(count) && count > 0 ? Math.min(count, 200_000) : 0
}

/**
 * A square grid of alternating rectangles and ellipses, for measuring rather than for
 * looking at. Built in one transaction, so it is one version bump and one instance upload
 * rather than `count` of them.
 */
export function seedStressScene(document: SceneDocument, count: number): void {
  const columns = Math.ceil(Math.sqrt(count))
  const origin = -(columns * SPACING) / 2

  document.transact(() => {
    for (let index = 0; index < count; index += 1) {
      const column = index % columns
      const row = Math.floor(index / columns)
      const transform = translation(origin + column * SPACING, origin + row * SPACING)
      const fills = [fromHex(FILLS[index % FILLS.length] ?? '#0a7cff')]
      const size = { width: SIZE, height: SIZE }

      document.insert(
        index % 2 === 0
          ? createRectangle({ name: `R${index}`, transform, size, fills, cornerRadii: uniformCornerRadii(8) })
          : createEllipse({ name: `E${index}`, transform, size, fills }),
      )
    }
  })
}
