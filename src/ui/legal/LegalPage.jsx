import Link from 'next/link'
import { UPDATED, CONTACT } from './legalData.js'
import './legal.css'

// A plain document page: a title, the date, numbered sections and the contact line. Text between backticks is shown as code.
const renderText = (t) => t.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part))

export default function LegalPage({ title, intro, sections, other }) {
  return (
    <article className="rs-wrap lg">
      <p className="lg-eyebrow">Last updated {UPDATED}</p>
      <h1>{title}</h1>
      <p className="lg-intro">{intro}</p>
      <nav className="lg-toc" aria-label="Sections">
        {sections.map(([h], i) => <a key={h} href={`#s${i + 1}`}>{i + 1}. {h}</a>)}
      </nav>
      {sections.map(([h, paras], i) => (
        <section key={h} id={`s${i + 1}`} aria-labelledby={`h${i + 1}`}>
          <h2 id={`h${i + 1}`}>{i + 1}. {h}</h2>
          {paras.map((p) => <p key={p}>{renderText(p)}</p>)}
        </section>
      ))}
      <p className="lg-contact">Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a> · <Link href={other.href}>{other.label}</Link> · <Link href="/">Back to home</Link></p>
    </article>
  )
}
