'use client'
// The GIF step of the card composer: Giphy search (trending when the box is empty) and "paste a GIF link". Search needs
// NEXT_PUBLIC_GIPHY_API_KEY (a browser-side SDK key by design, inlined at build time); without it only the link field is
// offered. Picking a result keeps only its https URL and size (gif.js). Searching sends the query to Giphy, which the
// panel says in plain words, next to the required "Powered by GIPHY" credit.
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { SEARCH_DEBOUNCE_MS, GIPHY_ATTRIBUTION, GIPHY_DISCLOSURE, pickGif, checkGifLink } from './gif.js'
import { loadPicture } from './pictures.js'

const GifGrid = lazy(() => import('./GifGrid.jsx'))
const KEY = process.env.NEXT_PUBLIC_GIPHY_API_KEY || ''

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// Search box + results. Mounted only when a key exists.
function Search({ onPick }) {
  const id = useId()
  const grid = useRef(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('loading')
  const query = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS)
  const waiting = text.trim() !== query // typed but not searched yet
  const message = waiting ? 'Searching…'
    : status === 'loading' ? (query ? `Searching for “${query}”…` : 'Loading trending GIFs…')
    : status === 'empty' ? `No GIFs found for “${query}”. Try another word.`
    : status === 'error' ? ''
    : query ? `Results for “${query}”` : 'Trending now'

  return (
    <div className="bd-gp-search">
      <label className="bd-set-label" htmlFor={id}>Search GIFs</label>
      <input
        id={id}
        className="bd-sinput"
        type="search"
        autoComplete="off"
        maxLength={80}
        placeholder="Try “celebrate” or “thank you”"
        value={text}
        data-autofocus
        aria-describedby={`${id}-s ${id}-d`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); grid.current?.focusFirst() } }}
      />
      <p id={`${id}-d`} className="bd-set-desc">{GIPHY_DISCLOSURE} Use the arrow keys to move through the results and Enter to choose one.</p>
      <p id={`${id}-s`} className="bd-gp-status" role="status">{message}</p>
      <div className="bd-gp-scroll">
        <Suspense fallback={<p className="bd-gp-status" role="status">Loading GIFs…</p>}>
          <GifGrid key={query} ref={grid} apiKey={KEY} query={query} onStatus={setStatus} onPick={(g) => { const p = pickGif(g); if (p) onPick(p) }} />
        </Suspense>
      </div>
    </div>
  )
}

// A pasted link: checked (https, same rule as the server), then loaded once to read its size and prove it is a picture.
function PasteLink({ onPick }) {
  const id = useId()
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function use() {
    if (busy) return
    const r = checkGifLink(link)
    if (!r.ok) { setProblem(r.error); return }
    setProblem('')
    setBusy(true)
    const pic = await loadPicture(r.url)
    if (!alive.current) return
    setBusy(false)
    if (!pic) { setProblem('That link did not load as a picture. Check it and try again.'); return }
    onPick({ url: r.url, w: pic.w, h: pic.h })
  }

  return (
    <div className="bd-gp-paste">
      <label className="bd-set-label" htmlFor={id}>{KEY ? 'Or paste a GIF link' : 'Paste a GIF link'}</label>
      <div className="bd-gp-pasterow">
        <input
          id={id}
          className="bd-sinput"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://…"
          value={link}
          data-autofocus={KEY ? undefined : true}
          aria-invalid={problem ? 'true' : undefined}
          aria-describedby={`${id}-e`}
          onChange={(e) => { setLink(e.target.value); setProblem('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); use() } }}
        />
        <button type="button" className="bd-sbtn" disabled={busy} onClick={use}>{busy ? 'Checking…' : 'Use link'}</button>
      </div>
      <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
    </div>
  )
}

export default function GifPicker({ onPick, onBack }) {
  return (
    <div className="bd-gp" onKeyDown={(e) => {
      if (e.key !== 'Escape') return
      // Back to the card, not out of the whole dialog: the modal's own Esc listener must not see this one.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      onBack()
    }}>
      <div className="bd-cc-head">
        <button type="button" className="bd-sbtn" onClick={onBack}>← Back to card</button>
        <h2 className="bd-cc-title">Add a GIF</h2>
      </div>
      {KEY ? <Search onPick={onPick} /> : <p className="bd-set-desc">GIF search is not set up on this site, but you can still paste a link to a GIF.</p>}
      <PasteLink onPick={onPick} />
      {KEY && <p className="bd-gp-credit"><span className="bd-gp-badge">{GIPHY_ATTRIBUTION}</span></p>}
    </div>
  )
}
