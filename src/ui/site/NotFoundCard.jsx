import Image from 'next/image'
import Link from 'next/link'
import './notfound.css'

// A friendly dead end: a photo, what happened, and the next steps. Used for a board code nobody has and for any other missing page.
export default function NotFoundCard({ title, code, children, joinHref = '/join' }) {
  return (
    <div className="rs-wrap nf">
      <div className="nf-card">
        <div className="nf-photo"><Image src="/photos/notfound.jpg" alt="" fill priority sizes="(min-width: 760px) 720px, 100vw" /></div>
        <div className="nf-body">
          <p className="nf-eyebrow">Not found</p>
          <h1>{title}</h1>
          {code && <p className="nf-code" aria-label={`The code you entered is ${code}`}>Code <code>{code}</code></p>}
          <div className="nf-text">{children}</div>
          <div className="nf-actions">
            <Link className="rs-btn rs-btn--primary rs-btn--lg" href={joinHref}>Enter another code</Link>
            <Link className="rs-btn rs-btn--secondary rs-btn--lg" href="/boards">My boards</Link>
            <Link className="rs-btn rs-btn--ghost rs-btn--lg" href="/">Back to home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
