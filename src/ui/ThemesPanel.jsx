'use client'
// The owner's Themes panel (retro boards): ask AI to group the notes, review the suggestions (accept, rename, combine, split,
// dismiss) and make a theme by hand. Suggestions live on the server for the owner only; accepting one adds an ordinary
// `theme` item through the normal ops path, which is the only thing that ever reaches the other people on the board.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useModal } from './boards/useModal.js'
import { CloseIcon } from './icons.jsx'
import { getThemesRequest, suggestThemesRequest, editThemesRequest, acceptOp, noteExcerpt } from './themesApi.js'
import './site/site.css'
import './settings.css'
import './themes.css'

const BEHIND = '.bd-top, .bd-board'
const POLL_MS = 2000

export default function ThemesPanel({ ctl, openerRef, onClose, onOpenSettings }) {
  const root = useRef(null)
  const titleId = useId()
  const id = useId()
  useModal(root, onClose, openerRef, { inert: BEHIND })
  const { code } = ctl
  const [data, setData] = useState({ loaded: false, suggestions: null, generating: false })
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [picked, setPicked] = useState(() => new Set()) // suggestion ids chosen for Combine
  const [out, setOut] = useState({}) // suggestion id -> Set of note ids chosen to take out (Split)
  const [renaming, setRenaming] = useState(null) // { id, title }
  const [mine, setMine] = useState({ title: '', notes: new Set() })
  const [announce, setAnnounce] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const byId = useMemo(() => new Map(ctl.items.map((i) => [i.id, i])), [ctl.items])
  const liveNotes = useMemo(() => ctl.items.filter((i) => i.kind === 'note' && !i.deleted), [ctl.items])
  const info = ctl.state.viewer?.ai ?? { configured: false }
  const aiOn = Boolean(ctl.board.ai?.enabled && ctl.board.ai?.ackAt)

  const load = useCallback(async () => {
    const r = await getThemesRequest(code)
    if (!alive.current) return
    if (!r.ok) { setProblem(r.error); setData((d) => ({ ...d, loaded: true })); return }
    setData({ loaded: true, suggestions: r.data.suggestions ?? null, generating: r.data.themesState === 'generating' })
  }, [code])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!data.generating || busy === 'suggest') return undefined
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [data.generating, busy, load])

  const apply = (r) => {
    if (!alive.current) return false
    if (!r.ok) { setProblem(r.error); return false }
    setProblem('')
    setData({ loaded: true, suggestions: r.data.suggestions ?? null, generating: false })
    return true
  }
  async function suggest() {
    setBusy('suggest'); setProblem(''); setAnnounce('Looking for themes…')
    setData((d) => ({ ...d, generating: true }))
    const r = await suggestThemesRequest(code)
    if (!alive.current) return
    setBusy('')
    if (apply(r)) setAnnounce(`${r.data.suggestions?.themes?.length ?? 0} themes suggested.`)
    else { setAnnounce(''); load() }
  }
  async function edit(body, say) {
    setBusy('edit')
    const r = await editThemesRequest(code, body)
    if (!alive.current) return false
    setBusy('')
    const ok = apply(r)
    if (ok && say) setAnnounce(say)
    return ok
  }
  async function accept(s) {
    ctl.local([acceptOp(ctl.items, s)])
    setAnnounce(`Added the theme ${s.title} to the board.`)
    await edit({ edit: 'dismiss', id: s.id })
  }
  function addMine(e) {
    e.preventDefault()
    const title = mine.title.trim()
    if (!title) return
    ctl.local([acceptOp(ctl.items, { title, noteIds: [...mine.notes] })])
    setAnnounce(`Added the theme ${title} to the board.`)
    setMine({ title: '', notes: new Set() })
  }
  const toggle = (set, v) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

  const themes = data.suggestions?.themes ?? []
  const grouped = new Set(themes.flatMap((t) => t.noteIds))
  const ungrouped = liveNotes.filter((n) => !grouped.has(n.id)).length
  const canSuggest = aiOn && info.configured && !data.generating && !busy
  const why = !info.configured ? 'AI is not available on this server. You can still make themes by hand below.' : !aiOn ? 'AI is off for this board.' : ''
  const pickedIds = [...picked].filter((p) => themes.some((t) => t.id === p))

  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={root} className="bd-settings bd-themes" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="bd-settings-head">
          <h2 id={titleId}>Themes</h2>
          <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close themes" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="bd-settings-body">
          <p className="bd-set-hint">Suggestions are only visible to you. Nothing changes on the board until you accept one, and your notes are never edited.</p>
          <p className="bd-vh" role="status" aria-live="polite">{announce}</p>
          {problem && <div className="bd-sum-problem" role="alert"><p>{problem}</p></div>}
          <div className="bd-set-actions">
            <button type="button" className="bd-sbtn is-primary" disabled={!canSuggest} aria-describedby={why ? `${id}-w` : undefined} onClick={suggest}>
              {data.generating ? 'Looking for themes…' : themes.length ? 'Suggest again' : 'Suggest themes'}
            </button>
          </div>
          {why && (
            <p id={`${id}-w`} className="bd-set-hint">
              {why}{' '}{info.configured && !aiOn && <button type="button" className="bd-sum-link" onClick={onOpenSettings}>Turn on AI in settings</button>}
            </p>
          )}

          {data.loaded && !themes.length && !data.generating && <p className="bd-set-hint">No suggestions right now.</p>}
          {themes.length > 0 && <p className="bd-th-ungrouped">{ungrouped} {ungrouped === 1 ? 'note is' : 'notes are'} not in any suggestion.</p>}
          <ul className="bd-th-list" aria-label="Suggested themes">
            {themes.map((s) => {
              const chosen = out[s.id] ?? new Set()
              return (
                <li key={s.id} className={`bd-th-item${picked.has(s.id) ? ' is-picked' : ''}`}>
                  <div className="bd-th-top">
                    {themes.length > 1 && (
                      <input type="checkbox" checked={picked.has(s.id)} aria-label={`Select ${s.title} to combine`} onChange={() => setPicked((p) => toggle(p, s.id))} />
                    )}
                    <h3>{s.title}</h3>
                    <span className="bd-set-chip">{s.noteIds.length}</span>
                  </div>
                  <ul className="bd-th-notes" aria-label={`Notes in ${s.title}`}>
                    {s.noteIds.map((n) => {
                      const note = byId.get(n)
                      const gone = !note || note.deleted
                      return (
                        <li key={n}>
                          <label className={gone ? 'is-gone' : undefined}>
                            <input type="checkbox" checked={chosen.has(n)} onChange={() => setOut((o) => ({ ...o, [s.id]: toggle(chosen, n) }))} />
                            <span>{gone ? '(note deleted)' : noteExcerpt(note)}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  {renaming?.id === s.id ? (
                    <form className="bd-th-rename" onSubmit={async (e) => { e.preventDefault(); if (await edit({ edit: 'rename', id: s.id, title: renaming.title }, 'Renamed.')) setRenaming(null) }}>
                      <input className="bd-sinput" value={renaming.title} maxLength={60} aria-label="Theme title" data-autofocus onChange={(e) => setRenaming({ id: s.id, title: e.target.value })} />
                      <button type="submit" className="bd-sbtn is-primary" disabled={!renaming.title.trim() || Boolean(busy)}>Save</button>
                      <button type="button" className="bd-sbtn" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <div className="bd-th-actions">
                      <button type="button" className="bd-sbtn is-primary" disabled={Boolean(busy)} onClick={() => accept(s)}>Accept</button>
                      <button type="button" className="bd-sbtn" disabled={Boolean(busy)} onClick={() => setRenaming({ id: s.id, title: s.title })}>Rename</button>
                      <button type="button" className="bd-sbtn" disabled={Boolean(busy) || !chosen.size} onClick={async () => { if (await edit({ edit: 'split', id: s.id, noteIds: [...chosen] }, 'Notes taken out.')) setOut((o) => ({ ...o, [s.id]: new Set() })) }}>Take selected notes out</button>
                      <button type="button" className="bd-sbtn is-danger" disabled={Boolean(busy)} onClick={() => edit({ edit: 'dismiss', id: s.id }, 'Dismissed.')}>Dismiss</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {themes.length > 1 && (
            <div className="bd-set-actions">
              <button type="button" className="bd-sbtn" disabled={pickedIds.length !== 2 || Boolean(busy)} onClick={async () => { if (await edit({ edit: 'combine', ids: pickedIds }, 'Combined.')) setPicked(new Set()) }}>Combine the two selected</button>
            </div>
          )}

          <h3 className="bd-set-label">Make a theme by hand</h3>
          <form onSubmit={addMine}>
            <label className="bd-set-label" htmlFor={`${id}-t`}>Title</label>
            <input id={`${id}-t`} className="bd-sinput" value={mine.title} maxLength={60} onChange={(e) => setMine((m) => ({ ...m, title: e.target.value }))} />
            {liveNotes.length > 0 && (
              <ul className="bd-th-notes" aria-label="Notes to link">
                {liveNotes.slice(0, 200).map((n) => (
                  <li key={n.id}>
                    <label>
                      <input type="checkbox" checked={mine.notes.has(n.id)} disabled={!mine.notes.has(n.id) && mine.notes.size >= 50} onChange={() => setMine((m) => ({ ...m, notes: toggle(m.notes, n.id) }))} />
                      <span>{noteExcerpt(n)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="bd-set-actions"><button type="submit" className="bd-sbtn is-primary" disabled={!mine.title.trim()}>Add theme to the board</button></div>
          </form>
        </div>
      </aside>
    </>
  )
}
