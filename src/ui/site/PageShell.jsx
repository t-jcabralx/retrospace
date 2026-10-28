import SiteHeader from './SiteHeader.jsx'
import SiteFooter from './SiteFooter.jsx'
import './site.css'

// Header, <main id="main"> and footer around a page. `centered` puts the content in a top-aligned centre column
// (account and join pages).
export default function PageShell({ landing = false, centered = false, children }) {
  return (
    <div className="rs-page">
      <SiteHeader landing={landing} />
      <main id="main" className={`rs-main${centered ? ' rs-center' : ''}`} tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  )
}
