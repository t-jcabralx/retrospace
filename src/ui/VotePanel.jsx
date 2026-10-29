'use client'
// The voting HUD under the top bar. While voting is open: "Voting open — N votes left" with one dot per vote (filled =
// used), and Stop / Reset for the owner. Once it has stopped and somebody voted: "Results", the top three notes (ties
// stay together) with a button that jumps to each. Voting itself happens on the notes (ItemView).
import { useId, useState } from 'react'
import { SaveNote } from './settings/controls.jsx'
import ResetVotes from './settings/ResetVotes.jsx'
import { useSetting } from './settings/useSetting.js'
import { useOwnerActions } from './useOwnerActions.js'
import { perPerson, votesUsed, anyVotes, topVoted, excerpt } from './voteResults.js'
import { VoteIcon, TrophyIcon } from './icons.jsx'
import Ballot from './Ballot.jsx'
import './settings.css'

const plural = (n, one, many) => (n === 1 ? one : many)

function Dots({ total, used }) {
  return (
    <span className="bd-vote-dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < used ? 'is-used' : ''} />)}
    </span>
  )
}

function OwnerActions({ ctl, open, per, onDone }) {
  const { patchBoard, resetVotes } = useOwnerActions(ctl)
  const toggle = useSetting(patchBoard)
  return (
    <div className="bd-vote-owner">
      <div className="bd-set-actions">
        <button type="button" className="bd-sbtn" disabled={toggle.busy} onClick={() => toggle.save({ vote: { active: !open, perPerson: per } })}>{open ? 'Stop voting' : 'Start voting'}</button>
        <ResetVotes resetVotes={resetVotes} onDone={onDone} />
      </div>
      <SaveNote setting={toggle} />
    </div>
  )
}

// `onJump(id)`: centre the canvas on that item and focus it.
export default function VotePanel({ ctl, onJump }) {
  const { board, items, uid, isOwner, readOnly } = ctl
  const id = useId()
  const [collapsed, setCollapsed] = useState(false)
  const [manage, setManage] = useState(false)
  const [ballot, setBallot] = useState(true) // the voter card starts open while voting is open; "My votes" folds it away
  const open = Boolean(board?.vote?.active)
  const voted = anyVotes(items)
  if (!open && !voted) return null

  const per = perPerson(board)
  const used = votesUsed(items, uid)
  const left = Math.max(0, per - used)

  if (open) {
    return (
      <div className="bd-vote" role="region" aria-label="Voting">
        <div className="bd-vote-bar">
          <VoteIcon width={18} height={18} aria-hidden="true" />
          {readOnly ? (
            <span className="bd-vote-line">Voting open — view only</span>
          ) : (
            <>
              <span className="bd-vote-line">Voting open — <strong>{left}</strong> {plural(left, 'vote', 'votes')} left</span>
              <Dots total={per} used={used} />
            </>
          )}
          {!readOnly && <button type="button" className="bd-sbtn bd-vote-manage" aria-expanded={ballot} aria-controls={`${id}-b`} onClick={() => setBallot((b) => !b)}>My votes</button>}
          {isOwner && <button type="button" className="bd-sbtn bd-vote-manage" aria-expanded={manage} aria-controls={`${id}-m`} onClick={() => setManage((m) => !m)}>Manage</button>}
        </div>
        {!readOnly && ballot && <div id={`${id}-b`}><Ballot ctl={ctl} onJump={onJump} /></div>}
        {isOwner && manage && <div id={`${id}-m`}><OwnerActions ctl={ctl} open per={per} onDone={() => setManage(false)} /></div>}
      </div>
    )
  }

  const top = topVoted(items)
  return (
    <div className="bd-vote" role="region" aria-label="Voting results">
      <div className="bd-vote-bar">
        <TrophyIcon width={18} height={18} aria-hidden="true" />
        <span className="bd-vote-line">Results</span>
        <button type="button" className="bd-sbtn bd-vote-manage" aria-expanded={!collapsed} aria-controls={`${id}-r`} onClick={() => setCollapsed((c) => !c)}>{collapsed ? 'Show' : 'Hide'}</button>
        {isOwner && <button type="button" className="bd-sbtn bd-vote-manage" aria-expanded={manage} aria-controls={`${id}-m`} onClick={() => setManage((m) => !m)}>Manage</button>}
      </div>
      {!collapsed && (
        <ol id={`${id}-r`} className="bd-vote-results">
          {top.map((r) => (
            <li key={r.id} className="bd-vote-result">
              <span className="bd-vote-rank" aria-label={`Place ${r.rank}`}>{r.rank}</span>
              <span className="bd-vote-text">{excerpt(r.item, 48)}</span>
              <span className="bd-vote-count">{r.count} {plural(r.count, 'vote', 'votes')}</span>
              <button type="button" className="bd-sbtn" aria-label={`Go to ${excerpt(r.item, 40)}`} onClick={() => onJump(r.id)}>Go to</button>
            </li>
          ))}
        </ol>
      )}
      {isOwner && manage && <div id={`${id}-m`}><OwnerActions ctl={ctl} open={false} per={per} onDone={() => setManage(false)} /></div>}
    </div>
  )
}
