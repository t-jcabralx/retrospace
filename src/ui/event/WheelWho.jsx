'use client'
// Everyone and everything on the wheel, written out in full beside its colour. The wheel itself shortens names and prizes when
// there are many of them; this list never does, so nobody has to squint at a slice to find a name.
import { SOFT, shade } from './WheelSvg.jsx'

export default function WheelWho({ people, prizes }) {
  if (!people.length && !prizes.length) return null
  const n = people.length
  return (
    <details className="ev-who">
      <summary>Everyone on the wheel ({n} {n === 1 ? 'person' : 'people'}, {prizes.length} {prizes.length === 1 ? 'prize' : 'prizes'})</summary>
      <div className="ev-who-grid">
        {prizes.length > 0 && (
          <section aria-label="Prizes">
            <h4>Prizes</h4>
            <ul>
              {prizes.map((z) => (
                <li key={z.id}><i className="ev-who-dot" style={{ background: z.color }} aria-hidden="true" /><span>{z.emoji ? `${z.emoji} ` : ''}{z.name}{z.qty > 1 ? ` ×${z.qty}` : ''}</span></li>
              ))}
            </ul>
          </section>
        )}
        {n > 0 && (
          <section aria-label="People">
            <h4>People</h4>
            <ul>
              {people.map((p, i) => (
                <li key={p.id}><i className="ev-who-dot" style={{ background: SOFT[shade(i, n, SOFT.length)] }} aria-hidden="true" /><span>{p.name}</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  )
}
