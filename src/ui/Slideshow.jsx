'use client'
// One card at a time, large. Advances by itself every 7 s unless paused (a visible Pause/Play button, WCAG 2.2.2) and never
// when the viewer prefers reduced motion; stops on the last card. Previous/Next buttons, arrow keys, Home/End and a swipe
// all move; the position is always said in words ("Card 3 of 12") and announced politely. State is the pure reducer in
// slideshow.js. Only the NEXT card's picture is fetched ahead of time.
import { useEffect, useReducer, useRef } from 'react'
import { initSlideshow, slideshowReducer, AUTO_MS, dotMode, slideKeyAction, shouldAutoStart } from './slideshow.js'
import { noteColor } from './ops.js'
import CardMedia, { cardMedia } from './items/CardMedia.jsx'

const SWIPE_PX = 50
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const PlayIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" /></svg>
const PauseIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
const Arrow = ({ flip }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={flip ? { transform: 'scaleX(-1)' } : undefined}><path d="M9 5l7 7-7 7" /></svg>

export default function Slideshow({ cards, reducedMotion, name, onFinish, boardHref }) {
  const [s, rawDispatch] = useReducer(slideshowReducer, undefined, () => initSlideshow(cards.length, { autoplay: !reducedMotion }))
  const userPaused = useRef(false) // the viewer pressed Pause: late cards must not start it again
  const prevCount = useRef(cards.length)
  // Every action carries the motion preference, so the reducer can refuse to start an autoplay under reduced motion.
  const dispatch = (a) => {
    if (a.type === 'pause' || (a.type === 'toggle' && s.playing)) userPaused.current = true
    else if (a.type === 'play' || a.type === 'toggle') userPaused.current = false
    rawDispatch({ ...a, reduced: reducedMotion })
  }
  const root = useRef(null)
  const down = useRef(null)
  const card = cards[Math.min(s.index, cards.length - 1)]
  const last = s.index >= s.count - 1

  useEffect(() => {
    rawDispatch({ type: 'count', count: cards.length })
    if (shouldAutoStart(prevCount.current, cards.length, { userPaused: userPaused.current, reduced: reducedMotion })) rawDispatch({ type: 'play' })
    prevCount.current = cards.length
  }, [cards.length, reducedMotion])
  useEffect(() => { if (reducedMotion) rawDispatch({ type: 'pause', reduced: true }) }, [reducedMotion])
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])

  // The automatic advance: one timer per card, restarted by any move (index) or by pressing Play.
  useEffect(() => {
    if (!s.playing) return undefined
    const t = setTimeout(() => rawDispatch({ type: 'auto' }), AUTO_MS)
    return () => clearTimeout(t)
  }, [s.playing, s.index])

  // Keys work wherever focus is on the page, except in a field (slideKeyAction decides, and keeps Space for a focused button).
  const keyRef = useRef(null)
  keyRef.current = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const action = slideKeyAction(e.key, { reduced: reducedMotion, tag: e.target.tagName })
    if (action) { e.preventDefault(); dispatch({ type: action }) }
  }
  useEffect(() => {
    const onKey = (e) => keyRef.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Look ahead one card: the browser fetches its picture now, so the next slide is not blank.
  const nextCard = cards[s.index + 1]
  const nextSrc = nextCard && cardMedia(nextCard.data)?.src
  useEffect(() => {
    if (!nextSrc) return
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    img.src = nextSrc
  }, [nextSrc])

  if (!cards.length) {
    return (
      <section ref={root} className="rv-slides rv-empty" tabIndex={-1} aria-labelledby="rv-empty-h">
        <h1 id="rv-empty-h" className="rv-h">No cards yet</h1>
        <p className="rv-sub">Nobody has added a card to this board yet. Check back soon{name ? `, ${name}` : ''}.</p>
        <div className="rv-actions"><a className="rv-btn is-primary" href={boardHref}>See the whole board</a></div>
      </section>
    )
  }

  const d = card.data
  const spoken = `Card ${s.index + 1} of ${s.count}. ${d.signer} wrote: ${clip(d.message, 400)}`
  return (
    <section
      ref={root}
      className="rv-slides"
      tabIndex={-1}
      aria-roledescription="carousel"
      aria-label={name ? `Cards for ${name}` : 'Cards'}
      onPointerDown={(e) => { down.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const d0 = down.current
        down.current = null
        if (!d0) return
        const dx = e.clientX - d0.x
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(e.clientY - d0.y) < Math.abs(dx)) dispatch({ type: dx < 0 ? 'next' : 'prev' })
      }}
    >
      <h1 className="bd-vh">Cards for {name || 'you'}</h1>
      <div className="rv-stage">
        <article
          key={card.id}
          className="rv-card"
          style={{ background: noteColor(d.color) }}
          aria-roledescription="slide"
          aria-label={`${s.index + 1} of ${s.count}`}
        >
          <p className="rv-msg">{d.message}</p>
          <p className="rv-sig"><span aria-hidden="true">— </span>{d.signer}</p>
          <CardMedia data={d} className="rv-media" eager />
        </article>
      </div>
      <p className="bd-vh" role="status" aria-live="polite">{spoken}</p>

      <div className="rv-controls">
        <button type="button" className="rv-round" aria-label="Previous card" title="Previous (Left arrow)" disabled={s.index === 0} onClick={() => dispatch({ type: 'prev' })}><Arrow flip /></button>
        {!reducedMotion && s.count > 1 && (
          <button type="button" className="rv-round is-wide" onClick={() => dispatch({ type: 'toggle' })} title="Space">
            {s.playing ? <PauseIcon /> : <PlayIcon />}<span>{s.playing ? 'Pause' : 'Play'}</span>
          </button>
        )}
        {last
          ? <button type="button" className="rv-round is-wide is-primary" onClick={onFinish}>Finish</button>
          : <button type="button" className="rv-round" aria-label="Next card" title="Next (Right arrow)" onClick={() => dispatch({ type: 'next' })}><Arrow /></button>}
      </div>
      <div className="rv-progress">
        <p className="rv-count">Card {s.index + 1} of {s.count}</p>
        {dotMode(s.count) === 'dots'
          ? <div className="rv-dots" aria-hidden="true">{cards.map((c, i) => <i key={c.id} className={i === s.index ? 'is-on' : i < s.index ? 'is-past' : ''} />)}</div>
          : <div className="rv-bar" aria-hidden="true"><i style={{ width: `${((s.index + 1) / s.count) * 100}%` }} /></div>}
      </div>
      <div className="rv-foot">
        <p className="rv-hint">{reducedMotion ? 'Automatic play is off because your device asks for less motion. ' : ''}Use the arrow keys, or swipe, to move between cards.</p>
        <button type="button" className="rv-skip" onClick={onFinish}>Skip to the end</button>
      </div>
    </section>
  )
}
