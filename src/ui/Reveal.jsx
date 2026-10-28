'use client'
// The recipient's page: countdown (until the reveal time) -> intro (their name and the celebration) -> slides (one card at
// a time) -> the end (see the whole board, or replay). It is a read-only view: no guest identity, no persona, no writes.
// While the reveal time is ahead, the page holds the board's details only (see useReveal); the owner skips the gate and
// sees an "Owner preview" banner instead.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import PasscodePanel from './PasscodePanel.jsx'
import PanelLinks from './PanelLinks.jsx'
import Slideshow from './Slideshow.jsx'
import { EffectsProvider, useEffects } from './Effects.jsx'
import { useReveal } from './useReveal.js'
import { useReducedMotion } from './useReducedMotion.js'
import { revealPhase, revealEffect, firstName, revealStage } from './revealPhase.js'
import { countdownParts, pad2, announceBucket, announcementText, countdownSentence } from './countdown.js'
import { describeReveal } from './revealTime.js'
import { getTemplate } from '../lib/templates.js'
import './board.css'
import './cards.css'
import './reveal.css'

const INTRO_MS = 4000

function Panel({ title, children }) {
  return (
    <main className="bd-panel-screen">
      <div className="bd-panel">
        <h1>{title}</h1>
        {children}
        <PanelLinks />
      </div>
    </main>
  )
}

export default function Reveal({ code }) {
  return <EffectsProvider><RevealView code={code} /></EffectsProvider>
}

// Calls `onElapsed` once the reveal moment has come on the server's clock; ticks the display four times a second.
function Countdown({ board, name, clock, onElapsed }) {
  const [now, setNow] = useState(() => clock.now())
  const head = useRef(null)
  const spoken = useRef('')
  const [said, setSaid] = useState('')
  const [sentence, setSentence] = useState('') // the whole time left in words; changes only with the announcement buckets
  const at = Date.parse(board.revealAt)
  const left = at - now

  useEffect(() => { head.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(clock.now()), 250)
    return () => clearInterval(t)
  }, [clock])
  useEffect(() => { if (left <= 0) onElapsed() }, [left, onElapsed])
  const bucket = announceBucket(left)
  useEffect(() => { spoken.current = '' }, [board.revealAt]) // a new reveal time is said again at once
  useEffect(() => {
    if (spoken.current === bucket.key) return
    spoken.current = bucket.key
    setSaid(announcementText(bucket))
    setSentence(countdownSentence(left))
  }, [bucket, left])

  const p = countdownParts(left)
  const units = [[p.days, 'days'], [p.hours, 'hours'], [p.minutes, 'minutes'], [p.seconds, 'seconds']]
  const emoji = getTemplate(board.type, board.template)?.emoji
  return (
    <main className="rv-center rv-count-screen">
      {emoji && <p className="rv-emoji" aria-hidden="true">{emoji}</p>}
      <h1 ref={head} tabIndex={-1} className="rv-h">Something special is waiting for you{name ? `, ${name}` : ''}</h1>
      <p className="rv-sub">{board.title}</p>
      <div className="rv-clock" role="timer" aria-label="Time until the reveal">
        <span className="bd-vh">{sentence}</span>
        {units.map(([n, label]) => (
          <div key={label} className="rv-unit" aria-hidden="true"><span className="rv-num">{pad2(n)}</span><span className="rv-lab">{label}</span></div>
        ))}
      </div>
      <p className="rv-when">{describeReveal(board.revealAt, now)}</p>
      <p className="bd-vh" role="status" aria-live="polite">{said}</p>
    </main>
  )
}

function Intro({ board, count, onDone }) {
  const head = useRef(null)
  const fx = useEffects()
  const name = board.recipient?.name
  const emoji = getTemplate(board.type, board.template)?.emoji
  // The intro starts once: the effect fires and the 4 s clock runs from mount. A data refresh (the owner editing the theme or
  // the name, a new card arriving) must neither fire the effect again nor restart the clock, so the effect reads the latest
  // values through a ref and has no dependencies. Replay mounts a new Intro, which starts over.
  const latest = useRef(null)
  latest.current = { fx, effect: revealEffect(board), name, onDone }
  useEffect(() => {
    const { fx: f, effect, name: who } = latest.current
    head.current?.focus({ preventScroll: true })
    f.fire(effect, { announce: who ? `This celebration is for ${who}` : 'A celebration for you' })
    const t = setTimeout(() => latest.current.onDone(), INTRO_MS)
    function onKey(e) {
      if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && e.target.tagName !== 'BUTTON')) { e.preventDefault(); latest.current.onDone() }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [])
  return (
    <main className="rv-center rv-intro">
      {emoji && <p className="rv-emoji is-big" aria-hidden="true">{emoji}</p>}
      <h1 ref={head} tabIndex={-1} className="rv-name">{name ?? board.title}</h1>
      {count > 0 && <p className="rv-sub">{count === 1 ? '1 message' : `${count} messages`} from people who care about you</p>}
      <button type="button" className="rv-btn" onClick={onDone}>Skip</button>
    </main>
  )
}

function End({ board, code, count, onReplay }) {
  const head = useRef(null)
  const name = firstName(board.recipient)
  useEffect(() => { head.current?.focus({ preventScroll: true }) }, [])
  return (
    <main className="rv-center">
      <p className="rv-emoji" aria-hidden="true">💛</p>
      <h1 ref={head} tabIndex={-1} className="rv-h">{count === 0 ? 'That is everything for now' : `That was all ${count === 1 ? 'one card' : `${count} cards`}${name ? `, ${name}` : ''}`}</h1>
      <p className="rv-sub">Thank you for watching. You can look at the whole board too.</p>
      <div className="rv-actions">
        <Link className="rv-btn is-primary" href={`/b/${code}?view=1`}>See the whole board</Link>
        <button type="button" className="rv-btn" onClick={onReplay}>Replay</button>
      </div>
    </main>
  )
}

function RevealView({ code }) {
  const rv = useReveal(code)
  const reduced = useReducedMotion()
  const [step, setStep] = useState('intro')
  const [, force] = useReducer((n) => n + 1, 0)
  const { board, role, cards, loaded, clock } = rv

  useEffect(() => { if (board?.title) document.title = `${board.title} · Retrospace` }, [board?.title])
  const toSlides = useCallback(() => setStep('slides'), [])

  if (rv.phase === 'missing') return <Panel title="Board not found"><p>There is no board with the code {code}. Check the link.</p></Panel>
  if (rv.phase === 'revoked') return <Panel title="This link was revoked"><p>The owner turned off access to this board. Ask them for a new link if you think this is a mistake.</p></Panel>
  if (rv.phase === 'passcode') return <PasscodePanel code={code} onSubmit={rv.submitPasscode} />
  if (rv.phase === 'error') {
    return (
      <Panel title="Couldn't load this page">
        <p>Something went wrong reaching the server.</p>
        <button type="button" className="bd-btn" onClick={rv.retry}>Try again</button>
      </Panel>
    )
  }
  if (rv.phase === 'loading' || !board) return <div className="rv-screen"><main className="rv-center" role="status"><p className="rv-sub">Loading…</p></main></div>
  if (board.type !== 'celebration') {
    return <Panel title="This is not a celebration board"><p>The reveal page only works for celebration boards. You can open the board itself instead.</p><Link className="bd-btn" href={`/b/${code}`}>Open the board</Link></Panel>
  }

  const gate = revealPhase(board, Date.now(), role, clock.offset())
  const stage = revealStage({ phase: gate, step })
  const name = firstName(board.recipient)
  const preview = role === 'owner' && board.revealAt && Date.parse(board.revealAt) > clock.now()
  const theme = board.theme ?? {}
  return (
    <div className="rv-screen" style={{ '--rv-accent': /^#[0-9a-f]{3,8}$/i.test(theme.accent) ? theme.accent : undefined }}>
      {role === 'owner' && (
        <p className="rv-banner" role="note">
          <strong>Owner preview.</strong> {preview ? `The recipient sees a countdown until ${new Date(board.revealAt).toLocaleString()}.` : 'This is what the recipient sees.'}{' '}
          <Link href={`/b/${code}`}>Back to the board</Link>
        </p>
      )}
      {stage === 'countdown' && <Countdown board={board} name={name} clock={clock} onElapsed={force} />}
      {stage === 'intro' && <Intro board={board} count={cards.length} onDone={toSlides} />}
      {stage === 'slides' && (
        loaded
          ? <main className="rv-main"><Slideshow cards={cards} reducedMotion={reduced} name={name} onFinish={() => setStep('board')} boardHref={`/b/${code}?view=1`} /></main>
          : <main className="rv-center" role="status"><p className="rv-sub">Getting the cards…</p></main>
      )}
      {stage === 'board' && <End board={board} code={code} count={cards.length} onReplay={() => setStep('intro')} />}
    </div>
  )
}
