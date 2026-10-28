import JoinBox from './JoinBox.jsx'
import BoardPreview from './BoardPreview.jsx'
import CreateBoardLink from './CreateBoardLink.jsx'
import { ArrowIcon } from '../site/icons.jsx'

export default function Hero() {
  return (
    <section className="ls-hero" aria-labelledby="hero-title">
      <div className="ls-hero-bg" aria-hidden="true" />
      <div className="rs-wrap ls-hero-grid">
        <div className="ls-hero-copy">
          <h1 id="hero-title">Retrospectives, workshops and celebrations your whole team can join in seconds</h1>
          <p className="ls-sub">Start a live board, share a six-character code, and everyone joins as a guest with no account and nothing to install.</p>
          <div className="ls-cta">
            <CreateBoardLink className="rs-btn rs-btn--primary rs-btn--lg">Create a board<ArrowIcon /></CreateBoardLink>
            <p className="ls-or"><span>or join a board that is already running</span></p>
            <div className="ls-joincard"><JoinBox /></div>
          </div>
        </div>
        <div className="ls-hero-art"><BoardPreview /></div>
      </div>
    </section>
  )
}
