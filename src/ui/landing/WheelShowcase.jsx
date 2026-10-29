import Link from 'next/link'
import { WheelArt } from './Illustrations.jsx'
import CreateBoardLink from './CreateBoardLink.jsx'
import { ArrowIcon } from '../site/icons.jsx'

const POINTS = [
  ['Two steps, no arguments', 'Spin for the prize, then spin for who wins it. The server picks every result, so nobody can say it was rigged.'],
  ['Everyone sees the same spin', 'Guests watch the wheel turn on their own screen at the same moment, then the winner is revealed.'],
  ['Your own celebration', 'Confetti, fireworks or balloons, or a Giphy GIF for every winner or for one prize.'],
  ['Helpers and a record', 'Name people who can run the draw with you, take winners off the wheel, undo a result, and download the history.'],
]

export default function WheelShowcase() {
  return (
    <section className="ls-section ls-section--tint" aria-labelledby="wheel-title">
      <div className="rs-wrap ls-wheel-grid">
        <div className="ls-wheel-copy">
          <p className="ls-eyebrow">Event board</p>
          <h2 id="wheel-title" className="ls-h2">Raffles and give-aways with a prize wheel</h2>
          <p className="ls-lede">People go on the outer ring and prizes on the inner ring. Run the draw live at your event, on a projector or a phone.</p>
          <ul className="ls-wheel-points">
            {POINTS.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}
          </ul>
          <div className="ls-wheel-actions">
            <CreateBoardLink className="rs-btn rs-btn--primary rs-btn--lg">Create an Event board<ArrowIcon /></CreateBoardLink>
            <Link className="rs-btn rs-btn--secondary rs-btn--lg" href="/guide#wheel">How the wheel works</Link>
          </div>
        </div>
        <div className="ls-wheel-art"><WheelArt /></div>
      </div>
    </section>
  )
}
