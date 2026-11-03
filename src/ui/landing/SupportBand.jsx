import Link from 'next/link'

// An optional note about keeping the site running, with the same QR as /support. A fixed image, so a plain <img>:
// a QR code must reach the scanner exactly as it is, not resized or re-encoded.
export default function SupportBand() {
  return (
    <section className="ls-section ls-support" aria-labelledby="support-title">
      <div className="rs-wrap">
        <div className="ls-support-card">
          <div className="ls-support-copy">
            <h2 id="support-title">Help keep Retrospace running</h2>
            <p>Retrospace is free to use. Hosting, the database and upkeep cost money every month. If it helps your team and you would like to chip in toward web maintenance, you can send any amount with GCash or any bank or e-wallet app that supports InstaPay QR. It is entirely optional.</p>
            <Link className="rs-btn rs-btn--secondary rs-btn--lg" href="/support">Open the support page</Link>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img className="ls-support-qr" src="/support/payment-qr.jpg" width="357" height="362" alt="QR code for sending support to Retrospace. Scan it with GCash or any bank or e-wallet app that supports InstaPay QR." loading="lazy" />
        </div>
      </div>
    </section>
  )
}
