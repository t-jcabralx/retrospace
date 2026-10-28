'use client'
import { memo } from 'react'
import Link from 'next/link'
import { typeInfo, templateLabel } from '../../lib/boardTypes.js'
import { getTemplate } from '../../lib/templates.js'
import { relativeTime } from '../../lib/time.js'
import { typeIcon, LinkIcon } from '../site/icons.jsx'
import CopyButton from './CopyButton.jsx'
import { revealLink } from '../share.js'

// One chip per state that limits access, in the order an owner cares about.
export function statusChips(b) {
  const chips = []
  if (b.revoked) chips.push({ label: 'Revoked', tone: 'bad' })
  if (b.status === 'closed') chips.push({ label: 'Closed', tone: 'warn' })
  if (b.locked) chips.push({ label: 'Locked', tone: 'warn' })
  if (b.hasPasscode) chips.push({ label: 'Passcode', tone: 'accent' })
  return chips
}

function BoardCard({ board, now }) {
  const { code, title, type, template } = board
  const recipient = type === 'celebration' ? board.recipient?.name : ''
  const info = typeInfo(type)
  const Icon = typeIcon(type)
  const emoji = getTemplate(type, template)?.emoji
  const chips = statusChips(board)
  const updated = relativeTime(board.updatedAt, now)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return (
    <article className="rs-card db-card" aria-labelledby={`card-${code}`}>
      <div className="db-card-top">
        <span className="rs-chip rs-chip--accent"><Icon width={14} height={14} />{info.short}</span>
        <span className="db-tpl-label">{emoji && <span aria-hidden="true">{emoji}</span>}{templateLabel(type, template)}</span>
      </div>
      <h2 className="db-card-title" id={`card-${code}`}>{title}</h2>
      {recipient && <p className="db-for"><span className="rs-chip rs-chip--ok">For {recipient}</span></p>}
      {chips.length > 0 && (
        <ul className="db-chips" aria-label="Board status">
          {chips.map((c) => <li key={c.label} className={`rs-chip rs-chip--${c.tone}`}>{c.label}</li>)}
        </ul>
      )}
      <div className="db-code">
        <span className="db-code-label">Access code</span>
        <span className="db-code-value">{code}</span>
      </div>
      <div className="db-copy-row">
        <CopyButton text={code} label="Copy code" ariaLabel={`Copy code for ${title}`} />
        <CopyButton text={`${origin}/b/${code}`} label="Copy link" ariaLabel={`Copy link for ${title}`} Icon={LinkIcon} />
        {recipient && <CopyButton text={revealLink(origin, code)} label="Recipient link" ariaLabel={`Copy recipient link for ${title}`} Icon={LinkIcon} />}
      </div>
      <div className="db-card-foot">
        <span className="db-updated">{updated ? `Updated ${updated}` : ''}</span>
        <Link className="rs-btn rs-btn--primary rs-btn--sm" href={`/b/${code}`} aria-label={`Open ${title}`}>Open</Link>
      </div>
    </article>
  )
}

export default memo(BoardCard)
