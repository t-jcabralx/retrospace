'use client'
// The owner's board settings: a right-hand drawer with General, Celebration (celebration boards), Access, Share, Voting, Timer, Throw emoji and AI summaries. Every
// change is a PATCH through useOwnerActions; the answer updates this tab and the stream updates everybody else. It is a
// modal dialog: focus moves in and is kept in, Esc closes, the board behind is inert, and focus goes back to the opener.
import { useId, useRef } from 'react'
import { useModal } from './boards/useModal.js'
import { useOwnerActions } from './useOwnerActions.js'
import { CloseIcon } from './icons.jsx'
import GeneralSection from './settings/GeneralSection.jsx'
import CelebrationSection from './settings/CelebrationSection.jsx'
import AccessSection from './settings/AccessSection.jsx'
import ShareSection from './settings/ShareSection.jsx'
import VotingSection from './settings/VotingSection.jsx'
import TimerSection from './settings/TimerSection.jsx'
import ThrowablesSection from './settings/ThrowablesSection.jsx'
import AiSection from './settings/AiSection.jsx'
import ColumnsSection from './settings/ColumnsSection.jsx'
import PeopleSection from './settings/PeopleSection.jsx'
import StagesSection from './settings/StagesSection.jsx'
import AnonymitySection from './settings/AnonymitySection.jsx'
import PeopleEditor from './PeopleEditor.jsx'
import './site/site.css'
import './settings.css'

const BEHIND = '.bd-top, .bd-board'

// What is switched on, at a glance.
function Status({ board }) {
  const chips = [
    board.locked && 'Locked',
    board.status === 'closed' && 'Closed',
    board.revoked && 'Link revoked',
    board.hasPasscode && 'Passcode on',
  ].filter(Boolean)
  return (
    <ul className="bd-set-chips" aria-label="Current access">
      {chips.length ? chips.map((c) => <li key={c} className="bd-set-chip is-on">{c}</li>) : <li className="bd-set-chip">Open to anyone with the code</li>}
    </ul>
  )
}

export default function BoardSettings({ ctl, onClose, openerRef, focusAi = false }) {
  const root = useRef(null)
  const titleId = useId()
  const { patchBoard, resetVotes } = useOwnerActions(ctl)
  useModal(root, onClose, openerRef, { inert: BEHIND })
  const { board } = ctl

  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={root} className="bd-settings" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="bd-settings-head">
          <h2 id={titleId}>Board settings</h2>
          <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close settings" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="bd-settings-body">
          <Status board={board} />
          <GeneralSection board={board} patchBoard={patchBoard} />
          {board.type === 'celebration' && <CelebrationSection ctl={ctl} board={board} patchBoard={patchBoard} />}
          {(board.type === 'retro' || board.type === 'workshop') && <ColumnsSection ctl={ctl} board={board} />}
          {board.type === 'retro' && board.retro && <StagesSection retro={board.retro} patchBoard={patchBoard} />}
          {board.type === 'wall' && <PeopleEditor ctl={ctl} />}
          <AccessSection board={board} patchBoard={patchBoard} />
          <ShareSection board={board} />
          <PeopleSection ctl={ctl} />
          {/* The retro workflow drives voting and the timer (the Stages section sets votes and durations). */}
          {!(board.type === 'retro' && board.retro) && <VotingSection board={board} patchBoard={patchBoard} resetVotes={resetVotes} />}
          {!(board.type === 'retro' && board.retro) && <TimerSection ctl={ctl} patchBoard={patchBoard} />}
          <ThrowablesSection board={board} patchBoard={patchBoard} />
          {board.type === 'retro' && <AnonymitySection board={board} patchBoard={patchBoard} />}
          <AiSection board={board} patchBoard={patchBoard} info={ctl.state.viewer?.ai} focusOnMount={focusAi} />
        </div>
      </aside>
    </>
  )
}
