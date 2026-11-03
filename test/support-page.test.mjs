import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('the support page shows the payment QR with a description, and the footer links to it', async () => {
  const page = await read('src/app/support/page.js')
  assert.match(page, /export const metadata/)
  assert.match(page, /src="\/support\/payment-qr\.jpg"/)
  assert.match(page, /alt="QR code for sending support to Retrospace[^"]*GCash/)
  assert.ok((await stat(new URL('../public/support/payment-qr.jpg', import.meta.url))).size > 5000, 'the QR image is there')
  assert.ok((await read('src/ui/site/FooterNav.jsx')).includes('href="/support"'))
})

test('the page asks nobody for anything: it is optional and says so', async () => {
  const page = await read('src/app/support/page.js')
  assert.match(page, /entirely optional/)
  assert.match(page, /Choose Scan QR/)
})

test('the landing page has an optional support note with the same QR, above the closing call to action', async () => {
  const page = await read('src/app/page.js')
  assert.match(page, /<SupportBand \/>/)
  assert.ok(page.indexOf('<SupportBand />') < page.indexOf('<ClosingCta />') && page.indexOf('<HowItWorks />') < page.indexOf('<SupportBand />'))
  const band = await read('src/ui/landing/SupportBand.jsx')
  assert.match(band, /src="\/support\/payment-qr\.jpg"/)
  assert.match(band, /href="\/support"/)
  assert.match(band, /entirely optional/)
})

test('the support, terms and privacy pages have a photo banner, the report page has a photo beside the form, and every photo is credited', async () => {
  for (const [file, photo] of [['src/app/support/page.js', '/photos/support.jpg'], ['src/app/terms/page.js', '/photos/workshop.jpg'], ['src/app/privacy/page.js', '/photos/auth-signin.jpg']]) {
    const page = await read(file)
    assert.ok(page.includes(photo), file)
    assert.ok((await stat(new URL(`../public${photo}`, import.meta.url))).size > 5000, photo)
  }
  assert.match(await read('src/ui/auth/AuthSplit.jsx'), /issue: \{\s+photo: '\/photos\/issue\.jpg'/)
  assert.match(await read('src/app/issue/page.js'), /<AuthSplit mode="issue">/)
  const credits = await read('public/photos/CREDITS.md')
  for (const name of ['issue.jpg', 'support.jpg']) assert.ok(credits.includes(name), name)
})
