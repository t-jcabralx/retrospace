import Image from 'next/image'
import Link from 'next/link'
import { TOC, BOARD_TYPES, OWNER_STEPS, GUEST_STEPS, TOOLS, TIPS, STAGES, AI_STEPS, HELP } from './guideData.js'
import CreateBoardLink from '../landing/CreateBoardLink.jsx'
import { ArrowIcon } from '../site/icons.jsx'
import { STAGE_ICONS } from './StageIcons.jsx'
import { CreateIllustration, ShareIllustration, CollabIllustration } from '../landing/Illustrations.jsx'
import '../landing/landing.css' // the illustrations' own styles (ls-ill, ls-float)
import './guide.css'

const PHOTO = { Workshop: 'workshop', Celebration: 'celebration', Retro: 'retro', 'Team wall': 'wall' }

const Steps = ({ items }) => (
  <ol className="gd-steps">
    {items.map(([title, text], i) => (
      <li key={title}><span className="gd-num" aria-hidden="true">{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>
    ))}
  </ol>
)

// Steps on the left, a drawing on the right (stacked on a phone).
const Split = ({ art, children }) => <div className="gd-split"><div>{children}</div><div className="gd-art">{art}</div></div>

function Section({ id, eyebrow, title, children }) {
  return (
    <section id={id} className="gd-section" aria-labelledby={`${id}-t`}>
      <p className="gd-eyebrow">{eyebrow}</p>
      <h2 id={`${id}-t`}>{title}</h2>
      {children}
    </section>
  )
}

export default function Guide() {
  return (
    <div className="rs-wrap gd">
      <header className="gd-hero" id="start">
        <div className="gd-photo gd-photo--hero"><Image src="/photos/team.jpg" alt="" fill priority sizes="(min-width: 900px) 880px, 100vw" /></div>
        <p className="gd-eyebrow">User guide</p>
        <h1>How to use Retrospace</h1>
        <p className="gd-lede">One person creates a board and shares a six-character code. Everyone else joins with the code, with no account, and works together live on a laptop or a phone.</p>
        <div className="gd-cta">
          <CreateBoardLink className="rs-btn rs-btn--primary rs-btn--lg">Create a board<ArrowIcon /></CreateBoardLink>
          <Link className="rs-btn rs-btn--secondary rs-btn--lg" href="/join">Join with a code</Link>
        </div>
        <nav className="gd-toc" aria-label="On this page">
          {TOC.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <ul className="gd-types">
          {BOARD_TYPES.map(([name, text]) => (
            <li key={name}>
              <div className="gd-photo"><Image src={`/photos/${PHOTO[name]}.jpg`} alt="" fill sizes="(min-width: 720px) 430px, 100vw" /></div>
              <strong>{name}</strong><span>{text}</span>
            </li>
          ))}
        </ul>
      </header>

      <Section id="owner" eyebrow="For the owner" title="Create a board and share it"><Split art={<CreateIllustration />}><Steps items={OWNER_STEPS} /></Split></Section>
      <Section id="guest" eyebrow="For guests" title="Join with a code"><Split art={<ShareIllustration />}><Steps items={GUEST_STEPS} /></Split></Section>

      <Section id="board" eyebrow="On the board" title="The tools and everyday actions">
        <div className="gd-grid">
          {TOOLS.map(([name, text]) => <div key={name} className="gd-card"><h3>{name}</h3><p>{text}</p></div>)}
        </div>
        <Split art={<CollabIllustration />}><ul className="gd-tips">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul></Split>
      </Section>

      <Section id="stages" eyebrow="Retro boards" title="The seven stages, step by step">
        <p className="gd-intro">A Retro board is a guided meeting. The owner moves the whole team from one stage to the next with the stage bar at the top (Start, Next stage, Back, and +1 min on the timer). What guests can do depends on the stage, so nobody has to guess.</p>
        <ol className="gd-flow" aria-label="The stages in order">
          {STAGES.map((s, i) => <li key={s.key}><span>{i + 1}</span>{s.name}</li>)}
        </ol>
        <ol className="gd-stages">
          {STAGES.map((s, i) => (
            <li key={s.key} className="gd-stage">
              <div className="gd-stage-head">{(() => { const Icon = STAGE_ICONS[s.key]; return <span className="gd-stage-icon"><Icon /></span> })()}<h3><span className="gd-step-no">Stage {i + 1}</span>{s.name}</h3><span className="gd-time">{s.minutes}</span></div>
              <p className="gd-what">{s.what}</p>
              <dl>
                <div><dt>You (owner)</dt><dd>{s.owner}</dd></div>
                <div><dt>Guests</dt><dd>{s.guests}</dd></div>
              </dl>
              <p className="gd-tip"><strong>Remember:</strong> {s.tip}</p>
            </li>
          ))}
        </ol>
        <p className="gd-small">Timers are suggestions and can be changed or switched off in Settings, Stages. You can also skip a stage by switching it off there.</p>
      </Section>

      <Section id="anonymous" eyebrow="Privacy" title="Anonymous notes">
        <p className="gd-intro">On Retro boards the owner chooses a mode in Settings: <strong>optional</strong> (each person decides with the Post anonymously switch), <strong>always</strong>, or <strong>never</strong>.</p>
        <ul className="gd-tips">
          <li>An anonymous note shows an Anonymous badge. Its author is hidden from everyone, including the owner, on screen, in exports and in AI summaries.</li>
          <li>Only its author and the board owner can change or delete it.</li>
          <li>Removing a participant does not remove their anonymous notes, because nobody can tell which are theirs.</li>
        </ul>
      </Section>

      <Section id="ai" eyebrow="Optional" title="AI summary and themes">
        <p className="gd-intro">AI is off until the owner turns it on. It writes a draft that only the owner sees, and guests only ever see a summary the owner shares.</p>
        <ol className="gd-list">{AI_STEPS.map((t) => <li key={t}>{t}</li>)}</ol>
        <p className="gd-small">The report shows section cards plus two tables built from the board itself, Most voted and Action items. Always read an AI draft before sharing it.</p>
      </Section>

      <Section id="help" eyebrow="Help" title="Problems and quick fixes">
        <dl className="gd-help">
          {HELP.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
        </dl>
        <div className="gd-end"><CreateBoardLink className="rs-btn rs-btn--primary rs-btn--lg">Create your first board<ArrowIcon /></CreateBoardLink></div>
      </Section>
    </div>
  )
}
