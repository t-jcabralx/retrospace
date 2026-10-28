'use client'
// The body of a team wall: the Feed/Canvas toggle (remembered per board in this browser), today's milestone banner and
// either the feed or the ordinary canvas. The canvas is the same Board a workshop uses.
import { useEffect, useState } from 'react'
import Board from './Board.jsx'
import WallFeed from './WallFeed.jsx'
import MilestoneBanner from './MilestoneBanner.jsx'
import { readView, writeView } from '../lib/wall.js'
import './wall.css'

const storage = () => { try { return window.localStorage } catch { return null } }

export default function WallBody({ ctl, code, presence }) {
  const [view, setView] = useState('feed') // the saved choice is read after hydration so server and client agree
  useEffect(() => { setView(readView(storage(), code)) }, [code])
  const pick = (v) => { setView(v); writeView(storage(), code, v) }
  return (
    <div className="wl-wrap">
      <div className="wl-over">
        <div className="wl-toggle" role="group" aria-label="Wall view">
          {['feed', 'canvas'].map((v) => (
            <button key={v} type="button" className={`wl-toggle-btn${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => pick(v)}>{v === 'feed' ? 'Feed' : 'Canvas'}</button>
          ))}
        </div>
        <MilestoneBanner code={code} ready />
      </div>
      {view === 'feed' ? <WallFeed ctl={ctl} /> : <Board ctl={ctl} code={code} presence={presence} />}
    </div>
  )
}
