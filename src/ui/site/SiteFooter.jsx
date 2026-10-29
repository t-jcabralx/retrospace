import Link from 'next/link'
import { LogoMark } from './Logo.jsx'
import FooterNav from './FooterNav.jsx'

export default function SiteFooter() {
  return (
    <footer className="rs-footer">
      <div className="rs-footer-in">
        <div className="rs-footer-brand">
          <Link className="rs-logo" href="/" aria-label="Retrospace home">
            <LogoMark size={28} />
            <span className="rs-wordmark">Retrospace</span>
          </Link>
          <p>Live boards for retrospectives, workshops and celebrations. Join with a code, no account needed.</p>
        </div>
        <FooterNav />
      </div>
      <p className="rs-footer-legal">© 2026 Jason Cabral. All rights reserved. Partners with Veehk Corps. Photos from <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a>.</p>
    </footer>
  )
}
