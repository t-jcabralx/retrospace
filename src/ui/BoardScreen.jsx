'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Board from './Board.jsx'
import BoardErrorBoundary from './BoardErrorBoundary.jsx'
import WallBody from './WallBody.jsx'
import PasscodePanel from './PasscodePanel.jsx'
import PanelLinks from './PanelLinks.jsx'
import Avatar from './Avatar.jsx'
import PersonaChooser, { PersonaDialog } from './PersonaChooser.jsx'
import Presence from './Presence.jsx'
import Celebrate, { CelebrationListener } from './Celebrate.jsx'
import Timer from './Timer.jsx'
import BoardSettings from './BoardSettings.jsx'
import SummaryPanel from './SummaryPanel.jsx'
import { showSummaryButton } from './summaryApi.js'
import { EffectsProvider } from './Effects.jsx'
import { usePresence } from './usePresence.js'
import { useBoard } from './useBoard.js'
import { UndoIcon, RedoIcon, LockIcon, HomeIcon, GearIcon, SummaryIcon } from './icons.jsx'
import ExportMenu from './ExportMenu.jsx'
import EventBoard from './event/EventBoard.jsx'
import RetroStage from './RetroStage.jsx'
import { printHref } from './printLink.js'
import ThemesPanel from './ThemesPanel.jsx'
import './board.css'
import './persona.css'
import './collab.css'
import './summary.css'

const STATUS = {
  connecting: { label: 'Connecting…', hint: 'Connecting to the board' },
  live: { label: 'Live', hint: 'Changes arrive instantly' },
  polling: { label: 'Syncing', hint: 'Live updates are off; checking for changes every few seconds' },
  offline: { label: 'Offline', hint: 'Reconnecting. Your changes will be sent when the connection is back' },
}

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

// The effects layer wraps every state of the screen, so a celebration can outlive a re-render of the board below.
export default function BoardScreen({ code, viewOnly = false }) {
  return <EffectsProvider><BoardView code={code} viewOnly={viewOnly} /></EffectsProvider>
}

function BoardView({ code, viewOnly }) {
  const ctl = useBoard(code, { viewOnly })
  const presence = usePresence(ctl)
  const { phase, board } = ctl
  const [changing, setChanging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [focusAi, setFocusAi] = useState(false) // the Summary panel's "turn on AI" link opens the settings at that switch
  const [themesOpen, setThemesOpen] = useState(false)
  const themesBtn = useRef(null)
  const settingsBtn = useRef(null)
  const summaryBtn = useRef(null)

  useEffect(() => {
    if (board?.title) document.title = `${board.title} · Retrospace`
  }, [board?.title])

  if (phase === 'missing') {
    return (
      <Panel title="Board not found">
        <p>There is no board with the code {code}. Check the link, or start a new board.</p>
      </Panel>
    )
  }
  if (phase === 'revoked') {
    return (
      <Panel title="This link was revoked">
        <p>The owner turned off access to this board, so it can&apos;t be opened right now. Ask them for a new link if you think this is a mistake.</p>
      </Panel>
    )
  }
  if (phase === 'removed') {
    return (
      <Panel title="You were removed from this board">
        <p>The owner removed you from this board, so it can&apos;t be opened from this browser any more. If you think this is a mistake, ask them directly.</p>
      </Panel>
    )
  }
  if (phase === 'passcode') return <PasscodePanel code={code} onSubmit={ctl.submitPasscode} />
  if (phase === 'persona') {
    return (
      <main className="bd-panel-screen">
        <PersonaChooser boardTitle={board?.title} participants={ctl.state.participants} selfUid={ctl.uid} onSubmit={ctl.savePersona} />
      </main>
    )
  }
  if (phase === 'error') {
    return (
      <Panel title="Couldn't load the board">
        <p>Something went wrong reaching the server.</p>
        <button type="button" className="bd-btn" onClick={ctl.retry}>Try again</button>
      </Panel>
    )
  }

  const status = STATUS[ctl.status]
  // Presence stays mounted through a stream blip (the routine reconnect) so nothing jolts or is announced again; only
  // polling (no realtime at all) removes it. Celebrate is hidden there too, and while connecting.
  const realtime = phase === 'ready' && ctl.status !== 'polling'
  const canCelebrate = phase === 'ready' && (ctl.status === 'live' || ctl.status === 'offline') && !ctl.readOnly
  return (
    <div className={`bd-screen${board?.throwables?.enabled && !ctl.readOnly ? ' has-tray' : ''}`}>
      <header className="bd-top">
        <Link className="bd-iconbtn" href="/" aria-label="Back to Retrospace" title="Back to Retrospace"><HomeIcon /></Link>
        <h1 className="bd-title">{board?.title ?? <span className="bd-skeleton" aria-hidden="true" />}</h1>
        {phase === 'ready' && board && <Timer ctl={ctl} />}
        {phase === 'ready' && ctl.readOnly && (
          <span className="bd-badge" title={ctl.readOnlyReason === 'view-only' ? 'You are viewing this board: it cannot be changed from here' : `Board is ${ctl.readOnlyReason}: only the owner can change it`}>
            <LockIcon width={14} height={14} /><span className="bd-badge-label">Board is {ctl.readOnlyReason}</span>
          </span>
        )}
        <span className="bd-grow" />
        {canCelebrate && <Celebrate ctl={ctl} />}
        {realtime && <Presence presence={presence} me={ctl.persona} />}
        {phase === 'ready' && ctl.persona && (
          <button
            type="button"
            className="pa-me"
            aria-haspopup="dialog"
            aria-disabled={ctl.personaLocked ? 'true' : undefined}
            aria-describedby={ctl.personaLocked ? 'pa-me-why' : undefined}
            title={ctl.personaLocked ? 'You can no longer change this: you have added something to the board' : 'Change how you appear'}
            onClick={() => { if (!ctl.personaLocked) setChanging(true) }}
          >
            <Avatar avatar={ctl.persona.avatar} name={ctl.persona.name} size={30} decorative />
            <span className="pa-me-text">
              <span className="pa-me-pre">You appear as</span>
              <span className="pa-me-name">{ctl.persona.name}</span>
            </span>
            <span className="pa-me-change">Change</span>
            {ctl.personaLocked && <span id="pa-me-why" className="bd-vh">Fixed: you have added something to this board.</span>}
          </button>
        )}
        {phase === 'ready' && (
          <>
            <span className={`bd-status is-${ctl.status}`} title={status.hint} role="status"><i aria-hidden="true" /><span className="bd-status-label">{status.label}</span></span>
            {board?.type !== 'event' && <ExportMenu ctl={ctl} title={board?.title} printHref={printHref(code)} />}
            {board?.type !== 'event' && <button type="button" className="bd-iconbtn" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!ctl.canUndo || ctl.readOnly} onClick={ctl.undo}><UndoIcon /></button>}
            {board?.type !== 'event' && <button type="button" className="bd-iconbtn" aria-label="Redo" title="Redo (Shift+Ctrl/Cmd+Z)" disabled={!ctl.canRedo || ctl.readOnly} onClick={ctl.redo}><RedoIcon /></button>}
            {board?.type !== 'event' && showSummaryButton(board, ctl.isOwner) && (
              <button
                ref={summaryBtn}
                type="button"
                className="bd-sumbtn"
                aria-haspopup="dialog"
                title={board.summaryState === 'generating' && ctl.isOwner ? 'Summary (being written)' : 'Summary'}
                onClick={() => setSummaryOpen(true)}
              >
                <SummaryIcon /><span className="bd-sumbtn-label">Summary</span>
                {ctl.isOwner && board.summaryState === 'generating' && <><i className="bd-sumbtn-dot" aria-hidden="true" /><span className="bd-vh"> (being written)</span></>}
              </button>
            )}
            {ctl.isOwner && board?.type === 'retro' && (
              <button ref={themesBtn} type="button" className="bd-themesbtn" aria-haspopup="dialog" title="Group notes into themes" onClick={() => setThemesOpen(true)}>
                <span aria-hidden="true">▦</span><span className="bd-themesbtn-label">Themes</span>
              </button>
            )}
            {ctl.isOwner && (
              <button ref={settingsBtn} type="button" className="bd-iconbtn" aria-label="Board settings" title="Board settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
            )}
          </>
        )}
      </header>
      {phase === 'ready' && board?.type === 'retro' && board.retro && <RetroStage ctl={ctl} onOpenSettings={() => setSettingsOpen(true)} onOpenSummary={showSummaryButton(board, ctl.isOwner) ? () => setSummaryOpen(true) : undefined} />}
      {phase === 'ready' ? board?.type === 'event' && board.wheel ? <BoardErrorBoundary><EventBoard ctl={ctl} /></BoardErrorBoundary> : board?.type === 'wall' ? <BoardErrorBoundary><WallBody ctl={ctl} code={code} presence={realtime ? presence : null} /></BoardErrorBoundary> : <BoardErrorBoundary><Board ctl={ctl} code={code} presence={realtime ? presence : null} /></BoardErrorBoundary> : <div className="bd-board bd-loading" role="status">Loading board…</div>}
      {changing && (
        <PersonaDialog
          boardTitle={board?.title}
          participants={ctl.state.participants}
          selfUid={ctl.uid}
          current={ctl.persona}
          accountName={ctl.isOwner ? ctl.state.viewer.accountName : null}
          onClose={() => setChanging(false)}
          onSubmit={async (p) => { const r = await ctl.savePersona(p); if (!r) setChanging(false); return r }}
        />
      )}
      {settingsOpen && ctl.isOwner && <BoardSettings ctl={ctl} openerRef={settingsBtn} focusAi={focusAi} onClose={() => { setSettingsOpen(false); setFocusAi(false) }} />}
      {summaryOpen && ( // stays open when the owner withdraws the summary under a guest who is reading it: the panel then says so
        <SummaryPanel ctl={ctl} openerRef={summaryBtn} onClose={() => setSummaryOpen(false)} onOpenSettings={() => { setSummaryOpen(false); setFocusAi(true); setSettingsOpen(true) }} />
      )}
      {themesOpen && ctl.isOwner && <ThemesPanel ctl={ctl} openerRef={themesBtn} onClose={() => setThemesOpen(false)} onOpenSettings={() => { setThemesOpen(false); setFocusAi(true); setSettingsOpen(true) }} />}
      {ctl.toast && <div className="bd-toast" role="status" key={ctl.toast.id}>{ctl.toast.message}</div>}
      {phase === 'ready' && <CelebrationListener ctl={ctl} presence={presence} />}
    </div>
  )
}
