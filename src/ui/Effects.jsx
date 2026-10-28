'use client'
// The celebration layer: one fixed, click-through canvas over the whole page, and `useEffects().fire(effect, opts)` to
// start an effect. The frame loop only exists while particles do (effects-runner.js); it stops when the tab is hidden;
// with prefers-reduced-motion nothing flies: a static emoji appears in the corner instead. Either way the effect is
// announced politely for screen readers (`opts.announce`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRunner } from './effects-runner.js'
import { drawParticles } from './effects-draw.js'
import './collab.css'

const MAX_DPR = 2
const POP_MS = 1800
const ANNOUNCE_GAP_MS = 60 // the live region is emptied first so the same sentence twice is read twice
const SPOKEN_EVERY_MS = 3000 // however many celebrations arrive, they are spoken at most this often (they all still play)
export const EFFECT_EMOJI = { confetti: '🎉', balloons: '🎈', fireworks: '🎆' }

const Ctx = createContext({ fire: () => false })
export const useEffects = () => useContext(Ctx)

export function EffectsProvider({ children }) {
  const canvasRef = useRef(null)
  const runnerRef = useRef(null)
  const timers = useRef({ pop: null, say: null })
  const spokenAt = useRef(0)
  const [pop, setPop] = useState(null)
  const [said, setSaid] = useState('')

  useEffect(() => {
    const t = timers.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return () => { clearTimeout(t.pop); clearTimeout(t.say) } // no 2D canvas here: effects are announced but not drawn
    const size = () => ({ w: window.innerWidth, h: window.innerHeight })
    const runner = createRunner({
      requestFrame: (fn) => window.requestAnimationFrame(fn),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      getBounds: size,
      draw(list) {
        if (!list.length) { // nothing to show: give the backing store back (this also clears the canvas)
          if (canvas.width) { canvas.width = 0; canvas.height = 0 }
          return
        }
        const { w, h } = size()
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
        const bw = Math.round(w * dpr)
        const bh = Math.round(h * dpr)
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
        drawParticles(ctx, list, { w, h, dpr })
      },
    })
    runnerRef.current = runner
    const onVisibility = () => (document.visibilityState === 'hidden' ? runner.pause() : runner.resume())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      runner.destroy()
      runnerRef.current = null
      clearTimeout(t.pop)
      clearTimeout(t.say)
    }
  }, [])

  const fire = useCallback((effect, { announce, count } = {}) => {
    const t = timers.current
    if (announce && Date.now() - spokenAt.current >= SPOKEN_EVERY_MS) {
      spokenAt.current = Date.now()
      clearTimeout(t.say)
      setSaid('')
      t.say = setTimeout(() => setSaid(announce), ANNOUNCE_GAP_MS)
    }
    if (document.visibilityState === 'hidden') return false // nobody is looking
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      clearTimeout(t.pop)
      setPop({ emoji: EFFECT_EMOJI[effect] ?? '🎉', at: Date.now() })
      t.pop = setTimeout(() => setPop(null), POP_MS)
      return true
    }
    return runnerRef.current?.fire(effect, { count }) ?? false
  }, [])

  const value = useMemo(() => ({ fire }), [fire])
  return (
    <Ctx.Provider value={value}>
      {children}
      <canvas ref={canvasRef} className="bd-fx" aria-hidden="true" />
      {pop && <div className="bd-fx-pop" aria-hidden="true" key={pop.at}>{pop.emoji}</div>}
      <div className="bd-vh" role="status" aria-live="polite">{said}</div>
    </Ctx.Provider>
  )
}
