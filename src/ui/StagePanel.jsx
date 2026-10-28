'use client'
// What this stage is for, in one sentence, and the tool that goes with it. Everyone sees it; only the owner can change stages.
import { useState } from 'react'
import DiscussPanel from './DiscussPanel.jsx'
import ActionComposer from './ActionComposer.jsx'
import { jumpTo } from './useRetroJump.js'
import { votesLeft, perPerson } from './voteResults.js'

const TEXT = {
  join: 'Welcome. Choose how you appear and wait for the facilitator to start.',
  collect: 'Write what went well, what did not and what you want to change. One idea per note.',
  group: 'Drag similar notes together and name the groups. The facilitator organises the board now.',
  vote: 'Vote for the topics that matter most to you.',
  discuss: 'Talk through the most-voted topics, one at a time.',
  actions: 'Turn the discussion into actions: each needs an owner and a due date.',
  wrapup: 'Look back at what you decided and close the session.',
}

// "N" is the canvas shortcut for the sticky note tool: this presses it for you.
const pressNoteTool = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))

function Actions({ ctl, rt }) {
  const [editing, setEditing] = useState(null)
  const list = ctl.items.filter((i) => i.kind === 'action')
  const open = rt.stage.key === 'actions'
  const atLimit = !ctl.isOwner && list.length >= rt.retro.maxActions
  return (
    <div>
      {open && !ctl.readOnly && (atLimit ? <p className="rt-hint">The limit of {rt.retro.maxActions} actions is reached.</p> : !editing && <ActionComposer ctl={ctl} />)}
      <ul className="rt-actions">
        {list.map((a) => (
          <li key={a.id}>
            <button type="button" className="rt-topic-text" onClick={() => jumpTo(a.id)}>{a.data.action}</button>
            <span className={`rt-chip${a.data.owner ? '' : ' is-warn'}`}>{a.data.owner || 'Needs owner'}</span>
            <span className={`rt-chip${a.data.due ? '' : ' is-warn'}`}>{a.data.due ? `Due ${a.data.due}` : 'Needs due date'}</span>
            {open && ctl.canEdit(a) && <button type="button" className="bd-sbtn" onClick={() => setEditing(editing === a.id ? null : a.id)}>{editing === a.id ? 'Close' : 'Edit'}</button>}
            {editing === a.id && <ActionComposer ctl={ctl} initial={a} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
      {!list.length && <p className="rt-hint">No actions yet.</p>}
    </div>
  )
}

export default function StagePanel({ ctl, rt, onOpenSummary }) {
  const key = rt.stage.key
  const open = key === 'collect' && rt.retro.editing
  return (
    <div className="rt-panel">
      <p className="rt-text">{TEXT[key]}</p>
      {key === 'collect' && (open
        ? !ctl.readOnly && <button type="button" className="bd-sbtn is-primary" onClick={pressNoteTool}>Add a note</button>
        : <p className="rt-hint">Notes are closed right now.</p>)}
      {key === 'vote' && (ctl.board.vote?.active
        ? <p className="rt-text" role="status">You have {votesLeft(ctl.board, ctl.items, ctl.uid)} of {perPerson(ctl.board)} votes left. Use the vote button on a note.</p>
        : <p className="rt-hint">Voting is closed.</p>)}
      {key === 'discuss' && <DiscussPanel ctl={ctl} rt={rt} />}
      {(key === 'actions' || key === 'wrapup') && <Actions ctl={ctl} rt={rt} />}
      {key === 'wrapup' && onOpenSummary && <button type="button" className="bd-sbtn" onClick={onOpenSummary}>Open the summary</button>}
    </div>
  )
}
