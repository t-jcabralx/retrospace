import test from 'node:test'
import assert from 'node:assert/strict'
import { boardLink, revealLink, mailtoHref } from '../src/ui/share.js'

test('boardLink joins the origin and the code', () => {
  assert.equal(boardLink('https://retro.example', 'ABC234'), 'https://retro.example/b/ABC234')
  assert.equal(boardLink('http://localhost:3000/', 'ABC234'), 'http://localhost:3000/b/ABC234')
})

test('mailtoHref encodes the subject and the body with encodeURIComponent', () => {
  const link = boardLink('https://retro.example', 'ABC234')
  const href = mailtoHref('Q3 retro & "wins"', 'ABC234', link)
  assert.ok(href.startsWith('mailto:?subject='))
  const [, subject, body] = /^mailto:\?subject=([^&]*)&body=(.*)$/.exec(href)
  assert.equal(decodeURIComponent(subject), 'Join "Q3 retro & "wins"" on Retrospace')
  assert.equal(decodeURIComponent(body), 'Join with code ABC234 or open https://retro.example/b/ABC234')
  assert.equal(subject, encodeURIComponent('Join "Q3 retro & "wins"" on Retrospace'))
  assert.ok(!subject.includes(' ') && !subject.includes('&') && !body.includes(' '))
})

test('a title full of markup or newlines stays inside the subject', () => {
  const href = mailtoHref('<b>x</b>\r\nBcc: evil@example.com', 'ABC234', 'https://x.test/b/ABC234')
  assert.ok(!/[\r\n]/.test(href))
  const subject = decodeURIComponent(/subject=([^&]*)/.exec(href)[1])
  assert.ok(!/[\r\n]/.test(subject), 'no header injection through a line break')
  assert.equal(href.split('&').length, 2, 'only the subject and the body parameters')
})

test('revealLink is the recipient page of the same board', () => {
  assert.equal(revealLink('https://retro.example', 'ABC234'), 'https://retro.example/b/ABC234/reveal')
  assert.equal(revealLink('http://localhost:3000/', 'ABC234'), 'http://localhost:3000/b/ABC234/reveal')
})
