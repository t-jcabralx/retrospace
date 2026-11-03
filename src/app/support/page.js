import Link from 'next/link'
import PageShell from '../../ui/site/PageShell.jsx'
import PageBanner from '../../ui/site/PageBanner.jsx'
import './support.css'

export const metadata = {
  title: 'Support Retrospace',
  description: 'Retrospace is free to use. If it helps you, you can chip in toward keeping it running by scanning a QR code.',
  alternates: { canonical: '/support' },
}

const STEPS = ['Open GCash, or your bank or e-wallet app', 'Choose Scan QR and scan the code', 'Enter any amount you like and send']

// A banner, then the note and steps beside the QR (stacked on a phone). The image is a file in public/support: replace it to
// change where support goes. A QR must reach the scanner exactly as it is, so it is a plain <img>, never resized or re-encoded.
export default function SupportPage() {
  return (
    <PageShell>
      <article className="rs-wrap sp">
        <PageBanner src="/photos/support.jpg" />
        <div className="sp-grid">
          <div className="sp-copy">
            <h1>Support Retrospace</h1>
            <p className="sp-intro">Retrospace is free to use. Hosting, the database and upkeep cost money every month. If it helps your team and you would like to chip in toward keeping it running, you can. It is entirely optional, and nothing on the site depends on it.</p>
            <ol className="sp-steps">
              {STEPS.map((s, i) => <li key={s}><span className="sp-num" aria-hidden="true">{i + 1}</span>{s}</li>)}
            </ol>
          </div>
          <figure className="sp-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- see the note above the component */}
            <img className="sp-qr" src="/support/payment-qr.jpg" width="357" height="362" alt="QR code for sending support to Retrospace. Scan it with GCash or any bank or e-wallet app that supports InstaPay QR." />
            <figcaption>Scan with GCash or any InstaPay QR app</figcaption>
          </figure>
        </div>
        <p className="sp-thanks">Thank you. Using Retrospace and telling a friend helps just as much.</p>
        <p className="sp-back"><Link href="/">Back to home</Link></p>
      </article>
    </PageShell>
  )
}
