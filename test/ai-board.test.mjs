import test from 'node:test'
import assert from 'node:assert/strict'
import { viewerBoard } from '../src/lib/access.js'
import { summaryStateOf, aiOf, aiReady, cleanSummaryText, STALE_MS } from '../src/lib/aiBoard.js'

const draft = { text: 'DRAFT-TEXT-SECRET', status: 'draft', source: 'ai', model: 'claude-haiku-5-5', generatedAt: 5, editedAt: null }
const base = { code: 'ABC234', ownerId: 'u_1', createdBy: 'u_1', title: 'T', passcodeHash: 'h', status: 'open', ai: { enabled: true, ackAt: 3, autoSummary: true, autoShare: false }, summaryStartedAt: 1, autoSummaryFor: 2, closedAt: 2, summaryError: 'busy' }

test('a guest never gets a draft, the AI settings, bookkeeping or a failure', () => {
  const g = viewerBoard({ ...base, summary: draft, summaryState: 'failed' }, 'guest')
  assert.equal(g.summary, null)
  assert.equal(g.summaryState, 'idle')
  for (const k of ['ai', 'summaryError', 'summaryStartedAt', 'autoSummaryFor', 'closedAt', 'ownerId', 'createdBy', 'passcodeHash']) assert.ok(!Object.hasOwn(g, k), k)
  assert.ok(!JSON.stringify(g).includes('DRAFT-TEXT-SECRET'))
})

test('a guest gets a shared summary with its source and edit mark, never the model or timestamps', () => {
  const shared = { ...draft, status: 'shared', editedAt: 77 }
  const g = viewerBoard({ ...base, summary: shared, summaryState: 'idle' }, 'guest')
  assert.deepEqual(g.summary, { text: 'DRAFT-TEXT-SECRET', status: 'shared', source: 'ai', editedAt: 77 })
  assert.ok(!JSON.stringify(g).includes('claude-haiku'))
})

test('a guest sees only "generating" or "idle", never "failed", and a stale flag is not "generating"', () => {
  const now = Date.now()
  assert.equal(viewerBoard({ ...base, summaryState: 'generating', summaryStartedAt: now }, 'guest').summaryState, 'generating')
  assert.equal(viewerBoard({ ...base, summaryState: 'generating', summaryStartedAt: now - STALE_MS - 1 }, 'guest').summaryState, 'idle')
  assert.equal(viewerBoard({ ...base, summaryState: 'failed' }, 'guest').summaryState, 'idle')
})

test('the owner sees the draft, the ai settings and a failure with its code', () => {
  const o = viewerBoard({ ...base, summary: draft, summaryState: 'failed', summaryError: 'busy' }, 'owner')
  assert.deepEqual(o.summary, draft)
  assert.deepEqual(o.ai, base.ai)
  assert.deepEqual([o.summaryState, o.summaryError, o.ownerId], ['failed', 'busy', 'u_1'])
  for (const k of ['summaryStartedAt', 'autoSummaryFor', 'closedAt', 'passcodeHash']) assert.ok(!Object.hasOwn(o, k), k)
  // a board made before AI existed gets the defaults
  const old = viewerBoard({ code: 'ABC234', ownerId: 'u_1' }, 'owner')
  assert.deepEqual([old.ai, old.summary, old.summaryState], [{ enabled: false, ackAt: null, autoSummary: false, autoShare: false }, null, 'idle'])
  const stale = viewerBoard({ ...base, summaryState: 'generating', summaryStartedAt: 1 }, 'owner')
  assert.deepEqual([stale.summaryState, stale.summaryError], ['failed', 'timeout'])
})

test('aiReady needs both the switch and the acknowledgement; summaryStateOf defaults to idle', () => {
  assert.equal(aiReady({ ai: { enabled: true, ackAt: 5 } }), true)
  assert.equal(aiReady({ ai: { enabled: true, ackAt: null } }), false)
  assert.equal(aiReady({ ai: { enabled: false, ackAt: 5 } }), false)
  assert.equal(aiReady({}), false)
  assert.equal(aiOf({ ai: 'junk' }).enabled, false)
  assert.equal(summaryStateOf({}), 'idle')
})

test('cleanSummaryText keeps line breaks, drops control characters', () => {
  assert.equal(cleanSummaryText('a\r\nb\u0000\u0007\tc\n\n\n\nd '), 'a\nb\tc\n\nd')
  assert.equal(cleanSummaryText(5), '')
})
