'use client'
// Today's birthdays and work anniversaries, from the server (which only ever returns who and which kind), for the
// viewer's own calendar day. Shown once per day per board per browser, dismissible, announced politely; the effects
// come from the shared layer, which swaps motion for a still emoji under prefers-reduced-motion.
import { useEffect, useState } from 'react'
import { useEffects } from './Effects.jsx'
import { localDay, bannerSeen, markBannerSeen, bannerEffects, bannerLines } from '../lib/wall.js'

const storage = () => { try { return window.localStorage } catch { return null } }

export default function MilestoneBanner({ code, ready }) {
  const { fire } = useEffects()
  const [list, setList] = useState([])

  useEffect(() => {
    if (!ready) return undefined
    const day = localDay()
    if (bannerSeen(storage(), code, day)) return undefined
    let dead = false
    const timers = []
    fetch(`/api/boards/${code}/milestones?today=${day}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((ms) => {
        if (dead || !Array.isArray(ms) || !ms.length) return
        markBannerSeen(storage(), code, day)
        setList(ms)
        const say = bannerLines(ms).join(' ')
        bannerEffects(ms).forEach((effect, i) => timers.push(setTimeout(() => fire(effect, { announce: i === 0 ? say : undefined }), i * 1200)))
      })
      .catch(() => {})
    return () => { dead = true; timers.forEach(clearTimeout) }
  }, [code, ready, fire])

  return (
    <div className="wl-banner-slot" role="status" aria-live="polite">
      {list.length > 0 && (
        <div className="wl-banner">
          <span className="wl-banner-icons" aria-hidden="true">{list.some((m) => m.kind === 'birthday') ? '🎈' : ''}{list.some((m) => m.kind === 'anniversary') ? '🎆' : ''}</span>
          <ul>{bannerLines(list).map((line) => <li key={line}>{line}</li>)}</ul>
          <button type="button" className="bd-iconbtn" aria-label="Dismiss" onClick={() => setList([])}>×</button>
        </div>
      )}
    </div>
  )
}
