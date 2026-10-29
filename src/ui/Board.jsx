'use client'
// The canvas: one transformed world holding the connector layer and the items, plus the floating controls.
import { useEffect, useMemo, useRef, useState } from 'react'
import ItemView from './ItemView.jsx'
import Connector from './items/Connector.jsx'
import Toolbar from './Toolbar.jsx'
import ContextBar from './ContextBar.jsx'
import Minimap from './Minimap.jsx'
import AnonToggle from './AnonToggle.jsx'
import Cursors from './Cursors.jsx'
import PeerSelections from './PeerSelections.jsx'
import { selectionForPresence } from '../lib/anon.js'
import VotePanel from './VotePanel.jsx'
import ThrowLayer from './ThrowLayer.jsx'
import ThrowTray from './ThrowTray.jsx'
import AddCard from './AddCard.jsx'
import { useThrows } from './useThrows.js'
import { voteCount } from './voteResults.js'
import { isVotable } from '../lib/vote.js'
import { toolAllowed, notesOpen, voteStageOpen } from '../lib/clientRules.js'
import { MinusIcon, PlusIcon, FitIcon } from './icons.jsx'
import { useViewport, loadView } from './useViewport.js'
import { useGestures } from './useGestures.js'
import { useActions } from './useActions.js'
import { useShortcuts } from './useShortcuts.js'
import { screenToWorld, rectsIntersect } from './geometry.js'
import { itemLabel, connectorLabel } from './labels.js'
import { ThemeLinks } from './items/themeLinks.js'
import { useRetroJump } from './useRetroJump.js'

const GRID = 24

// The pointer shows the armed emoji while it waits for a target.
const emojiCursor = (emoji) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='2' y='26' font-size='26'>${emoji}</text></svg>`)}") 16 16, crosshair`

// `presence`: the live presence client, or null when there is no realtime stream (then no cursors or outlines exist).
export default function Board({ ctl, code, presence = null }) {
  const { rootRef, view, viewRef, setView, size, sizeRef, api: vp } = useViewport(code)
  const [tool, setTool] = useState('select')
  const [picked, setSelection] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [space, setSpace] = useState(false)
  const [style, setStyleState] = useState({ note: 'yellow', shape: 'blue', shapeKind: 'rect', anon: false })
  const fileRef = useRef(null)

  // Items other people delete drop out of the selection.
  const have = useMemo(() => new Set(ctl.items.map((i) => i.id)), [ctl.items])
  const selection = useMemo(() => {
    const kept = [...picked].filter((id) => have.has(id))
    return kept.length === picked.size ? picked : new Set(kept)
  }, [picked, have])

  const notesClosed = !notesOpen(ctl.board, ctl.isOwner) // a retro stage that is not collecting (guests only)
  const actions = useActions({
    ctl, canCreate: (kind) => !notesClosed && toolAllowed(ctl.board?.type, kind), tool, selection, setSelection, setTool, setEditing, viewRef, sizeRef, style,
    setStyle: (next) => setStyleState((s) => ({ ...s, ...next })),
  })

  const pickTool = (id) => {
    if (id !== 'select' && (ctl.readOnly || notesClosed || !toolAllowed(ctl.board?.type, id))) return
    if (id === 'image') { fileRef.current?.click(); return }
    g.setLinkFrom(null)
    setTool(id)
  }

  const layerRef = useRef(null)
  const eatClick = useRef(null) // the click that follows a throwing pointerdown must not also press a button under it
  useEffect(() => () => clearTimeout(eatClick.current), [])
  const byIdRef = useRef(new Map())
  const throws = useThrows({ ctl, layerRef })
  const voteOpen = Boolean(ctl.board?.vote?.active)
  const canVote = voteOpen && !ctl.readOnly && Boolean(ctl.uid) && voteStageOpen(ctl.board, ctl.isOwner)

  const g = useGestures({ ctl, rootRef, viewRef, setView, tool, spaceDown: space, selection, setSelection, actions })
  const centre = (id) => { const i = byIdRef.current.get(id); return i && { x: i.x + i.w / 2, y: i.y + i.h / 2 } }
  useShortcuts({
    ctl, actions, pickTool, setSelection, setSpace, cancelGesture: g.cancel,
    throwing: { armed: Boolean(throws.armed), atItem: (id) => { const c = centre(id); if (c) throws.throwAt(c, id) }, disarm: throws.disarm },
    voting: { open: canVote, can: (id) => isVotable(byIdRef.current.get(id)), toggle: ctl.vote },
  })
  const h = g.handlers

  // A board that turns read-only under you (locked or closed by the owner) leaves any creation tool behind.
  const { setLinkFrom } = g
  useEffect(() => { if (ctl.readOnly && tool !== 'select') { setLinkFrom(null); setTool('select') } }, [ctl.readOnly, tool, setLinkFrom])

  // Tell the others what is selected (debounced inside the client); an empty selection clears their outline.
  // Anonymous notes are never announced (their outline would carry the author's name tag).
  useEffect(() => { presence?.select(selectionForPresence(selection, byIdRef.current)) }, [presence, selection])

  // The first time the board has items and a size: the saved view for this tab, else fit everything.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !size.w) return
    started.current = true
    const saved = loadView(code)
    // A saved view from a different window size can leave the content off screen: fit instead.
    const tl = saved && screenToWorld({ x: 0, y: 0 }, saved)
    const seen = saved && { x: tl.x, y: tl.y, w: size.w / saved.scale, h: size.h / saved.scale }
    if (saved && (!ctl.items.length || ctl.items.some((i) => i.kind !== 'connector' && rectsIntersect(i, seen)))) setView(saved)
    else vp.fit(ctl.items)
  }, [size.w, code, ctl.items, setView, vp])

  const items = useMemo(
    () => (g.overlay ? ctl.items.map((i) => (g.overlay.has(i.id) ? { ...i, ...g.overlay.get(i.id) } : i)) : ctl.items),
    [ctl.items, g.overlay],
  )
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  byIdRef.current = byId

  // Results panel: bring a note into the middle of the screen and focus it.
  const jump = (id) => {
    const c = centre(id)
    if (!c) return
    vp.centerOn(c)
    setSelection(new Set([id]))
    setTimeout(() => rootRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }), 0)
  }

  useRetroJump(jump) // the retro panels centre an item through this

  // A card the viewer just posted: bring its place into view and select it (focus stays with the Add button).
  const landed = (op) => {
    vp.centerOn({ x: op.item.x + op.item.w / 2, y: op.item.y + op.item.h / 2 })
    setSelection(new Set([op.id]))
  }

  // Callbacks go through a ref: ItemView is memoised and ignores them when comparing props.
  const latest = useRef(null)
  latest.current = { ctl, h, setEditing }

  const single = selection.size === 1 ? byId.get([...selection][0]) : null
  const sel = [...selection].map((id) => byId.get(id)).filter(Boolean)
  const hasKind = (k) => sel.some((i) => i.kind === k)
  // The Delete key has no equivalent on a phone: whatever is selected and may be deleted gets a button.
  const deletable = ctl.readOnly ? [] : [...selection].map((id) => byId.get(id)).filter((i) => i && ctl.canEdit(i))
  const showColors = !ctl.readOnly && (tool === 'note' || tool === 'shape' || hasKind('note') || hasKind('shape'))
  const showShapes = !ctl.readOnly && (tool === 'shape' || hasKind('shape'))
  const ctxColor = single && (single.kind === 'note' || single.kind === 'shape') ? single.data.color : tool === 'shape' || (!hasKind('note') && hasKind('shape')) ? style.shape : style.note
  const ctxShape = single?.kind === 'shape' ? single.data.shape : style.shapeKind

  const worldOf = (e) => {
    const r = rootRef.current.getBoundingClientRect()
    return screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, viewRef.current)
  }
  // Tabbing to an item selects it. Mouse focus is left to the pointer handlers (shift-click must be able to deselect).
  const focusSelect = (e, id) => {
    if (e.target !== e.currentTarget) return
    if (e.currentTarget.dataset.noSelect) { delete e.currentTarget.dataset.noSelect; return } // focus moved here after a delete
    let visible = true // browsers without :focus-visible (Safari < 15.4) throw: treat as keyboard focus
    try { visible = e.currentTarget.matches(':focus-visible') } catch { /* keep true */ }
    if (!visible) return
    setSelection((cur) => (cur.size === 1 && cur.has(id) ? cur : new Set([id])))
  }
  const imageFiles = (list) => [...list].filter((f) => f.type.startsWith('image/'))

  // Dots thin out as you zoom out so the grid never turns into noise.
  let step = GRID * view.scale
  while (step < 14) step *= 2
  const canvasStyle = {
    '--bd-grid': `${step}px`,
    '--bd-gx': `${view.x - step / 2}px`,
    '--bd-gy': `${view.y - step / 2}px`,
    ...(throws.armed && { '--bd-throw-cursor': emojiCursor(throws.armed) }),
  }
  const cls = ['bd-canvas', `bd-tool-${tool}`, space && 'is-space', g.panning && 'is-panning', throws.armed && 'is-throwing'].filter(Boolean).join(' ')
  const boxes = items.filter((i) => i.kind !== 'connector')
  const links = items.filter((i) => i.kind === 'connector' && byId.has(i.data.from) && byId.has(i.data.to))

  return (
    <div className="bd-board">
      <p id="bd-help" className="bd-vh">
        Board canvas. Tab moves between items. Enter edits the selected item, arrow keys move it, Delete removes it,
        Ctrl or Command with D duplicates it, and the bracket keys change its stacking order.
      </p>
      <div
        ref={rootRef}
        className={cls}
        style={canvasStyle}
        role="region"
        tabIndex={-1}
        aria-label="Board canvas"
        aria-describedby="bd-help"
        onPointerDownCapture={(e) => {
          if (throws.armed && e.button === 0) { // an armed emoji: this click throws instead of selecting or drawing
            throws.throwAt(worldOf(e), e.target.closest?.('.bd-item[data-id]')?.dataset.id, { keep: e.shiftKey })
            clearTimeout(eatClick.current)
            eatClick.current = setTimeout(() => { eatClick.current = null }, 600)
            e.preventDefault()
            e.stopPropagation()
            return
          }
          h.onDownCapture(e)
        }}
        onClickCapture={(e) => {
          if (eatClick.current === null) return
          clearTimeout(eatClick.current)
          eatClick.current = null
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerDown={h.onCanvasDown}
        onPointerMove={(e) => {
          h.onMove(e)
          // Our pointer, in world coordinates, for the others' cursors; nothing is computed unless somebody can see it.
          if (presence?.hasPeers() && e.pointerType !== 'touch') {
            const w = worldOf(e)
            presence.cursor(w.x, w.y)
          }
        }}
        onPointerUp={h.onUp}
        onPointerCancel={h.onCancel}
        onDragOver={(e) => { if (!ctl.readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault() }}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer.files)
          if (!files.length || ctl.readOnly) return
          e.preventDefault()
          actions.placeImage(files[0], worldOf(e))
        }}
      >
        <div className="bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, '--bd-inv': 1 / view.scale }}>
          <svg className="bd-links">
            <defs aria-hidden="true">
              <marker id="bd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="bd-arrow" /></marker>
              <marker id="bd-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="bd-arrow is-selected" /></marker>
            </defs>
            {links.map((c) => (
              <Connector
                key={c.id}
                item={c}
                from={byId.get(c.data.from)}
                to={byId.get(c.data.to)}
                selected={selection.has(c.id)}
                label={connectorLabel(byId.get(c.data.from), byId.get(c.data.to))}
                onPointerDown={(e) => latest.current.h.onConnectorDown(e, c.id)}
                onFocus={(e) => focusSelect(e, c.id)}
              />
            ))}
          </svg>
          <ThemeLinks.Provider value={byId}>
          {boxes.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              selected={selection.has(item.id)}
              editable={ctl.canEdit(item)}
              handles={tool === 'select' && single?.id === item.id}
              linking={g.linkFrom === item.id}
              label={itemLabel(item)}
              votes={voteCount(item)}
              voted={Boolean(ctl.uid && item.votes?.includes(ctl.uid))}
              voting={canVote && isVotable(item)}
              onVote={() => latest.current.ctl.vote(item.id)}
              onFocus={(e) => focusSelect(e, item.id)}
              autoEdit={editing === item.id}
              onEditEnd={(value) => {
                const { ctl: c, setEditing } = latest.current
                setEditing(null)
                // A text box left empty shows nothing to guests (only the editor sees the "Text" hint): drop it.
                if (item.kind === 'text' && typeof value === 'string' && !value.trim() && !(item.data?.text ?? '').trim()) c.local([{ op: 'delete', id: item.id }])
              }}
              onChange={(patch) => latest.current.ctl.local([{ op: 'update', id: item.id, patch }])}
              onSelect={(e) => latest.current.h.onItemDown(e, item.id)}
              onResizeStart={(e, handle) => latest.current.h.onResizeStart(e, item.id, handle)}
            />
          ))}
          </ThemeLinks.Provider>
          <PeerSelections presence={presence} byId={byId} />
          <Cursors presence={presence} />
          {g.draft && <div className={`bd-draft bd-draft-${tool}`} style={{ left: g.draft.x, top: g.draft.y, width: g.draft.w, height: g.draft.h }} />}
          {g.marquee && <div className="bd-marquee" style={{ left: g.marquee.x, top: g.marquee.y, width: g.marquee.w, height: g.marquee.h }} />}
        </div>
        {!ctl.items.length && !ctl.readOnly && (
          <p className="bd-empty">Pick a tool on the left, or press <kbd>N</kbd> and click to add a sticky note.</p>
        )}
        {tool === 'connector' && <p className="bd-hint" role="status">{g.linkFrom ? 'Now click the item to connect to' : 'Click the item to connect from'}</p>}
      </div>

      <div className="bd-hud">
        <VotePanel ctl={ctl} onJump={jump} />
        <AnonToggle mode={ctl.board?.anonymousNotes} on={style.anon} onChange={(anon) => setStyleState((s) => ({ ...s, anon }))} />
        <ContextBar
          onDelete={deletable.length ? () => actions.deleteSelected() : undefined}
          deleteCount={deletable.length}
          colors={showColors}
          shapes={showShapes}
          color={ctxColor}
          shape={ctxShape}
          onColor={(color) => actions.restyle({ color })}
          onShape={(shapeKind) => actions.restyle({ shapeKind })}
        />
      </div>
      <ThrowLayer ref={layerRef} ctl={ctl} rootRef={rootRef} viewRef={viewRef} byIdRef={byIdRef} />
      {throws.canThrow && <ThrowTray emojis={throws.emojis} armed={throws.armed} onArm={throws.arm} notice={throws.notice} />}
      <Toolbar tool={tool} onTool={pickTool} disabled={ctl.readOnly} closed={notesClosed} type={ctl.board?.type} />
      <AddCard ctl={ctl} onPosted={landed} />
      <div className="bd-zoom" role="group" aria-label="Zoom">
        <button type="button" className="bd-zbtn" aria-label="Zoom out" title="Zoom out" onClick={vp.zoomOut}><MinusIcon /></button>
        <button type="button" className="bd-zval" aria-label="Reset zoom to 100%" title="Reset to 100%" onClick={vp.reset}>{Math.round(view.scale * 100)}%</button>
        <button type="button" className="bd-zbtn" aria-label="Zoom in" title="Zoom in" onClick={vp.zoomIn}><PlusIcon /></button>
        <button type="button" className="bd-zbtn" aria-label="Fit to content" title="Fit to content" onClick={() => vp.fit(ctl.items)}><FitIcon /></button>
      </div>

      <Minimap items={items} view={view} size={size} onMove={vp.centerOn} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const [file] = imageFiles(e.target.files)
          e.target.value = ''
          if (file) actions.placeImage(file)
        }}
      />
    </div>
  )
}
