import { useState, type ReactElement } from 'react'

export interface CardProps {
  title?: string
  body?: string
  elevated?: boolean
  collapsible?: boolean
}

/**
 * A titled panel with an optional body it can fold away.
 *
 * Collapsing is React state, so a card left folded stays folded while the canvas is panned
 * and zoomed around it, and unfolds again with no help from the document. Nothing about
 * which is written down: the scene knows the title, the body and the two flags, and that is
 * all the design there is to save.
 */
export function Card({
  title = 'Card title',
  body = 'Supporting copy that explains what this card is for.',
  elevated = false,
  collapsible = false,
}: CardProps): ReactElement {
  const [open, setOpen] = useState(true)

  return (
    <section className="card" data-elevated={elevated}>
      <header className="cardHeader">
        <h3 className="cardTitle">{title}</h3>
        {collapsible && (
          <button type="button" className="cardToggle" onClick={() => setOpen((was) => !was)}>
            {open ? 'Hide' : 'Show'}
          </button>
        )}
      </header>
      {open && body && <p className="cardBody">{body}</p>}
    </section>
  )
}
