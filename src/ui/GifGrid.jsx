'use client'
// The Giphy results grid (@giphy/react-components) with trending when the query is empty. Loaded on demand (React.lazy in
// GifPicker) so the SDK and styled-components stay out of the board's bundle until someone opens the picker.
// The SDK's tiles have no keyboard model of their own, so this adds one: tiles become listbox options with a roving
// tabindex, arrow keys move through the masonry (gifNav.js), Enter or Space picks. Failures are caught here and shown by
// the picker (the SDK's own error row is not accessible), by handing the grid an empty page.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { GiphyFetch } from '@giphy/js-fetch-api'
import { Grid } from '@giphy/react-components'
import { GIPHY_OPTIONS } from './gif.js'
import { nextTile, readingOrder } from './gifNav.js'
import { classifyGifError, gifErrorMessage, createGate } from './gifStatus.js'

const PAGE = 12
const GUTTER = 6
const tilesOf = (root) => [...root.querySelectorAll('.giphy-gif')]
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } }

// `onStatus` must be a stable function (a state setter): it is told 'loading' | 'ready' | 'empty' | 'error'.
export default function GifGrid({ apiKey, query, onPick, onStatus, ref }) {
  const root = useRef(null)
  const gifs = useRef(new Map())
  const [width, setWidth] = useState(0)
  const [retry, setRetry] = useState(0)
  const [status, setStatusState] = useState('loading') // loading | ready | empty | error
  const [errorKind, setErrorKind] = useState('offline')
  const gate = useRef(createGate()) // only the newest request may speak for this grid, and nothing once it is unmounted
  useEffect(() => {
    gate.current = createGate()
    return () => gate.current.close()
  }, [])
  const gf = useMemo(() => new GiphyFetch(apiKey), [apiKey])

  const setStatus = useCallback((s) => { setStatusState(s); onStatus?.(s) }, [onStatus])
  useEffect(() => { onStatus?.('loading') }, [onStatus])

  const fetchGifs = useCallback(async (offset) => {
    const token = gate.current.next()
    try {
      const res = query
        ? await gf.search(query, { offset, limit: PAGE, ...GIPHY_OPTIONS })
        : await gf.trending({ offset, limit: PAGE, rating: GIPHY_OPTIONS.rating })
      for (const g of res.data) gifs.current.set(String(g.id), g)
      if (offset === 0 && gate.current.isCurrent(token)) setStatus(res.data.length ? 'ready' : 'empty')
      return res
    } catch (err) {
      if (gate.current.isCurrent(token)) {
        setErrorKind(classifyGifError(err, { online: navigator.onLine !== false }))
        setStatus('error')
      }
      return { data: [], pagination: { count: 0, offset, total_count: 0 }, meta: {} }
    }
  }, [gf, query, setStatus])

  useEffect(() => {
    const el = root.current
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  // Give new tiles their role and name, and keep exactly one of them in the tab order.
  useEffect(() => {
    const el = root.current
    const decorate = () => {
      const all = tilesOf(el)
      const active = all.find((t) => t.getAttribute('tabindex') === '0') ?? all[readingOrder(all.map(rectOf))[0]]
      for (const t of all) {
        const g = gifs.current.get(t.dataset.giphyId)
        t.setAttribute('role', 'option')
        t.setAttribute('aria-label', g?.title?.trim() || 'GIF')
        t.setAttribute('tabindex', t === active ? '0' : '-1')
        for (const img of t.querySelectorAll('img')) img.referrerPolicy = 'no-referrer' // the SDK's tiles keep the board address from Giphy too
      }
    }
    decorate()
    const mo = new MutationObserver(decorate)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  const focusTile = useCallback((el) => {
    if (!el) return
    for (const t of tilesOf(root.current)) t.setAttribute('tabindex', t === el ? '0' : '-1')
    el.focus()
    el.scrollIntoView?.({ block: 'nearest' })
  }, [])

  useImperativeHandle(ref, () => ({
    focusFirst() { const all = tilesOf(root.current); focusTile(all[readingOrder(all.map(rectOf))[0]]) },
  }), [focusTile])

  const cols = width < 420 ? 2 : 3

  return (
    <div
      ref={root}
      className="bd-gp-grid"
      role="listbox"
      aria-label="GIF results"
      onKeyDown={(e) => {
        const tile = e.target.closest?.('.giphy-gif')
        if (!tile) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          const g = gifs.current.get(tile.dataset.giphyId)
          if (g) onPick(g)
          return
        }
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const all = tilesOf(root.current)
        const to = nextTile(all.map(rectOf), all.indexOf(tile), e.key)
        if (to >= 0) focusTile(all[to])
      }}
    >
      {width > 0 && (
        <Grid
          key={retry}
          width={width}
          columns={cols}
          gutter={GUTTER}
          fetchGifs={fetchGifs}
          noLink
          hideAttribution
          tabIndex={-1}
          borderRadius={8}
          onGifClick={(g, e) => { e.preventDefault(); onPick(g) }}
        />
      )}
      {status === 'error' && (
        <div className="bd-gp-error" role="alert">
          <span>{gifErrorMessage(errorKind)}</span>
          <button type="button" className="bd-sbtn" onClick={() => { setStatus('loading'); setRetry((n) => n + 1) }}>Try again</button>
        </div>
      )}
    </div>
  )
}
