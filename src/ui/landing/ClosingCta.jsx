import Link from 'next/link'
import CreateBoardLink from './CreateBoardLink.jsx'
import { ArrowIcon } from '../site/icons.jsx'

export default function ClosingCta() {
  return (
    <section className="ls-section ls-section--end" aria-labelledby="cta-title">
      <div className="rs-wrap">
        <div className="ls-cta-band">
          <h2 id="cta-title">Ready to run your next session?</h2>
          <p>Create a board in a minute, or join one with the code you were sent.</p>
          <div className="ls-cta-actions">
            <CreateBoardLink className="rs-btn rs-btn--invert rs-btn--lg">Create a board<ArrowIcon /></CreateBoardLink>
            <Link className="rs-btn rs-btn--outline-invert rs-btn--lg" href="/join">Join with code</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
