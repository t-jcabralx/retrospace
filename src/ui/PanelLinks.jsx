import Link from 'next/link'

// The way out of a dead-end board panel (not found, revoked, error).
export default function PanelLinks() {
  return (
    <p className="bd-panel-links">
      <Link className="bd-btn" href="/">Back to home</Link>
      <Link className="bd-link" href="/join">Join another board</Link>
    </p>
  )
}
