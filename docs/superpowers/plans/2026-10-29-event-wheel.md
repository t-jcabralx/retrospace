# Event board and Spin to win Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `event` board type whose screen is a two-ring prize wheel (outer ring participants, inner ring prizes) run in two steps by the owner and named helpers, watched live by everyone.

**Architecture:** All round logic lives in one pure module (`src/lib/wheel.js`) used by the server route and the tests. The server picks every result (`crypto.randomInt`) and stores a spin record `{ id, step, index, startAt, durationMs }` on the board; the existing realtime `board` message carries it to every client, which animates to the same angle at the same server time. Setup is a validated PATCH field; round actions go through one owner-or-helper route with a compare-and-set on `rev`.

**Tech Stack:** Next.js 16 (JSX, route handlers), React 19, MongoDB or the memory store, Upstash pub/sub, `node --test`.

**Spec:** `docs/specs/2026-10-29-event-wheel-design.md`

## Global Constraints

- Board type key `event`, template key `raffle`; no canvas items (`ALLOWED_KINDS.event = []`).
- Limits: 200 participants, 30 prizes, prize quantity 1 to 99, names up to 60 characters, 10 helpers, history 500 lines.
- Spin duration 5000 ms for the prize step and 6000 ms for the winner step; start lead 700 ms after the server's `now`; 5 whole extra turns.
- Results come from `crypto.randomInt` on the server only; the client never chooses an index.
- Only the owner edits setup and helpers; the owner and helpers run the round.
- Reduced motion shows the result without spinning. No browser fullscreen API (Present mode is a CSS layout).
- Every source file stays under 350 lines; keep to the repo's idiom (JSX, no TypeScript, comments only where the why is not obvious).

## Review Focus

- Two helpers press Spin in the same moment: exactly one spin starts (`rev` compare-and-set), the other gets a clear 409.
- A guest or an ex-helper posts to the wheel route: refused (401/403), nothing changes.
- One participant or one prize left, or an empty list: Spin is refused with a plain message, never a crash.
- A winner is accepted twice, or Undo after a second Accept: quantities and history stay consistent.
- Someone opens the board mid-spin or after it: they see the right state, not a spin that restarts.

---

### Task 1: Pure wheel module

**Files:** Create `src/lib/wheel.js`; Test `test/wheel.test.mjs`

**Interfaces:**
- Produces: `defaultWheel()`, `cleanSetup(input)` -> `{ value } | { error }` (participants `{id,name,on,joinedUid?}`, prizes `{id,name,emoji,qty,color}`, helpers `[uid]`, `rules {removeWinners}`), `startSpin(wheel, step, { now, pick })` -> `{ wheel } | { error }`, `applyAction(wheel, action, { now, pick, by })` -> `{ wheel } | { error }` for `accept | skip | undo | back`, `eligible(wheel)` -> `{ participants, prizes }`, `spinAngle(index, count, turns)` -> degrees, `historyRows(wheel)` -> arrays for CSV, `isRunner(wheel, uid, isOwner)`.
- [ ] Failing tests: default shape; `cleanSetup` limits, trims, drops blank and duplicate names, rejects bad quantities; state machine (idle -> prizeChosen -> winnerChosen -> accept; skip keeps the prize and sits the winner out; undo restores quantities and removes the history line; back from prizeChosen); prize at zero leaves `eligible`; `removeWinners` off keeps the winner; empty lists refuse a spin; `pick` is called with the eligible count and its result used verbatim; `spinAngle` lands the slice centre under the pointer for several counts.
- [ ] Implement the module; run the file; all pass.
- [ ] Commit `Add the pure wheel module`.

### Task 2: The Event board type

**Files:** Modify `src/lib/boardTypes.js`, `src/lib/templates.js`, `src/lib/plan.js` (`ALLOWED_KINDS`), `src/app/api/boards/route.js` (create with `wheel: defaultWheel()`), `src/lib/access.js` (guest-safe view keeps `wheel`), `src/client/state.js` (`BOARD_FIELDS.wheel`); Tests `test/event-board.test.mjs`

**Interfaces:** Consumes `defaultWheel`. Produces a created board `{ type: 'event', template: 'raffle', wheel }` visible to guests.
- [ ] Failing tests: create an event board through the route (owner), guests see `wheel`, adding an item is refused, client reducer keeps a `wheel` board message and ignores malformed ones, type shows in `BOARD_TYPES`.
- [ ] Implement; run the new file and `board-routes`, `templates` tests.
- [ ] Commit `Add the Event board type`.

### Task 3: Setup patch and compare-and-set

**Files:** Modify `src/lib/boardPatch.js` (rule `wheel`: owner setup fields only; keeps `round` and `history`), `src/lib/store.js` (both stores: `casBoard(code, expectedRev, patch)` -> board or null); Tests `test/wheel-setup.test.mjs`

**Interfaces:** Produces `store.casBoard`; `PATCH { patch: { wheel: { participants, prizes, helpers, rules } } }`.
- [ ] Failing tests: valid setup saved; a patch cannot set `round`/`history`; limits enforced; non-owner refused; `casBoard` succeeds once for one `rev` and returns null for the stale one (memory store; the Mongo path mirrors it and is covered by the guarded Mongo suite).
- [ ] Implement; run; commit `Add wheel setup validation and a revision compare-and-set`.

### Task 4: Round route

**Files:** Create `src/app/api/boards/[code]/wheel/route.js`; Modify `src/lib/rt.js` or `broadcast.js` only if a new envelope is needed (the `board` message already carries `wheel`); Tests `test/wheel-route.test.mjs`

**Interfaces:** Consumes `startSpin`, `applyAction`, `isRunner`, `store.casBoard`. Produces `POST { action: 'spin-prize' | 'spin-winner' | 'accept' | 'skip' | 'undo' | 'back' }` -> `{ board }`; 401 no session or guest, 403 not a runner, 409 wrong state or lost race, 429 rate limit.
- [ ] Failing tests: owner full round; helper allowed, removed helper refused; guest refused; two concurrent spins -> one 200 and one 409; wrong-state action -> 409 with a message; the announced `board` message contains the new `wheel` and never `ownerId`.
- [ ] Implement with `boardRoute`, CAS retry once, announce; run; commit `Add the wheel round route`.

### Task 5: Client timeline and hook

**Files:** Create `src/ui/event/timeline.js`, `src/ui/event/useWheel.js`; Tests `test/wheel-timeline.test.mjs`

**Interfaces:** Produces `timeline(spin, serverNow)` -> `{ phase: 'idle' | 'spinning' | 'done', progress, angle }` using an ease-out curve, and `useWheel(ctl)` -> `{ wheel, round, runner, act(action), setup(patch), now() }`.
- [ ] Failing tests: before `startAt` idle at the previous angle, mid-spin monotonic, after `startAt + duration` exactly the final angle, joining late gives `done`, reduced-motion flag returns `done` immediately.
- [ ] Implement; run; commit `Add the wheel timeline`.

### Task 6: Screens

**Files:** Create `src/ui/event/EventScreen.jsx`, `WheelSvg.jsx`, `StepBar.jsx`, `Controls.jsx`, `ResultCard.jsx`, `History.jsx`, `Setup.jsx`, `event.css`; Modify `src/ui/BoardScreen.jsx` (render `EventScreen` for `type === 'event'`); Tests `test/event-render.test.mjs`

**Interfaces:** Consumes `useWheel`. Produces the Setup, Spin and History views, Present mode, keyboard (Space spins), live region announcements, initials above 24 participants.
- [ ] Failing render tests (server-rendered markup): setup lists with add, paste and "Add everyone who joined"; guest sees "Waiting for the host" and no Spin; helper sees the Spin button; step bar state per round state; result card text; reduced-motion note; labels switch to initials above 24.
- [ ] Implement; run; commit `Add the Event screens`.

### Task 7: Dashboard, export, landing and docs

**Files:** Modify `src/ui/boards/NewBoardDialog.jsx` if the type needs a custom step, `src/app/api/boards/[code]/export/route.js` (CSV of history for event boards), `src/ui/landing/BoardTypes.jsx` (a fifth card, copy about raffles), `src/ui/guide/guideData.js` (Event section), `docs/DEMO.md`; Tests extend `test/landing.test.mjs`, `test/owner-tools-csv.test.mjs`
- [ ] Failing tests, then implement, run the whole suite, commit `Add Event to the dashboard, export, landing page and guide`.

### Task 8: Live check

**Files:** Create `scripts/sim-wheel.mjs`
- [ ] Two clients on live Upstash: owner and helper run a full round; a second guest stream receives the same `spin` record; a guest POST is refused.
- [ ] Build, start, drive the screens in two browser tabs (setup, spin both steps, accept, history, helper, Present mode, mobile width, reduced motion), fix what is found.
- [ ] Full `npm test`, build, commit, push.
