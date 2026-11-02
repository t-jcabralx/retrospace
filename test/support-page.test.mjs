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
})
