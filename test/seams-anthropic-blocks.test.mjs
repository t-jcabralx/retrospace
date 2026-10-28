import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize, suggestThemes } from '../src/lib/ai/anthropic.js'

const reply = (content) => async () => new Response(JSON.stringify({ content, usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 })
const env = { ANTHROPIC_API_KEY: 'test-key' }
const input = { text: 'x', count: 1, ids: new Map() }

test('a thinking block before the answer does not make the reply look empty', async () => {
  const r = await summarize(input, { kind: 'retro', env, fetchImpl: reply([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'What went well: tests' }]) })
  assert.equal(r.error, undefined)
  assert.equal(r.text, 'What went well: tests')
})

test('several text blocks are joined; a reply with only a thinking block is still empty', async () => {
  const joined = await suggestThemes(input, { env, fetchImpl: reply([{ type: 'text', text: '{"themes":' }, { type: 'text', text: '[]}' }]) })
  assert.equal(joined.text, '{"themes":[]}')
  const onlyThinking = await summarize(input, { kind: 'retro', env, fetchImpl: reply([{ type: 'thinking', thinking: 'hmm' }]) })
  assert.equal(onlyThinking.error, 'empty')
})

test('a plain single text block still works', async () => {
  const r = await summarize(input, { kind: 'workshop', env, fetchImpl: reply([{ type: 'text', text: 'ok' }]) })
  assert.equal(r.text, 'ok')
})
