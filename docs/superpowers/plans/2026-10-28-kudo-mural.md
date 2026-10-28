# Retrospace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js + MongoDB collaborative board app with workshop, celebration and team-wall boards, live sync, and celebration effects.

**Architecture:** App Router pages render one client `Board` component; all changes are ops sent to `/api/boards/[code]/ops`, persisted through a store interface (Mongo or in-memory) and fanned out over Upstash pub/sub to an SSE bridge. Pure logic (validation, templates, milestones, state reducer) lives in plain modules with `node --test` unit tests.

**Tech Stack:** Next.js 16.3.x, React 19, plain JSX ESM, `mongodb` ^7, `@upstash/redis` ^1.39, `html-to-image`, Node 24 test runner.

**Spec:** `docs/specs/2026-10-28-kudo-mural-design.md`

## Global Constraints

- Project root `~/Desktop/retrospace`. Never write into `~/Desktop/mb-mobile` or `~/Desktop/my-space` (read my-space only as reference).
- **No git commits or pushes.** `git init` once; every "Checkpoint" step means: run the listed checks, leave changes uncommitted. The user commits.
- Next 16: route handler and page `params` are a Promise — `const { code } = await params` (server) / `use(params)` (client). Read `node_modules/next/dist/docs/01-app/` before using any Next API not already in my-space.
- Plain JSX, no TypeScript, no CSS framework, no state library, no canvas library.
- Every route handler: `export const runtime = 'nodejs'`; JSON errors `{ error }` with 400/403/404/413/429/503.
- Mongo DB name `process.env.MONGODB_DB || 'retrospace'`. Without `MONGODB_URI`, use the in-memory store.
- Limits: 2,000 items/board; item `data` JSON ≤ 8 KB (image items: `data.src` ≤ 600 KB); title ≤ 80 chars; text ≤ 2,000 chars; ≤ 50 ops per request.
- IDs: uid `KM-XXXX-XXXX-XXXX` from alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`; board code 6 chars same alphabet; ownerKey 24 chars, stored server-side only as SHA-256 hex.
- Redis channel `kb:<code>`; ephemeral messages throttled 15/s client-side, server cap 30/s per uid; ops batched every 50 ms; drag updates ≤ 20/s; poll fallback every 3 s; presence expires after 12 s (cursors hide after 10 s idle).

- **Amendment A (spec) overrides identity:** creators have accounts and boards are owned by `board.ownerId`; the `ownerKey` model in the constraints above and in Tasks 3–7 is replaced by Tasks 12–13. Participants are guests. No AI features. Run order: 6 → 12 → 13 → 15 → 14 → 7 → 8 → 9 → 10 → 11.

## Review Focus

1. Two users drag the same item at once → each sees the final position of the latest `updatedAt`; no jitter from own echoed ops. (Task 5 test `ignores own echo`, Task 3 `last writer wins`.)
2. Malformed or unknown board code in URL (`/b/zz`, `/b/AAAAAA`) → friendly "Board not found" page with link home, never a crash. (Task 4 sim, Task 11 manual.)
3. Locked board edited by non-owner → server 403 and UI disables tools with a "Board is locked" badge. (Task 4 sim.)
4. Birthday/anniversary on the viewer's local date, including Feb 29 in non-leap years (celebrate Feb 28). (Task 2 `milestones` tests.)
5. SSE drops mid-session (laptop sleep) → on reconnect client fetches `/since` and converges. (Task 5 test `catches up after reconnect`.)

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `next.config.mjs`, `jsconfig.json`, `.gitignore`, `.env.example`, `README.md`, `.claude/launch.json`, `src/app/layout.js`, `src/app/globals.css`, `src/app/page.js` (placeholder), `test/smoke.test.mjs`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `test` (`node --test test/`), `sim:api` (`node scripts/sim-api.mjs`), `sim:live` (`node scripts/sim-live.mjs`); `@/` alias → `src/`.

- [ ] **Step 1:** `git init`; write `package.json` (`"type": "module"`, deps above at my-space's versions), `.gitignore` copied from my-space, `.env.example` with every variable from spec §2, `next.config.mjs` with my-space's `allowedDevOrigins`, launch.json `dev` on port 3000.
- [ ] **Step 2:** `globals.css` defines tokens on `:root` (`--bg`, `--panel`, `--ink`, `--muted`, `--accent`, `--line`, six sticky colors `--note-yellow|pink|green|blue|purple|orange`) and a dark set under `prefers-color-scheme: dark`. Font: Inter from Google Fonts.
- [ ] **Step 3:** `test/smoke.test.mjs` asserts `true`. Run `npm install && npm test && npm run build`. Expected: tests pass, build succeeds.
- [ ] **Step 4: Checkpoint.**

### Task 2: Pure domain modules

**Files:**
- Create: `src/lib/ids.js`, `src/lib/validate.js`, `src/lib/templates.js`, `src/lib/milestones.js`
- Test: `test/validate.test.mjs`, `test/templates.test.mjs`, `test/milestones.test.mjs`

**Interfaces:**
- Produces:
  - `ids.js`: `newUid(): string`, `newCode(): string`, `newOwnerKey(): string`, `hashKey(key): string`, `isUid(s): boolean`, `isCode(s): boolean`, `cleanName(s): string` (≤ 24 chars, strips control chars, default `'Guest'`)
  - `validate.js`: `KINDS` array; `validateItem(item): { ok: true, item } | { ok: false, error }` (clamps x/y to ±100000, w/h to 20..4000, strips unknown top-level keys); `validateOp(op): { ok, op | error }` for `add|update|delete|vote|react`; `validateBoardInput(body): { ok, board | error }`; `REACTIONS = ['🎉','❤️','👏','😂','🙌','🔥']`; `BADGES = ['Teamwork','Above & Beyond','Innovation','Customer Hero','Thank You']`
  - `templates.js`: `BOARD_TEMPLATES` keyed by type: workshop `['blank','retro','brainstorm','swot']`, celebration `['birthday','promotion','farewell','anniversary','welcome','baby','congrats','thanks']`, wall `['team']`; `getTemplate(type, key): { key, label, emoji, theme: { bg, pattern, accent, effect: 'confetti'|'fireworks'|'balloons' }, title(recipient), starterItems(): item[] }`
  - `milestones.js`: `todaysMilestones(people, now = new Date()): Array<{ personId, name, kind: 'birthday'|'anniversary', years? }>` using viewer local date; Feb 29 birthdays match Feb 28 in non-leap years; anniversary only when years ≥ 1.

- [ ] **Step 1: Write failing tests**, including:
  - `validateItem` rejects unknown kind, text > 2000, data > 8 KB, image src > 600 KB; accepts each kind's minimal shape.
  - `validateOp` rejects `update` without `id`, `react` with emoji outside `REACTIONS`.
  - every template in `BOARD_TEMPLATES` resolves via `getTemplate` and its `starterItems()` all pass `validateItem`.
  - `todaysMilestones` for `{birthday:'02-29'}` on 2027-02-28 → birthday; on 2028-02-28 → none; start date 2023-10-28 on 2026-10-28 → anniversary years 3; start date today → none.
- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement the four modules.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 3: Store (Mongo + memory)

**Files:**
- Create: `src/lib/db.js` (Mongo/Redis clients, pattern from my-space `src/lib/db.js`), `src/lib/store.js`
- Test: `test/store.test.mjs` (memory store only)

**Interfaces:**
- Consumes: `validate.js`, `ids.js`.
- Produces: `getStore(): Store`, where `Store` has async methods:
  - `createBoard(board) -> board`, `getBoard(code) -> board|null`, `updateBoard(code, patch) -> board`, `deleteBoard(code)`
  - `listItems(code) -> item[]` (excludes `deleted`), `itemsSince(code, t: number) -> item[]` (includes deleted tombstones)
  - `applyOps(code, ops, actor: { uid, name, isOwner }) -> { applied: item[], rejected: Array<{ id, error }> }`
  - `listPeople(code)`, `savePeople(code, people[])`
  - `boardsFor(uid) -> board[]` (created by, or has authored items)
  - Also `getRedis() -> Redis|null`, `getMongo() -> Promise<MongoClient>|null` from `db.js`.
- Rules in `applyOps`: `updatedAt = Date.now()` set server-side (monotonic per board: `max(now, last+1)`); non-owner may update/delete only own `authorUid` items (vote/react allowed on any); locked board rejects all non-owner ops; reject `add` beyond 2,000 live items; `delete` sets `deleted: true`.
- Mongo indexes created once (spec §5).

- [ ] **Step 1: Write failing tests:** create/get board; add then update item; non-owner update of other's item rejected; owner allowed; locked board rejects non-owner add; `itemsSince` returns tombstone after delete; **last writer wins**: two updates in one batch → second patch's values persist and `updatedAt` strictly increases; 2,001st add rejected; `vote` toggles uid in `votes`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement memory store (Maps on `globalThis._kmMem`) and Mongo store behind the same interface; `getStore()` picks by `MONGODB_URI`.
- [ ] **Step 4:** `npm test` → PASS. If `MONGODB_URI` is set in env, also run the same suite with `KM_TEST_MONGO=1` against DB `retrospace_test`.
- [ ] **Step 5: Checkpoint.**

### Task 4: Board API routes

**Files:**
- Create: `src/lib/http.js`, `src/app/api/boards/route.js`, `src/app/api/boards/[code]/route.js`, `src/app/api/boards/[code]/ops/route.js`, `src/app/api/boards/[code]/since/route.js`, `src/app/api/boards/[code]/people/route.js`, `src/app/api/my-boards/route.js`
- Test: `scripts/sim-api.mjs`

**Interfaces:**
- Consumes: `getStore`, validators, `getTemplate`.
- Produces (HTTP, spec §6 exactly): create returns `{ code, ownerKey }` and inserts template `starterItems`; GET returns `{ board, items, people, now }` with `ownerKeyHash` removed; `isOwner(board, ownerKey)` in `http.js`; `json(data, status)`, `fail(status, error)`, `rateLimited(req, kind, perMin) -> boolean` (Redis-backed, false when no Redis).
- The ops route calls `publish(code, { t: 'ops', from: uid, ops: applied })` from Task 5; in this task import it from `src/lib/rt.js` stubbed as a no-op until Task 5.

- [ ] **Step 1:** Write `scripts/sim-api.mjs` (base URL arg, default `http://localhost:3000`) asserting: create each type → 200; GET unknown code → 404; malformed code → 400; ops add/update/delete by author → applied; other uid update → rejected; PATCH `locked:true` without key → 403, with key → 200; non-owner add on locked → rejected entry; `/since?t=0` includes tombstone; `my-boards?uid` lists the created board; body with 51 ops → 400.
- [ ] **Step 2:** Start `npm run dev`; `npm run sim:api` → FAIL.
- [ ] **Step 3:** Implement routes.
- [ ] **Step 4:** `npm run sim:api` → all PASS.
- [ ] **Step 5: Checkpoint.**

### Task 5: Realtime transport + client sync

**Files:**
- Create/replace: `src/lib/rt.js` (from my-space: `signTok`, `verifyTok`, `chan(code) = 'kb:'+code`, `publish(code, env)`, `rateOk`), `src/app/api/rt/join/route.js`, `src/app/api/rt/send/route.js`, `src/app/api/rt/stream/route.js` (copy my-space SSE bridge, change channels)
- Create: `src/client/identity.js`, `src/client/state.js`, `src/client/sync.js`
- Test: `test/state.test.mjs`, `scripts/sim-live.mjs`

**Interfaces:**
- Produces:
  - `identity.js`: `getIdentity(): { uid, name, color }`, `setProfile({ name, color })`, `getOwnerKey(code)`, `setOwnerKey(code, key)`
  - `state.js`: `initialState(snapshot)`, `reducer(state, action)` with actions `load`, `local` (optimistic ops), `remote` (ops from server; apply only if `updatedAt` ≥ current), `ack` (server-applied ops replace optimistic), `undo`, `redo` (own ops only, inverse ops pushed to queue); state `{ board, items: Map<id,item>, order: id[] by z, undo: [], redo: [] }`
  - `sync.js`: `createSync({ code, identity, ownerKey, onRemote, onEphemeral, onStatus }) -> { send(ops), sendEphemeral(msg), close() }`; status `'live'|'polling'|'offline'`; drops envelopes where `from === identity.uid`; on EventSource `open` after an error, calls `/since?t=lastSeen`; retries failed batches 3× (500/1500/4000 ms) then status `offline` with queue kept.

- [ ] **Step 1: Write failing tests** (`state.test.mjs`): remote op with older `updatedAt` ignored; **ignores own echo** handled in sync (unit-test the pure `shouldApply(env, uid)` helper exported from `sync.js`); undo of own add yields delete op; redo re-adds.
- [ ] **Step 2:** `npm test` → FAIL; implement; `npm test` → PASS.
- [ ] **Step 3:** `scripts/sim-live.mjs`: two SSE clients on a new board; A posts op; assert B receives within 1,500 ms; **catches up after reconnect**: close B, A posts op, reopen B, `/since` returns it. Exit 0 with "SKIP" when Upstash env is missing.
- [ ] **Step 4:** Wire `publish` into the ops route; `npm run sim:live` → PASS (or SKIP); `npm run sim:api` still PASS.
- [ ] **Step 5: Checkpoint.**

### Task 6: Canvas core

**Files:**
- Create: `src/app/b/[code]/page.js` (server: fetch nothing, render `<BoardScreen code>`), `src/app/b/[code]/not-found.js`, `src/ui/BoardScreen.jsx` (loads snapshot, owns reducer + sync), `src/ui/Board.jsx` (viewport), `src/ui/Toolbar.jsx`, `src/ui/ItemView.jsx`, `src/ui/items/{Note,Text,Shape,Connector,Frame,Image}.jsx`, `src/ui/Minimap.jsx`, `src/ui/board.css`
- Create: `src/ui/geometry.js`; Test: `test/geometry.test.mjs`

**Interfaces:**
- Consumes: `reducer`, `createSync`, `getIdentity`, `validateItem`.
- Produces: `geometry.js`: `screenToWorld(pt, view)`, `worldToScreen(pt, view)`, `zoomAt(view, screenPt, factor) -> view` (clamped 0.1–4), `rectsIntersect(a, b)`, `itemsInRect(items, rect)`, `connectorPath(fromItem, toItem) -> 'M… C…'` (edge-anchored cubic). `view = { x, y, scale }`.
- `ItemView` props: `{ item, selected, editable, onChange(patch), onSelect(e) }`; each item component renders its own body; resize handles drawn by `ItemView`.
- Interactions (spec §4.1): tools select/note/text/shape/connector/frame/image; space-drag + middle-drag pan, ctrl/cmd-wheel + pinch zoom; marquee and shift-click multi-select; drag moves (frames carry contained items); arrow keys nudge; Delete; Cmd-D duplicate; Cmd-Z/Shift-Cmd-Z; `[`/`]` z-order; double-click edits text; paste image → downscale to max 1600px webp ≤ 600 KB else toast.

- [ ] **Step 1:** Failing tests for `geometry.js`: round-trip screen↔world at scale 2 with offset; `zoomAt` keeps the point under the cursor fixed and clamps; `itemsInRect` selects partially-overlapping items.
- [ ] **Step 2:** `npm test` → FAIL; implement `geometry.js`; PASS.
- [ ] **Step 3:** Build the components. Unknown/malformed code renders `not-found.js` ("Board not found" + link home).
- [ ] **Step 4:** Manual in built-in browser: create workshop board via `curl`, open `/b/<code>`, add every item kind, move, resize, connect, undo/redo, reload → state persists. `/b/zz` → not-found page.
- [ ] **Step 5: Checkpoint.**

### Task 7: Collaboration layer

**Files:**
- Create: `src/ui/Presence.jsx`, `src/ui/Cursors.jsx`, `src/ui/VotePanel.jsx`, `src/ui/Timer.jsx`, `src/ui/Effects.jsx`, `src/ui/ProfilePopover.jsx`, `src/ui/BoardSettings.jsx`, `src/ui/Toasts.jsx`
- Create: `src/ui/effects-engine.js`; Test: `test/effects.test.mjs`

**Interfaces:**
- Consumes: `sync.sendEphemeral`, `onEphemeral`, board PATCH.
- Produces: ephemeral messages `{ t:'cursor', x, y }`, `{ t:'sel', ids }`, `{ t:'celebrate', effect }`, `{ t:'hello' }` (the sender is always the envelope's `from` — a per-board public id — never a field inside `msg`; the server stamps `name` and `avatar` from the participant record on `/api/rt/send`; clients never supply them; Presence and Cursors render `Avatar` + name from that); `effects-engine.js`: `spawn(effect, count, bounds, rand) -> particles[]`, `step(particles, dt) -> particles[]` (gravity, drag, removes off-screen/expired). `Effects` exposes `fire(effect)` through a React context `useEffects()`.
- **Throwables (spec Amendment E):** owner-only settings for `throwables` `{ enabled, emojis }` (PATCH key added to `src/lib/boardPatch.js`: `enabled` boolean, `emojis` 1–12 unique single-emoji-grapheme strings, validated with `Intl.Segmenter` + `\\p{Extended_Pictographic}`; default off). `rt/send` accepts a new ephemeral `t:'throw'` message `{ emoji, itemId?, x, y }`; for THIS type only it loads the board and rejects unless `throwables.enabled`, the emoji is in the list and the board is not revoked/closed/locked (non-owners), with a server-side limit of 1 per 1.5 s per uid (burst 3) and the persona stamped by the server. UI: `ThrowTray.jsx` (keyboard operable, hidden when disabled), flight + impact animation in `effects-engine.js` (`prefers-reduced-motion` → simple pop), polite `aria-live` announcement. Tests: PATCH validation (emoji list limits, non-emoji rejected, duplicates rejected), disabled board rejects throws (403), emoji not in list rejected, closed/locked rejected, rate limit, persona stamped, reduced-motion path.
- Settings (owner only): title, theme, lock, recipient, revealAt, vote start/stop with `perPerson` (default 3), timer minutes. Per Amendment A also: passcode (set/clear), close, revoke, and a share panel showing the access code and link with Copy buttons and a `mailto:` share link. The server must also enforce `board.vote.perPerson` and `vote.active` for `vote` ops (count the actor's votes across all items) — the store does not. Locked badge + disabled tools for non-owners.

- [ ] **Step 1:** Failing tests: `spawn('confetti', 100, …)` returns 100 particles within bounds; `step` removes particles past lifetime; balloons rise (vy < 0).
- [ ] **Step 2:** Implement; `npm test` PASS.
- [ ] **Step 3:** Build the components. A "Celebrate 🎉" toolbar button fires locally and broadcasts.
- [ ] **Step 4:** Manual with two tabs (different uids via a private window or second profile): cursors with names, presence avatars, selection outlines, vote counts, shared timer, celebrate effect in both, lock blocks the second tab.
- [ ] **Step 5: Checkpoint.**

### Task 8: Celebration boards + reveal

**Files:**
- Create: `src/ui/items/Card.jsx`, `src/ui/CardComposer.jsx`, `src/ui/GifPicker.jsx`, `src/app/b/[code]/reveal/page.js`, `src/ui/Reveal.jsx`, `src/ui/Slideshow.jsx`
- Create: `src/lib/layout.js`; Test: `test/layout.test.mjs`

**Interfaces:**
- Produces: `nextCardSlot(cards, { cols: 4, colW: 320, gap: 24, top: 220 }) -> { x, y }` (shortest column masonry); `GifPicker` (client component) uses `GiphyFetch(process.env.NEXT_PUBLIC_GIPHY_API_KEY)` from `@giphy/js-fetch-api` and `Grid` from `@giphy/react-components` (search + trending); picking a GIF stores its https `images.fixed_height.url` in the card's `data.gif`; with no key the picker shows only the paste-URL field (no server route, no Tenor); add both `@giphy/*` packages as dependencies and report any React 19 peer-dependency conflict; `Reveal` phases `countdown` (before `revealAt`, non-owner) → `intro` (recipient name + theme effect, 4 s) → `slides` → `board`.
- Card data: `{ message, signer, color, gif?, image? }`.

- [ ] **Step 1:** Failing tests for `nextCardSlot`: empty → first column at `top`; fills the shortest column; ties go left.
- [ ] **Step 2:** Implement; PASS.
- [ ] **Step 3:** Build composer (text, signer prefilled from identity, color, GIF search through the Giphy SDK picker or URL paste, image upload), card rendering, reveal flow with keyboard arrows/Esc, share buttons ("Copy contributor link", "Copy recipient link").
- [ ] **Step 4:** Manual: birthday board from template, add 5 cards from two tabs, set `revealAt` in 1 minute, open reveal link in a private window → countdown → intro with confetti → slideshow → board.
- [ ] **Step 5: Checkpoint.**

### Task 9: Team wall (extras phase, order 2 of 4)

**Files:**
- Create: `src/ui/items/Shoutout.jsx`, `src/ui/ShoutoutComposer.jsx`, `src/ui/WallFeed.jsx`, `src/ui/PeopleEditor.jsx`, `src/ui/MilestoneBanner.jsx`, `src/ui/wall.css`
- Modify: `src/lib/templates.js` (type `wall`, template `team`), `src/lib/validate.js` (accept board type `wall`; shoutout rules), `src/lib/boardTypes` and the dashboard New-board dialog, the landing page (add the Team wall card back with accurate copy), `src/ui/BoardScreen.jsx`/`useBoard.js` (feed/canvas views), README, sims

**Interfaces:**
- Consumes: `todaysMilestones` (`src/lib/milestones.js`), `BADGES` and `REACTIONS` (`src/lib/validate.js`), the existing people routes (`GET` via snapshot, `POST /api/boards/[code]/people` owner-only), `useEffects()`, the persona system (the shout-out author is the participant persona; nothing else identifies the sender), the shoutout item kind `{ toName, message (1–500), badge (one of BADGES), to? (person id), gif? (https) }` already accepted by `validateItem`.
- Produces: a `wall` board type (long-lived team space): default Feed view (newest first, infinite scroll or "Load more" at 30 items) with a Feed/Canvas toggle remembered per board in localStorage; `ShoutoutComposer` (to: @mention autocomplete from `people` or free text, message with counter, badge picker with 5 badges, optional Giphy GIF reusing the Task 8 picker, live preview, double-submit guard, rate limit 10 per minute per participant enforced on the server in the ops route for shoutout adds); reactions via the existing `react` op with the 6 `REACTIONS` shown as a compact bar with counts and `aria-pressed` for your own; `PeopleEditor` in the settings drawer (owner: add/edit/remove people with name, birthday MM-DD or empty, start date or empty; validation already exists server-side; max 200); `MilestoneBanner` (top of the feed): today's birthdays (balloons) and work anniversaries (fireworks) from the people list using the VIEWER's local date, shown once per day per board per browser (localStorage key `km:ms:<code>:<YYYY-MM-DD>`), dismissible, announced politely, Feb 29 handled by `todaysMilestones`, effects respect reduced motion; shout-outs addressed to a person show their name chip; moderation: the owner can delete any shout-out (existing owner delete), guests only their own.

- [ ] **Step 1: Failing tests:** wall template/starter items valid; `validateBoardInput` accepts `wall`; shout-out add by a guest accepted, 11th in a minute → 429-style rejection ('Slow down'); badge outside BADGES rejected; `gif` must be https; feed ordering and pagination helper (pure); milestone-banner pure helper (once per day per board, localStorage key format); mention autocomplete matching helper (pure, case/accents, max 8 results).
- [ ] **Step 2:** Implement; `npm test` PASS; extend `sim-api.mjs` (wall creation, shout-out add/reaction, rate limit, people owner-only).
- [ ] **Step 3:** Browser check (production build, port 3300, blanked services, scripted guests): owner adds 3 people (one with today's birthday, one with an anniversary), posts shout-outs from the owner and two scripted guests, reactions sync live, banner + effect once, feed/canvas toggle, 375px, keyboard, reduced motion, console clean.
- [ ] **Step 4:** Landing copy: re-add 'Team wall' (recognition feed with badges, birthdays and anniversaries) only after this task passes review.

### Task 10: Dashboard, new-board flow, export

**Files:**
- Modify: `src/app/page.js`
- Create: `src/ui/Dashboard.jsx`, `src/ui/NewBoardDialog.jsx`, `src/ui/exportPng.js`

**Interfaces:**
- Consumes: `POST /api/boards`, `GET /api/my-boards`, `BOARD_TEMPLATES`, `setOwnerKey`.
- Per Amendment A the dashboard lives at `/boards` (signed-in users only; redirect to `/login?next=/boards`), lists the signed-in user's owned boards from `GET /api/my-boards`, creating a board requires the session, and there is a Sign out button; no owner keys are stored in the browser. Landing at `/` is Task 14.
- Produces: dashboard sections "My boards" (cards with type icon, title, updated time) and "Start something" (three type tiles → template grid → title/recipient form → creates and routes to `/b/<code>`); `exportPng(boardEl, items) -> Promise<void>` downloads the bounding box of all items at 2x via `html-to-image`.

- [ ] **Step 1:** Build (no display-name prompt: owners use their account name; `ProfilePopover` in Task 7 shows the persona).
- [ ] **Step 2:** Manual: create one board of each type from the UI; they appear in "My boards"; export PNG downloads a non-empty image.
- [ ] **Step 3: Checkpoint.**

### Task 11: Verification pass

- [ ] **Step 1:** `npm test` → all PASS; `npm run build` → no errors; `npm run sim:api` → PASS; `npm run sim:live` → PASS or SKIP (state which).
- [ ] **Step 2:** Built-in browser at 1440×900 and mobile preset: dashboard, each board type, reveal; no console errors; light and dark.
- [ ] **Step 3:** Walk the five Review Focus items by hand and record results in `README.md` "Status".
- [ ] **Step 4:** README: features, env table, run instructions, API list, known limits. Final checkpoint — report to user; do not commit.

### Task 12: Accounts and sessions

**Files:**
- Create: `src/lib/password.js`, `src/lib/auth.js`, `src/app/api/auth/register/route.js`, `src/app/api/auth/login/route.js`, `src/app/api/auth/logout/route.js`, `src/app/api/auth/me/route.js`, `scripts/sim-auth.mjs`
- Modify: `src/lib/store.js` (both stores), `src/lib/db.js` index list, `src/lib/validate.js` (`validateRegister`, `validateLogin`)
- Test: `test/password.test.mjs`, `test/auth.test.mjs`

**Interfaces:**
- Produces: `hashPassword(pw): Promise<string>`, `verifyPassword(pw, stored): Promise<boolean>` (scrypt per spec A1); store methods `createUser(user)`, `getUserByEmail(email)`, `getUserById(id)`, `createSession(session)`, `getSessionByTokenHash(h)`, `deleteSession(h)`, `touchSession(h)`; `auth.js`: `createSessionFor(userId): Promise<{ token, cookie }>`, `getSessionUser(req): Promise<{ id, email, name } | null>`, `clearSessionCookie()`, `requireJson(req)`, `requireSameOrigin(req)`; routes per spec A1.

- [ ] **Step 1:** Failing tests: hash/verify round trip; wrong password false; malformed stored string false; two hashes of one password differ; duplicate email rejected (case-insensitive); session lookup by token hash; expired session is not returned; cookie string has `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`, and `Secure` only when `NODE_ENV=production`; `requireSameOrigin` accepts a missing Origin and a matching Origin, rejects a foreign Origin; `requireJson` rejects `text/plain`.
- [ ] **Step 2:** `npm test` → FAIL; implement; PASS.
- [ ] **Step 3:** `scripts/sim-auth.mjs`: register → 200 and cookie set; duplicate register 409; wrong password and unknown email return the identical message; login → `me` returns the user; logout → `me` is 401; 11th rapid login attempt → 429 (works without Redis); register with a 9-char password → 400.
- [ ] **Step 4:** Run the sim against a dev server started as `MONGODB_URI= UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= PORT=3100 npm run dev`.

### Task 13: Ownership and access control

**Files:**
- Create: `src/lib/access.js`, `src/app/api/join/[code]/route.js`, `src/app/api/boards/[code]/join/route.js`
- Modify: `src/lib/http.js`, `src/lib/store.js`, `src/lib/validate.js`, every route under `src/app/api/boards/` and `src/app/api/rt/`, `src/app/api/my-boards/route.js`, `src/client/identity.js`, `src/client/sync.js`, `src/ui/BoardScreen.jsx`, `scripts/sim-api.mjs`, related tests

**Interfaces:**
- Consumes: Task 12 `getSessionUser`, `requireJson`, `requireSameOrigin`; `hashPassword`/`verifyPassword`.
- Produces: `authorize(req, board, { write }): Promise<{ role: 'owner' | 'guest', user?, uid? }>` throwing `HttpError(status, message)`; board shape `{ ownerId, passcodeHash, status, revoked }`; create requires a session (401 otherwise); PATCH keys add `passcode` (string 4–64 chars or null), `status`, `revoked`; GET board adds `viewer: { role, userId? }`; `ownerKey`, `newOwnerKey`, `getOwnerKey`/`setOwnerKey` and the `ownerKey` parameter of `createSync` are removed.

- [ ] **Step 1:** Update `sim-api.mjs` first. Multiple boards: one account creates 5 boards in a row (mixed types) → 5 distinct codes, all 6 characters from the alphabet, all listed by `/api/my-boards` with their own title and type; a second account sees none of them; a guest who joined board A with its code gets 403 on board B's snapshot, ops and since when B has a passcode and still sees only B's public join info (title, type, flags) when B is open — never the owner or A's content; a unit test with a fake store whose first two `createBoard` calls throw a duplicate-key error (`code: 11000`) still ends with one created board using a new code. Then: create without a session → 401; with a session → 200; owner actions only with the owner's session cookie; a second account gets 403 on PATCH and DELETE; passcode board: guest without the access cookie → 403 on snapshot, ops, since, rt join; wrong passcode → 403; right passcode → cookie → access; changing the passcode invalidates old cookies; `closed` → guest ops rejected, owner ops allowed; `revoked` → guest 403, owner 200; `/api/join/[code]` leaks no item content; no response contains `passcodeHash` or any password hash.
- [ ] **Step 2:** Run it → FAIL; implement; PASS (Mongo and Upstash blanked).
- [ ] **Step 3:** Unit tests for `authorize` with a fake request and board for each role and state combination.
- [ ] **Step 4:** Replace the owner flag in `BoardScreen` with `viewer.role`; show "closed" and "revoked" states.

### Task 14: Landing page, auth screens and join flow

**Files:**
- Create: `src/app/login/page.js`, `src/app/register/page.js`, `src/app/join/page.js`, `src/ui/landing/{Header,Hero,BoardPreview,BoardTypes,Features,HowItWorks,Footer,JoinBox}.jsx`, `src/ui/landing/landing.css`, `src/ui/auth/AuthForm.jsx`, `src/ui/JoinGate.jsx`
- Modify: `src/app/page.js`, `src/app/layout.js` (metadata, skip link)

**Interfaces:**
- Consumes: Task 12 auth routes, Task 13 `GET /api/join/[code]` and `POST /api/boards/[code]/join`.
- Produces: pages and behavior per spec A3 and A4. `JoinBox` normalizes input to upper case, accepts only valid codes (`isCode`), calls `GET /api/join/[code]`, and routes to `/b/<code>`; `JoinGate` asks for the passcode when needed and then shows Task 15's `PersonaChooser` (generated anonymous name + avatar to approve, or create their own) before the board loads.

- [ ] **Step 1:** Build the landing page and auth screens to the spec A4 content list. The design is clean and professional, with no invented customers or statistics.
- [ ] **Step 2:** Verify in the built-in browser with Mongo and Upstash blanked: screenshots at 375, 768 and 1440 px in light and dark; keyboard-only path through the header, join box and forms; console clean.
- [ ] **Step 3:** End to end: register → sign in → create a board → copy the access code → in a fresh private window, enter the code on the landing page → set a name → land on the board; with a passcode set, the wrong passcode is refused and the right one works.

### Task 15: Participant personas (anonymous name + avatar)

**Files:**
- Create: `src/lib/persona.js`, `src/ui/Avatar.jsx`, `src/ui/AvatarPicker.jsx`, `src/ui/PersonaChooser.jsx`, `src/app/api/boards/[code]/persona/route.js`
- Modify: both stores in `src/lib/store.js`, `src/lib/plan.js` (stamp `authorAvatar`), `src/app/api/boards/[code]/join/route.js` and `ops`, `since`, `route.js`, `src/app/api/rt/{join,send}/route.js`, `src/client/identity.js`, `src/client/sync.js`, `src/ui/BoardScreen.jsx`, `scripts/sim-api.mjs`, tests

**Interfaces:**
- Consumes: Task 13 `authorize`, join route and participant roles; Task 5 identity and sync.
- Produces (pure, browser-safe) `persona.js`: `ADJECTIVES`, `ANIMALS` (>= 48 each), `AVATAR_PARTS = { bg: 12, body: 8, eyes: 8, mouth: 8, extra: 8 }`, `generatePersona(rand = Math.random, taken = new Set()) -> { kind: 'anonymous', name, avatar }`, `randomAvatar(rand)`, `avatarFromSeed(seed)`, `validateAvatar(a)`, `validatePersona(input, { taken, ownerName }) -> { ok: true, persona } | { ok: false, error, status, suggestion? }` per spec Amendment C.
- Store: `getParticipant(code, uid)`, `joinParticipant(code, uid, persona)` (atomic insert-if-absent; returns the stored record), `updateParticipant(code, uid, persona)`, `listParticipants(code)`, `countAuthoredItems(code, uid)`; unique indexes `{ boardCode, uid }` and `{ boardCode, nameLower }`.
- Routes: join takes `{ uid, passcode?, persona? }` (omitted persona -> server generates an anonymous one) and returns `{ persona }`; `PUT /api/boards/[code]/persona` changes it (403 once the participant has authored items; 10/hour per uid); the board snapshot returns `viewer.persona` and `participants: [{ uid, name, avatar, kind }]`.
- UI: `Avatar({ avatar, name, size = 40 })` SVG with `role="img"` and `aria-label`; `AvatarPicker` (live preview, Shuffle, per-part choosers); `PersonaChooser` (default "Stay anonymous" with the generated persona and Shuffle; alternative "Use my own name" with a name field; both with the avatar picker; primary button "Join as <name>").
- Identity: name and avatar in `ops`, `send` and cursors come from the participant record; any `name` in a request body is removed from the API and ignored.
- **Bind the guest uid to the browser (security carry-over from Task 13's review):** authorship checks currently trust a client-claimed `uid`, so a guest can edit another guest's items by sending that uid (it is visible as `authorUid`). The join route issues a signed, HttpOnly guest-identity cookie `rs_g` (HMAC over the uid, long-lived, secret as in `rt.js`); `ops`, `rt/join`, `rt/send` and the persona routes take the guest uid from that cookie (verify it, ignore a mismatching body `uid`), and `authorUid` is never exposed to other guests in a way that lets them act as that user. Tests: a request with another guest's uid but the wrong/no cookie cannot update or delete that guest's items.

- [ ] **Step 1: Write failing tests:** 200 generated personas against a growing `taken` set are all distinct; `avatarFromSeed` is deterministic and every part is in range; `validateAvatar` rejects out-of-range, non-integer and extra keys; `validatePersona`: an anonymous name not built from the lists is rejected, a custom name is trimmed and cleaned, a name that differs only by case is a 409, the owner's name is a 409, a name with no letter or digit is rejected; store: 20 concurrent `joinParticipant` calls for one uid leave one record, 50 concurrent joins with distinct uids all end with distinct names, `updateParticipant` is refused after the participant authored an item; ops: a `name` in the body is ignored and the item carries the stored `authorName` and `authorAvatar`; a cursor/hello message published by `/api/rt/send` carries the stored name and avatar even if the client supplies different ones.
- [ ] **Step 2:** `npm test` -> FAIL; implement; PASS. Extend `sim-api.mjs` with the same checks over HTTP (Mongo and Upstash blanked).
- [ ] **Step 3:** Verify in the built-in browser: `PersonaChooser` at 375 and 1440 px in light and dark; a grid of 24 generated avatars to check variety and legibility; keyboard-only use; approving the anonymous persona and creating a custom one both lead into the board and show correctly in a second window.

### Task 16: Retro starter and AI summary (presentation slice)

A thin, demonstrable slice of Amendments B and D, built before the full Retro engine. It reuses the canvas, voting (Task 7), accounts and access codes.

**Files:**
- Create: `src/lib/ai/provider.js`, `src/lib/ai/anthropic.js`, `src/lib/ai/input.js`, `src/app/api/boards/[code]/summary/route.js`, `src/ui/SummaryPanel.jsx`
- Modify: `src/lib/templates.js` (type `retro`), `src/lib/validate.js` (accept board type `retro`), `src/lib/boardPatch.js` (`ai`, `summary` keys), `src/app/api/boards/[code]/route.js` (summary trigger when `status` becomes `closed`), `src/ui/BoardSettings.jsx`, tests, README

**Interfaces:**
- Produces: board type `retro` (same canvas as workshop) with three templates, each with starter column frames and a header: `retro-wwci` (Went Well / Could Be Improved / Blockers / Ideas), `retro-ssc` (Start / Stop / Continue), `retro-msg` (Mad / Sad / Glad). `buildSummaryInput(items) -> { text, count }` uses only item text and the title of the frame that contains the item (its category), trims each to 300 characters, keeps at most 200 items (oldest and longest dropped first), and never includes author names, uids, emails or avatars. `summarize(input, { kind, fetchImpl, now }) -> Promise<{ text, model } | { error }>` calls the Anthropic Messages API with `fetch` (no new dependency): `POST https://api.anthropic.com/v1/messages`, headers `x-api-key` from `ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `content-type: application/json`; model `process.env.AI_SUMMARY_MODEL || 'claude-haiku-5-5'`; `max_tokens: 600`; 15 s timeout via `AbortSignal.timeout`; one retry on 429/5xx/network error; never logs the key or content. Board fields `ai: { enabled, ackAt, autoSummary, autoShare }` (default all false; `ackAt` set when the owner enables AI after seeing the notice) and `summary: { text, status: 'draft'|'shared', source: 'ai'|'manual', model, generatedAt, editedAt }`.
- Route `POST /api/boards/[code]/summary` (owner only, JSON + same-origin): requires `ai.enabled`; rate limits 5 per board per hour and 40 per owner per day; generates a draft and stores it; returns `{ summary }`. Closing a board (PATCH `status:'closed'`) with `ai.enabled && ai.autoSummary` generates one draft in the background with `after()` (never blocks the request; at most once per close). PATCH `summary` (owner): edit text, `status:'shared'` (confirm) or withdraw; with `ai.autoShare` an automatic summary is stored as shared and labelled AI-generated. Guests receive only a `shared` summary, never a draft.
- UI: `SummaryPanel` (owner: Generate/Regenerate, editable text box, Confirm to share, Withdraw, Copy; AI notice before first enable; failure shows a Retry and the manual editor; guests see a shared summary with an 'AI-generated' label when `source:'ai'`). Settings: AI switch with the privacy notice, auto-summary switch, auto-share switch.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` (no real network): the prompt contains no author names, uids or avatars; items are grouped under their frame titles; 300-char trim and 200-item cap; a valid reply returns text and model; a 429 then success retries once; two failures return `{ error }`; a timeout returns `{ error }`; the key never appears in logs or errors; the route is owner-only (guest 403, no session 401); 6th request in an hour is 429; AI disabled → 403; a guest snapshot never contains a draft but does contain a shared summary; closing with `autoSummary` creates exactly one draft and closing twice does not create a second; `autoShare` stores it as shared with source `ai`; PATCH `summary` edit and confirm work and a guest cannot; the three retro templates produce valid starter items and frames with the right titles.
- [ ] **Step 2:** Run → FAIL; implement; PASS. No test calls the real API.
- [ ] **Step 3:** Browser check with the AI provider faked by an env switch used only in tests/dev (`AI_FAKE=1` returns a canned summary): create a retro board, add notes in columns, enable AI, close the board, see the draft appear for the owner only, edit, confirm, see it as a guest.
- [ ] **Step 4 (controller, once, at the end):** one real call with the user's key and the smallest model on a throwaway board; report the result and cost to the user.

Not in this slice (full Retro mode later): the staged workflow engine and timers per stage, AI theme grouping, action cards, discussion statuses, anonymous-note author hiding, CSV and PDF export.

### Task 17: Owner tools and exports (extras phase, order 1 of 4)

**Files:**
- Create: `src/app/api/boards/[code]/participants/[id]/route.js`, `src/app/api/boards/[code]/export/route.js` (CSV), `src/lib/csv.js`, `src/ui/settings/PeopleSection.jsx`, `src/ui/ExportMenu.jsx`, `src/ui/exportPng.js`
- Modify: `src/lib/store.js` (both stores: `removeParticipant`, `listBans`/`board.bans`), `src/lib/access.js` (`authorize` rejects banned guests), `src/lib/plan.js` if tombstoning a participant's items, `src/app/api/boards/[code]/route.js` (snapshot/participants cap), `src/client/sync.js` + `src/ui/useBoard.js` (`t:'kicked'` handling), `src/ui/BoardScreen.jsx`, `src/ui/settings/*`, README, sims

**Interfaces:**
- **Remove participant** (owner only; JSON + same-origin; through `boardRoute`/`requireOwner`): `DELETE /api/boards/[code]/participants/[id]?items=1|0` where `[id]` is the per-board PUBLIC id (never a cookie uid). Effects: the participant row is deleted (their persona name is freed), the id is added to `board.bans` (cap 500; owner-only field, never sent to guests), and with `items=1` their live items are tombstoned through the normal store path (monotonic `updatedAt`, published as an `ops` envelope). A banned id gets 403 `You were removed from this board` on every guest route (snapshot, ops, persona, rt/join, since, reveal) and its open stream is ended: publish `{ t:'kicked', id }` on the board channel; clients whose own public id equals `id` close their sync and show a 'You were removed from this board' panel (no way back in short of a new browser identity — document that a determined user can clear cookies, and that the owner should combine removal with a passcode change or revoke). The owner cannot remove themselves (400). `PeopleSection` in the settings drawer lists participants (avatar, name, kind, item count) with a Remove button + confirm step ('Also delete their notes' checkbox), polite status messages, live-updating from the presence/participants data. Tests: both stores (`removeParticipant`, bans persisted, tombstones monotonic), authorize ban matrix, kicked envelope guest-safe (no uids), the owner exemption, route authz (guest 401/403), a banned guest cannot re-create a persona or post, Mongo scripted-collection tests, sim-api over HTTP.
- **PNG export** (`exportPng(boardEl, items, opts)` using the existing `html-to-image` dependency, client side): renders the bounding box of all live items (+ 48 px padding) at 2× (cap 4096 px on the long side, scale down otherwise), light/dark follows the current theme, hides cursors/selection/handles/minimap/toolbars (render from a cloned world layer), cross-origin GIFs/images that cannot be read are replaced by a neutral placeholder with the card text intact (never a failed export), filename `<title>-<YYYY-MM-DD>.png` sanitised. Available to everyone who can view the board (it is their own view), from `ExportMenu` in the top bar (button 'Export' with a menu: PNG, CSV (owner only), Print / Save as PDF (Task 18)); progress state and an error toast. Pure helpers (bounds, scale, filename) unit-tested.
- **CSV export** (`GET /api/boards/[code]/export?format=csv[&authors=1]`, OWNER ONLY, `Cache-Control: no-store`, `Content-Disposition: attachment; filename="<sanitised title>-<date>.csv"`): one consistent snapshot (single store read of board, items, participants); UTF-8 with BOM; header row `Board,Type,Category,Item,Kind,Votes,Color,Created,Author`; `Category` = frame title containing the item (reuse `categorize` from `src/lib/ai/input.js`, 'Uncategorised' otherwise; celebration cards: 'Cards'; shoutouts: the badge); `Item` = text/message (shoutouts: 'To <name>: <message>'); `Votes` = count; `Author` column ONLY when `authors=1` (default off; persona names only, never uids/emails/user ids); rows sorted by category order (frame x position) then votes desc then created; deleted items excluded; a trailing rows block for a shared summary if any (`Kind=Summary`). `src/lib/csv.js`: RFC 4180 quoting; CSV/formula-injection defence (a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`); control/bidi characters stripped; unit tests for quoting, injection, newlines, commas, quotes, unicode, empty board, 2,000 items performance (< 200 ms). Rate limit 10/min per owner. The UI downloads via a plain link so the session cookie is used; an 'Include author names' checkbox (default off) with the sentence 'Author names are the anonymous names people chose'.
- [ ] **Steps:** write failing tests first for each piece; implement; `npm test` pristine; extend sims; browser check (production build, port 3300, blanked services): remove a scripted guest (their stream ends, kicked panel, rejoin 403), items kept vs deleted, PNG downloads for a canvas with notes/cards/GIF (view the PNG), CSV opens correctly (check with a script and by inspecting the file; injection cell test with a note starting `=cmd`), export menu keyboard/375px, console clean.

### Task 17B: Configurable columns and custom templates (extras phase, right after Task 17)

User requirement (2026-10-29, from a screenshot of a Retro board): the columns must be configurable, not limited to the built-in template layouts.

**Files:**
- Create: `src/app/api/templates/route.js` (GET list, POST create), `src/app/api/templates/[id]/route.js` (DELETE), `src/lib/columns.js` (pure column model + validation), `src/ui/ColumnsEditor.jsx`, `src/ui/settings/ColumnsSection.jsx`
- Modify: `src/lib/templates.js` (`starterItems` from a column list), `src/lib/validate.js` (`validateBoardInput` accepts `columns`), `src/lib/store.js` (both stores: user templates), the New-board dialog (a 'Columns' step), `src/ui/BoardSettings.jsx`, sims, README

**Interfaces:**
- `columns.js`: `MAX_COLUMNS = 8`, `validateColumns(input) -> { ok, columns } | { ok:false, error }` (1–8 columns; each `{ title: 1–40 chars, control/bidi/zero-width stripped, emoji?: exactly one emoji via `isSingleEmoji` or empty }`; duplicate titles allowed but trimmed; at least one column), `layoutColumns(columns, { w = 360, h = 640, gap = 24, top = 140 }) -> frame items` (ids `starter-col-<n>`, each frame item has `data: { title, col: true }` so the UI can tell a column from a free frame), `presetColumns(templateKey)` for the existing retro templates (`retro-wwci`, `retro-ssc`, `retro-msg`) plus 'Blank (3 empty columns)'.
- **New board dialog (Retro and Workshop 'Kanban')**: after choosing a template, a 'Columns' step shows the template's columns as an editable list: rename (text field), emoji picker (single emoji or none), reorder (move up/down buttons AND drag with keyboard support), remove, 'Add column' (up to 8), 'Reset to template'; a live mini preview of the board layout; also 'Start from a saved template' (the user's own). The chosen columns are sent as `columns` with `POST /api/boards` (validated server-side; ignored for types that do not use columns) and the starter frames are generated with `layoutColumns`.
- **Settings → Columns (owner, retro/workshop boards)**: lists the board's column frames (`data.col === true`) with rename, emoji, move left/right, remove (confirm: 'Notes inside stay on the board'), 'Add column' (appended to the right of the last one, same size). All through the normal item ops (update `data.title`, update `x`, add/delete frame) so presence/undo/live sync/permissions behave as usual; free frames the user drew with the frame tool are unaffected and can be turned into columns ('Use as column') or back.
- **Custom templates (per account)**: owner can 'Save these columns as a template' (name 1–40 chars) from the dialog or from Settings → Columns; stored in a `templates` collection `{ id, ownerId, name, type, columns, createdAt }` (max 30 per account, unique name per account), listed under 'My templates' in the New-board dialog and deletable; routes require a session (401), JSON + same-origin, rate limit 30/min per account, validation via `validateColumns`; both stores, index `{ownerId, createdAt}`.
- Also make the other fixed bits configurable where they appear: the starter header text ('Add notes to each column, then vote.') becomes editable (it is a normal text item), and the number of votes (already configurable) is offered in the dialog's last step with sensible defaults (3).
- [ ] **Steps:** failing tests first (`columns.js` validation incl. emoji/ZWJ/bidi/limits, `layoutColumns` no-overlap for 1..8 columns, route authz, store parity incl. scripted-Mongo, create-board with custom columns, columns settings ops, template save/list/delete limits); implement; `npm test` pristine; extend sims; browser check (production build, port 3300, blanked services): create a Retro board with 6 custom columns (rename/emoji/reorder/remove), add a column later from Settings, rename and move a column live with a scripted guest watching, save as template and reuse it, keyboard-only column editing, 375px dialog, console clean.

### Task 18: AI grouping and PDF export (extras phase, order 3 of 4)

**Files:**
- Create: `src/lib/ai/themes.js` (prompt + validation), `src/app/api/boards/[code]/themes/route.js`, `src/ui/ThemesPanel.jsx`, `src/ui/items/Theme.jsx`, `src/app/b/[code]/print/page.js` + `src/ui/PrintView.jsx` + `src/ui/print.css`
- Modify: `src/lib/validate.js` (item kind `theme`), `src/lib/vote.js`/`plan.js` (themes votable), `src/lib/aiBoard.js`, `src/lib/ai/anthropic.js` (second prompt kind), `src/lib/boardPatch.js` (`ai.grouping`), settings AI section, `src/ui/ExportMenu.jsx`, README, spec D1 notes, sims

**Interfaces:**
- **AI grouping** (spec Amendment D1; Retro boards only): owner presses 'Suggest themes' (needs `ai.enabled && ackAt`; same notice/limits/budget family as summaries: 5 per board per hour counted together with summaries unless a separate counter is simpler — decide and document; a per-owner daily cap of 40 shared). `POST /api/boards/[code]/themes` → builds the input with `categorize`/`buildSummaryInput`-style item list with SHORT ids (`n1…n200`, mapping kept server-side; never real item ids or authors) → provider returns JSON `{ themes: [{ title, noteIds: [] }] }` → SERVER VALIDATES: ≤ 12 themes, titles 1–60 chars control-stripped, ids must exist, each note in at most one theme, unknown ids dropped, leftovers stay ungrouped, malformed JSON → one retry then friendly error. Stored as `board.themeSuggestions` (OWNER-ONLY field: never in guest-safe boards, broadcasts, since, reveal; tested by bytes). Suggestions never touch the notes. `ThemesPanel` (owner): list suggestions with their source notes (excerpts), actions Accept (adds a `theme` item `{ title, noteIds }` via the normal ops path, placed in a free spot or inside a 'Themes' frame; the theme item shows the title and the count and highlights its source notes on hover/focus — outline only), Rename, Combine (merge two suggestions), Split (remove selected notes into ungrouped), Dismiss; accepted themes are normal votable items (voting rules extended to kind `theme`; notes remain votable too); `Theme.jsx` renders a themed card with the linked-note list (links by id, deleted notes skipped) and `aria-label`. Manual grouping stays available: owner can create a theme item by hand and link selected notes. Provider interface gets `suggestThemes(items)` next to `summarize`; the `AI_FAKE` provider returns deterministic themes. Rate-limit/refund policy as for summaries. Tests with a fake fetch: valid reply, duplicate note ids, unknown ids, >12 themes, long titles, malformed JSON retry, empty board, ids mapping (the prompt contains only short ids), prompt privacy (no authors), owner-only, suggestions invisible in every guest transport, accept creates theme with valid links, deleted source note handling, vote on theme counts, injection text delimited as data.
- **PDF export** (decision: no server-side PDF library — Unicode and font embedding would add heavy dependencies; use a print-optimised view): `/b/[code]/print` renders the board as a document (cover with title/type/date/participants count; one section per category with items, vote counts, theme list with source notes, shared summary; celebration cards one per block; shoutouts; actions later) styled with `@media print` (page breaks, A4/Letter, no UI chrome), reading ONE consistent snapshot, owner and guests with read access (same visibility rules as the board: guests see no drafts); 'Print / Save as PDF' button calls `window.print()`; the page works without JavaScript for content that was server-rendered where feasible (otherwise client-rendered after the snapshot; state which). Authors are excluded by default with an 'Include author names' toggle on the print page (owner only). Tests for the pure document-model builder (`buildPrintModel(board, items, participants, options)` — categories, ordering, votes, themes, summary visibility rules, author toggle, anonymity) and the page route authz (revoked/passcode), plus a browser check that the print preview of a 40-note board paginates cleanly and fits A4 (use the pane's print emulation or `page.pdf`-style screenshot at print width).
- [ ] **Steps:** failing tests first; implement; `npm test` pristine; extend sims; browser check with `AI_FAKE=1` on a dev server (port 3300, blanked services) incl. the draft-visibility bytes; the controller makes ONE real grouping call afterwards via a smoke script (`scripts/ai-smoke.mjs --themes`).

### Task 19: Full staged Retro workflow (extras phase, order 4 of 4)

Outline only — the controller writes the detailed sub-plan (19A stage engine, 19B discussion + actions, 19C anonymous notes + export additions) right before starting, from spec Amendment B and the finished Tasks 17–18:
- 19A stage engine: `board.retro = { stages: [{ key, label, durationMs|null, skipped }], current, startedAt, pausedAt?, editing: 'open'|'locked' }` with the default stages Join 1 min → Collect 5 → Group (optional) → Vote 2 → Discuss 8 → Actions 5 → Wrap up 2 → Export; every duration configurable or off, facilitator = owner (next/prev/jump, skip, pause/resume the stage timer, extend, lock/reopen editing); SERVER-enforced rules per stage (notes only in Collect with editing open; theme ops in Group; votes only in Vote, with the existing per-person limit and a multiple-votes-per-item option; discuss selection in Discuss; action cards in Actions with a max); one clear primary screen per stage with a stage header (name, step n/m, progress, prominent timer); setup wizard for the configuration; resume after refresh.
- 19B discussion + actions: top-N voted topics (default 3, owner picks, tie handling UI), per-topic discussion notes and status (not discussed/discussed/deferred/converted), action cards (action, owner, due, success measure, optional status/priority/notes; max 3 default; missing owner/due flagged), follow-up list.
- 19C anonymous notes + exports: a per-note 'post anonymously' option with the author hidden from everyone but the owner on every transport (tested by bytes), CSV/print additions (actions, topics, statuses), AI summary prompt additions (actions, discussion notes).
