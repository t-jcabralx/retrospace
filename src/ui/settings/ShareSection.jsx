'use client'
import { Section } from './controls.jsx'
import CopyButton from '../boards/CopyButton.jsx'
import { LinkIcon } from '../site/icons.jsx'
import { boardLink, mailtoHref } from '../share.js'

// The access code and link with Copy buttons (CopyButton announces "Copied" politely), and a mail link.
export default function ShareSection({ board }) {
  const link = boardLink(window.location.origin, board.code)
  return (
    <Section title="Share">
      <div className="bd-set-item">
        <p className="bd-set-label" id="bd-share-code-l">Access code</p>
        <div className="bd-set-copyrow">
          <output className="bd-set-code" aria-labelledby="bd-share-code-l">{board.code}</output>
          <CopyButton text={board.code} label="Copy code" ariaLabel="Copy access code" />
        </div>
      </div>
      <div className="bd-set-item">
        <p className="bd-set-label" id="bd-share-link-l">Link</p>
        <div className="bd-set-copyrow">
          <output className="bd-set-link" aria-labelledby="bd-share-link-l">{link}</output>
          <CopyButton text={link} label="Copy link" ariaLabel="Copy board link" Icon={LinkIcon} />
        </div>
      </div>
      <a className="bd-sbtn bd-set-mail" href={mailtoHref(board.title, board.code, link)}>Share by email</a>
    </Section>
  )
}
