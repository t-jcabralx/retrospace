import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderEmail, escapeHtml } from '../src/lib/emailLayout.js'
import { resetEmail, RESET_TTL_MS } from '../src/lib/passwordReset.js'
import { issueEmail } from '../src/lib/issueReport.js'

const ORIGIN = 'https://retro.example'
const base = { origin: ORIGIN, preheader: 'Pre', title: 'A title', paragraphs: ['Hello there'], button: { label: 'Go', url: `${ORIGIN}/x?a=1&b=2` }, note: 'A note', fallback: true, after: ['Bye'], footer: 'Because.' }

describe('the layout', () => {
  const { html, text } = renderEmail(base)

  test('it is a complete, responsive HTML email', () => {
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<meta charset="utf-8">/)
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/)
    assert.match(html, /max-width:560px/)
    assert.match(html, /@media \(max-width: 520px\)/, 'small screens')
    assert.match(html, /@media \(prefers-color-scheme: dark\)/, 'dark mode')
    assert.match(html, /<meta name="color-scheme" content="light dark">/)
    assert.match(html, /<title>A title<\/title>/)
    assert.match(html, /<h1[^>]*>A title<\/h1>/)
    assert.ok(html.length < 40_000, 'far under the 102 KB where Gmail starts cutting a message')
  })

  test('it is built from tables with inline styles, a bulletproof button and no scripts, forms or remote CSS', () => {
    assert.match(html, /<table role="presentation"/)
    assert.match(html, /<a class="btn" href="https:\/\/retro\.example\/x\?a=1&amp;b=2" style="[^"]*padding:14px 28px/)
    assert.doesNotMatch(html, /<script|<form|<link |<iframe|javascript:/i)
  })

  test('the logo is the site\'s own icon, optional, and every image is decoration with an empty alt', () => {
    assert.match(html, /<img src="https:\/\/retro\.example\/apple-icon"[^>]*alt=""/)
    for (const tag of html.match(/<img[^>]*>/g)) assert.match(tag, /alt=/)
    const none = renderEmail({ ...base, origin: null }).html
    assert.doesNotMatch(none, /<img/)
    assert.match(none, />Retrospace</, 'the wordmark is text, so it shows even with no image')
  })

  test('a preheader is hidden, the footer links home and to the report page, and the note and fallback link are there', () => {
    assert.match(html, /display:none[^>]*>Pre/)
    assert.match(html, /href="https:\/\/retro\.example"/)
    assert.match(html, /href="https:\/\/retro\.example\/issue"/)
    assert.match(html, /A note/)
    assert.match(html, /Button not working\?[\s\S]*https:\/\/retro\.example\/x\?a=1&amp;b=2/)
    assert.match(html, /Because\./)
  })

  test('the plain-text version carries the same words and link, with no markup', () => {
    for (const s of ['A title', 'Hello there', 'Go: https://retro.example/x?a=1&b=2', 'A note', 'Bye', 'Because.', 'https://retro.example/issue']) assert.ok(text.includes(s), s)
    assert.doesNotMatch(text, /<[a-z]|&amp;|&lt;/i)
  })

  test('everything a person typed is escaped, in titles, paragraphs, quotes, buttons and links', () => {
    const evil = '<img src=x onerror=alert(1)> "quoted" & \'single\''
    const out = renderEmail({ ...base, title: evil, paragraphs: [evil, { quote: evil }], button: { label: evil, url: `${ORIGIN}/?q=${evil}` }, note: evil, after: [evil], footer: evil, preheader: evil }).html
    assert.doesNotMatch(out, /<img src=x|<script/, 'no raw tag from typed text')
    assert.doesNotMatch(out, /["']\s*onerror\s*=/, 'no way out of an attribute')
    assert.ok(out.includes(escapeHtml(evil)), 'the text is there, as text')
  })

  test('a quote keeps its line breaks in the page and gets quote marks in the text', () => {
    const out = renderEmail({ ...base, paragraphs: [{ quote: 'line one\nline two' }] })
    assert.match(out.html, /white-space:pre-wrap[^>]*>line one\nline two</)
    assert.match(out.text, /> line one\n> line two/)
  })

  test('it works with the least: a title and nothing else', () => {
    const out = renderEmail({ title: 'Only a title' })
    assert.match(out.html, /Only a title/)
    assert.match(out.text, /^Only a title\n/)
  })
})

describe('the password reset email', () => {
  const link = `${ORIGIN}/reset?token=${'a'.repeat(43)}`
  const m = resetEmail({ name: 'Jason <b>', link })

  test('it says what it is for, has the button and the link, the lifetime, and the "not me" lines', () => {
    assert.equal(m.subject, 'Reset your Retrospace password')
    assert.match(m.html, /<h1[^>]*>Reset your password<\/h1>/)
    assert.match(m.html, new RegExp(`<a class="btn" href="${link.replace(/[.?]/g, '\\$&')}"`))
    assert.match(m.html, /Choose a new password/)
    assert.match(m.html, new RegExp(`expires in ${RESET_TTL_MS / 60_000} minutes`))
    assert.match(m.html, /If this wasn't you|If this wasn&#39;t you/)
    assert.match(m.html, /never ask you for your password by email/)
    assert.ok(m.text.includes(link) && m.text.includes('30 minutes'))
  })

  test('the name is escaped, and the logo and footer follow the link\'s own site', () => {
    assert.match(m.html, /Hi Jason &lt;b&gt;,/)
    assert.doesNotMatch(m.html, /<b>/)
    assert.match(m.html, /src="https:\/\/retro\.example\/apple-icon"/)
    assert.match(resetEmail({ name: 'A', link: 'https://other.example/reset?token=x' }).html, /src="https:\/\/other\.example\/apple-icon"/)
  })

  test('a link that is not a URL still produces a working email, just without the logo', () => {
    const odd = resetEmail({ name: 'A', link: 'not a url' })
    assert.doesNotMatch(odd.html, /<img/)
    assert.match(odd.html, /not a url/)
  })
})

describe('the issue report email', () => {
  const at = Date.UTC(2026, 10, 3, 9, 5)

  test('the report sits in a quote box with its line breaks, the time, and a Reply button when there is an address', () => {
    const m = issueEmail({ message: 'It broke\non my phone', email: 'me@example.com' }, { origin: ORIGIN, now: at })
    assert.match(m.html, /<h1[^>]*>New issue report<\/h1>/)
    assert.match(m.html, /Received 2026-11-03 09:05 UTC\./)
    assert.match(m.html, /white-space:pre-wrap[^>]*>It broke\non my phone</)
    assert.match(m.html, /href="mailto:me@example\.com"/)
    assert.match(m.html, />Reply to me@example\.com</)
    assert.equal(m.replyTo, 'me@example.com')
    assert.ok(m.text.includes('Reply to: me@example.com') && m.text.includes('> It broke\n> on my phone'))
  })

  test('without an address there is no reply button and no reply-to, and it says so', () => {
    const m = issueEmail({ message: 'Anonymous problem here' }, { origin: ORIGIN, now: at })
    assert.doesNotMatch(m.html, /mailto:/)
    assert.equal('replyTo' in m, false)
    assert.match(m.html, /left no email address/)
  })

  test('hostile text is escaped, and a missing site address just drops the logo and links', () => {
    const m = issueEmail({ message: '<script>alert(1)</script> & "x"', email: 'me@example.com' }, { origin: null, now: at })
    assert.doesNotMatch(m.html, /<script/)
    assert.match(m.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/)
    assert.doesNotMatch(m.html, /<img/)
  })
})
