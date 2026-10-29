import { CursorsIcon, MaskIcon, VoteIcon, KeyIcon, PartyIcon, SmileIcon, SparkIcon, LayoutIcon } from '../site/icons.jsx'

const FEATURES = [
  { Icon: CursorsIcon, title: 'Live collaboration', text: 'See everyone’s cursor and every change as it happens, so the whole room works on one board.' },
  { Icon: MaskIcon, title: 'Anonymous by default', text: 'Guests get a friendly generated name and avatar, or choose their own. Nobody has to sign up.' },
  { Icon: VoteIcon, title: 'Voting and timers', text: 'Let people vote on what matters and keep a session on schedule with a shared timer.' },
  { Icon: KeyIcon, title: 'Join by code', text: 'Share a six-character code, with an optional passcode. Close or revoke access whenever you like.' },
  { Icon: PartyIcon, title: 'Celebration reveal', text: 'Reveal everything at once on the recipient page, with confetti and GIFs.' },
  { Icon: SmileIcon, title: 'Throwable emoji', text: 'Let the room toss a banana or a rose at an idea. Off until the owner turns it on.' },
  { Icon: PartyIcon, title: 'Prize wheel', text: 'Run a raffle with a live two-step draw, helpers who can spin, and your own GIF or effect for winners.' },
  { Icon: SparkIcon, title: 'AI summary', text: 'Optionally draft a summary of the session. The owner reviews it before it is shared.' },
  { Icon: LayoutIcon, title: 'Ready-made templates', text: 'Start from a retrospective, brainstorm or SWOT layout, or one of eight celebration occasions.' },
]

export default function Features() {
  return (
    <section id="features" className="ls-section ls-section--tint" aria-labelledby="features-title">
      <div className="rs-wrap">
        <header className="ls-head">
          <p className="ls-eyebrow">Features</p>
          <h2 id="features-title" className="ls-h2">Everything a live session needs</h2>
          <p className="ls-lede">Simple for guests to join, with the controls owners expect.</p>
        </header>
        <ul className="ls-features">
          {FEATURES.map(({ Icon, title, text }) => (
            <li key={title} className="ls-feature">
              <span className="ls-tile"><Icon /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
