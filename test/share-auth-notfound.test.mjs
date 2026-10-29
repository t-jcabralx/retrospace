import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('every board type gets the invite dialog: the owner button lives in the shared board screen, not in one board type', async () => {
  const screen = await read('src/ui/BoardScreen.jsx')
  assert.match(screen, /ctl\.isOwner[\s\S]{0,200}aria-label="Invite people/)
  assert.match(screen, /shareOpen && ctl\.isOwner && <ShareDialog/)
  assert.ok(!/board\?\.type !== 'event'[^\n]*Invite people/.test(screen)) // not hidden for any type
  const dialog = await read('src/ui/ShareDialog.jsx')
  for (const word of ['JoinQr', '/join?code=', 'Copy the join link', 'Copy the board code', 'role="dialog"', 'useModal']) assert.ok(dialog.includes(word), word)
})

test('the QR code is drawn in the browser, black on white, pointing at the join page with the code filled in', async () => {
  const qr = await read('src/ui/JoinQr.jsx')
  assert.ok(qr.includes('/join?code=') && qr.includes("dark: '#000000'") && qr.includes("light: '#ffffff'"))
  assert.ok(!/fetch\(/.test(qr)) // nothing is sent anywhere to make it
})

test('sign in and sign up share one photo layout, and each page uses it with its own mode', async () => {
  for (const [page, mode] of [['login', 'login'], ['register', 'register']]) {
    const src = await read(`src/app/${page}/page.js`)
    assert.ok(src.includes(`<AuthSplit mode="${mode}">`) && src.includes('AuthForm'), page)
  }
  const split = await read('src/ui/auth/AuthSplit.jsx')
  for (const photo of ['/photos/auth-signin.jpg', '/photos/auth-signup.jpg']) assert.ok(split.includes(photo), photo)
})

test('a missing board and any missing page show the same helpful card with a way forward', async () => {
  const card = await read('src/ui/site/NotFoundCard.jsx')
  for (const word of ['/photos/notfound.jpg', 'Enter another code', 'My boards', 'Back to home']) assert.ok(card.includes(word), word)
  assert.ok((await read('src/app/not-found.js')).includes('NotFoundCard'))
  assert.ok((await read('src/ui/BoardScreen.jsx')).includes('NotFoundCard title="We can\'t find that board" code={code}'))
})

test('the photos exist on disk and are credited', async () => {
  for (const f of ['auth-signin', 'auth-signup', 'notfound']) assert.ok((await stat(new URL(`../public/photos/${f}.jpg`, import.meta.url))).size > 20_000, f)
  const credits = await read('public/photos/CREDITS.md')
  for (const f of ['auth-signin.jpg', 'auth-signup.jpg', 'notfound.jpg']) assert.ok(credits.includes(f), f)
})
