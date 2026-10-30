import './globals.css'
import { siteUrl } from '../lib/meta.js'
import { verificationFrom } from '../lib/seo.js'
import { SITE_TITLE as TITLE, SITE_DESCRIPTION as DESCRIPTION } from '../lib/siteText.js'

export const metadata = {
  metadataBase: siteUrl(),
  title: { default: TITLE, template: '%s · Retrospace' },
  description: DESCRIPTION,
  applicationName: 'Retrospace',
  authors: [{ name: 'Jason Cabral' }],
  verification: verificationFrom(),
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Retrospace', type: 'website', locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#12141a' },
  ],
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
