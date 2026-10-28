# Retrospace — Design Spec

Date: 2026-10-28
Status: draft, awaiting review
Location: `~/Desktop/retrospace` (standalone repo; nothing inside mb-mobile)

## 1. Intent

A collaborative web app that combines a Mural-style whiteboard with Kudoboard-style celebrations and an ongoing team recognition wall. People open a board by link, add content together and see each other live. Celebrations end in a "reveal" moment with confetti for the recipient.

Success looks like:
- Two browsers on the same board see notes, moves, edits and cursors appear within ~1s.
- A celebration board can be created from a template, filled by several people, and revealed to the recipient with effects and a slideshow.
- A team wall shows shout-outs and automatic birthday/anniversary banners.
- Works with no env vars (local, single-user, data lost on restart), with `MONGODB_URI` (persistent), and with Upstash (live).

Said by the user: Mural-like, congratulations features, Next.js + MongoDB, "similar to my-space", all three uses, live like my-space, outside mb-mobile. Amended 2026-10-28 (Amendment A below): board creators have accounts (email + password); participants join as guests with an access code; no AI features; a clean, professional landing page.
Assumed: English UI, desktop-first but usable on phones, no email sending, no payments.

## 2. Stack (mirrors `~/Desktop/my-space`)

- Next.js 16 App Router, React 19, plain JSX, `"type": "module"`. Read `node_modules/next/dist/docs/` before writing Next-specific code (my-space AGENTS.md warns APIs changed).
- `mongodb` driver (no Mongoose), cached client on `globalThis` as in my-space `src/lib/db.js`.
- `@upstash/redis` for pub/sub, presence and rate limiting; SSE bridge route copied from my-space `src/app/api/rt/stream/route.js`.
- No UI framework; one `globals.css` with CSS variables plus CSS modules where useful. No canvas library: the board is DOM + CSS transform + an SVG layer.
- Only extra runtime deps: `html-to-image` (PNG export). Confetti/fireworks are hand-written on a `<canvas>` overlay.

Env (`.env.local`, never committed; `.env.example` checked in):

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` (default `retrospace`) | persistence |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | live sync, presence, rate limits |
| `RT_SECRET` (optional) | signs board membership tokens |
| `NEXT_PUBLIC_GIPHY_API_KEY` (optional) | GIF search through the Giphy React SDK (a public web SDK key, sent to the browser by design); without it, paste a GIF URL |
| `NEXT_PUBLIC_SITE_URL` (optional) | share links |

When Mongo is missing, an in-memory store (`globalThis` Map) is used so `npm run dev` works with zero setup.

## 3. Identity and permissions (amended — see Amendment A)

- **Creators have accounts** (email + password). Only a signed-in user can create a board; that user is the board's **owner** (`board.ownerId`) and facilitator.
- **Participants are guests**: no account. They enter the board's **access code** (the 6-character board code) on the landing page, or open the shared link, enter the optional passcode, and then **choose how they appear on that board** (Amendment C): accept a generated anonymous name and avatar (shuffle, or pick another avatar), or create their own name and avatar. A guest keeps an anonymous `uid` `KM-XXXX-XXXX-XXXX` (my-space alphabet) in localStorage and a cookie; the chosen name and avatar (their *persona*) are stored per board on the server.
- Anyone with access: view, add items, edit/delete items they authored, vote, react.
- Owner (signed-in session whose user id equals `board.ownerId`): edit/delete any item, board settings, lock board (read-only for others), passcode, close or revoke the board, set reveal time, manage people, delete board.
- Celebration boards before reveal: contributors see the board; the reveal page (`/b/[code]/reveal`) shows a "coming soon" countdown until `revealAt` unless the viewer is the owner.
- The server derives the actor from the session cookie on every request. No request body carries proof of ownership (the earlier `ownerKey` is removed).

## 4. Board types

### 4.1 Workshop (Mural-style)
Infinite canvas with pan (space+drag, middle-drag, two-finger) and zoom (ctrl/cmd+wheel, pinch, 10%–400%). Tools: select, sticky note (6 colors), text, shape (rect, ellipse, diamond), connector (between items, arrowheads), frame (titled section that moves its children), image, GIF. Multi-select with marquee and shift-click, move, resize, duplicate, delete, z-order, undo/redo of own ops. Dot-voting session (owner starts, N votes per person, results highlight), countdown timer visible to all, minimap, templates: blank, retrospective, brainstorm, SWOT.

### 4.2 Celebration (Kudoboard-style)
Created from an occasion template: birthday, promotion, farewell, work anniversary, welcome, new baby, congratulations/win, thank you. Each template sets theme colors, background pattern, title text, and a starter header item. Contributors add **cards**: message text, signer name, optional GIF/image, card color. Cards auto-place in a masonry grid on the canvas (still draggable). Owner sets recipient name, optional `revealAt`. Reveal page: full-screen intro animation with the recipient's name, confetti/fireworks/balloons (per theme), then a card slideshow (auto-advance, arrows, keyboard), then the full board. "Celebrate" button on any board fires effects for everyone live.

### 4.3 Team wall
Long-lived board per team. Items are **shout-outs**: from, to (@mention of a wall member), message, badge (Teamwork, Above & Beyond, Innovation, Customer Hero, Thank You), optional GIF. Feed view (newest first) with a toggle to canvas view. A `people` list per wall (name, birthday MM-DD, start date) editable by the owner; on page load the wall shows a banner and fires effects for today's birthdays and work anniversaries. Reactions (6 emoji) on every shout-out.

## 5. Data model (MongoDB)

`boards`
```
{ code, type: 'workshop'|'celebration'|'wall', title, template, theme,
  ownerKeyHash, locked, recipient: { name } | null, revealAt: Date|null,
  vote: { active, perPerson } , timer: { endsAt } | null,
  createdBy: uid, createdAt, updatedAt }
```
index: `{ code: 1 }` unique

`items`
```
{ boardCode, id, kind: 'note'|'text'|'shape'|'connector'|'frame'|'image'|'card'|'shoutout',
  x, y, w, h, z, rot, data: {...kind-specific}, authorUid, authorName,
  votes: [uid], reactions: { '🎉': [uid] }, updatedAt, deleted: false }
```
index: `{ boardCode: 1, id: 1 }` unique, `{ boardCode: 1, updatedAt: 1 }`

`people` (wall only): `{ boardCode, id, name, birthday: 'MM-DD'|null, startDate: Date|null }`

Images/GIF uploads: stored in `data.src` as a data URL capped at 600 KB after client-side downscale (max 1600px, webp). GIFs picked through the Giphy React SDK are stored as https URLs.

Limits: 2,000 items per board, `data` JSON ≤ 8 KB except image items, title ≤ 80 chars, text ≤ 2,000 chars.

## 6. API (route handlers, `runtime = 'nodejs'`)

- `POST /api/boards` `{ type, template, title, recipient?, uid, name }` → `{ code, ownerKey }`
- `GET /api/boards/[code]` → board + items (non-deleted) + people
- `PATCH /api/boards/[code]` (owner) settings: title, theme, locked, revealAt, recipient, vote, timer
- `DELETE /api/boards/[code]` (owner)
- `POST /api/boards/[code]/ops` `{ uid, name, ownerKey?, ops: [{ op: 'add'|'update'|'delete'|'vote'|'react', id, patch? }] }` → validates, writes to Mongo, publishes `{ t:'ops', from: uid, ops }` to `kb:<code>`, returns applied ops with server `updatedAt`. Max 50 ops per call.
- `GET /api/boards/[code]/since?t=` → items changed after `t` (polling fallback)
- `POST /api/boards/[code]/people` (owner) add/edit/delete wall people
- `POST /api/rt/join` `{ code, uid }` → signed token (HMAC of `code:uid`)
- `POST /api/rt/send` `{ code, uid, tok, msg }` ephemeral: cursor, selection, celebrate, typing. Rate 30/s per uid.
- `GET /api/rt/stream?code&uid&tok` SSE bridge from Upstash `subscribe/kb:<code>`
- GIF search has no server route: the browser calls Giphy through the Giphy React SDK (`@giphy/js-fetch-api` `GiphyFetch` + `@giphy/react-components` `Grid`) using `NEXT_PUBLIC_GIPHY_API_KEY`.
- `GET /api/my-boards?uid=` boards the uid created or contributed to (for dashboard)

All POST bodies validated; rate limit by IP via Redis (`rl:*`) as in my-space; 429 on abuse.

## 7. Realtime flow

1. Board page loads snapshot from `GET /api/boards/[code]`.
2. Joins: gets token, opens `EventSource` to `/api/rt/stream`.
3. Local change → applied optimistically → batched (every 50 ms) to `/ops`.
4. Server persists, publishes; other clients apply by `id`, last-writer-wins on `updatedAt`; own echoes ignored by `from`.
5. Drag moves send `update` ops throttled to 20/s during drag, final position on drop.
6. Cursors/presence via `/api/rt/send`, throttled 15/s; peers expire after 12 s silence (their cursor hides after 10 s without moving). Presence bar shows avatars.
7. No Upstash: no SSE; client polls `/since` every 3 s; cursors hidden.
8. SSE drop: browser auto-reconnects (retry 1500), then calls `/since` to catch up.

## 8. Frontend structure

```
src/app/layout.js, globals.css, page.js            dashboard + new-board picker
src/app/b/[code]/page.js                           board (client component Board)
src/app/b/[code]/reveal/page.js                    reveal experience
src/app/api/...                                    routes above
src/lib/db.js        Mongo/Redis clients + memory fallback store
src/lib/rt.js        tokens, channels, rate limits (from my-space)
src/lib/validate.js  item/op schemas, size caps
src/lib/templates.js board templates and occasion themes
src/client/identity.js   uid/name/color/ownerKey storage
src/client/sync.js       ops queue, SSE, polling fallback, presence
src/client/store.js      board state reducer (items by id, undo stack)
src/ui/Board.jsx         viewport, pan/zoom, tool dispatch
src/ui/Toolbar.jsx, ItemView.jsx, items/*.jsx (Note, Text, Shape, Connector, Frame, Image, Card, Shoutout)
src/ui/Presence.jsx, Cursors.jsx, Minimap.jsx, Timer.jsx, VotePanel.jsx
src/ui/CardComposer.jsx, ShoutoutComposer.jsx, GifPicker.jsx
src/ui/Effects.jsx       confetti / fireworks / balloons canvas
src/ui/Reveal.jsx, Slideshow.jsx, WallFeed.jsx, PeopleEditor.jsx
scripts/sim-api.mjs      API scenario tests
scripts/sim-live.mjs     two-client live sync test (needs Upstash)
```

## 9. Error handling

- API: 400 invalid input, 403 not owner / locked, 404 missing board, 413 too large, 429 rate limited, 503 store unavailable (only if Mongo URI set but unreachable). JSON `{ error }` always.
- Client: failed op batches retry 3× with backoff, then show a "changes not saved" toast and keep them queued; on reconnect re-send. Conflicting server state replaces local item.
- Images over cap are downscaled further; if still too big, rejected with a toast.

## 10. Testing

- `scripts/sim-api.mjs`: against `npm run dev`, creates each board type, adds/updates/deletes items, checks owner vs non-owner permissions, size caps, reveal gating, polling `/since`.
- `scripts/sim-live.mjs`: two SSE clients on one board; op from A arrives at B < 1.5 s (skips if Upstash not set).
- Unit tests (`node --test`) for `validate.js`, store reducer, template/theme lookup, milestone date logic.
- Manual: two browser tabs in the built-in browser for cursors, drag, celebrate effects, reveal slideshow; phone viewport check.

## 11. Out of scope (v1)

SSO/OAuth sign-in, password reset and email verification (both need an email sender), email notifications and invite-by-email, projects/memberships/co-facilitator roles, comment threads, PDF export (phase 2), version history, video messages, more than ~2k items per board. AI is allowed for two things only: optional **grouping** of feedback into suggested themes and optional **summaries** (Amendment D, reinstated by the user on 2026-10-28). Nothing else (no tagging, scoring, rewriting or auto-actions).

## Amendment A (2026-10-28): accounts, access codes, landing page

Decided with the user: creators sign in with **email + password**; the **board code is the access code**; the landing page is **clean and professional**; **no AI**.

### A1. Accounts and sessions
- `users`: `{ id: 'u_' + random, email (lowercased, unique), name, passwordHash, createdAt }`. Passwords 10–128 chars, hashed with Node `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt, stored as `scrypt$N$r$p$salt$hash`), compared with `timingSafeEqual`. No new dependency.
- `sessions`: `{ tokenHash (SHA-256 hex of a 32-byte random token), userId, createdAt, lastSeenAt, expiresAt (30 days) }` with a unique index on `tokenHash` and a TTL index on `expiresAt`. The cookie `rs_session` holds the raw token: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` in production.
- Routes: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. Login failures always say "Invalid email or password"; an unknown email still runs a dummy scrypt verify so timing does not reveal accounts. Register returns 409 for an existing email.
- Rate limits: register and login 10/min per IP; with Redis when configured, otherwise an in-process fallback (this limit is security-relevant, so it must work without Redis).
- CSRF: `SameSite=Lax` cookies, every mutating route requires `Content-Type: application/json`, and a mutating request whose `Origin` header is present and not same-origin is rejected with 403.
- Known limits of v1: no email verification and no password reset (both need an email sender).

### A2. Ownership and access
- Board fields: `ownerId` (replaces `ownerKeyHash`), `passcodeHash` (scrypt, or null), `status` (`open` | `closed`), `revoked` (boolean).
- One server function, `authorize(req, board, { write })` in `src/lib/access.js`, is called by every board route (snapshot, since, ops, people, settings, rt join/send/stream). It returns `{ role: 'owner' | 'guest', user?, uid? }` or throws an HTTP error. Rules: `revoked` → 403 for everyone except the owner; `closed` → writes rejected for non-owners ('Board is closed'); passcode set → guests need the access cookie `rs_a_<code>` (HttpOnly, signed with `signTok`-style HMAC over code, uid and the passcode hash prefix, so changing the passcode invalidates it); owner always passes.
- `GET /api/join/[code]` is public and returns only `{ exists, title, type, needsPasscode, closed, revoked }`. `POST /api/boards/[code]/join` `{ uid, name, passcode? }` checks the passcode (rate limited 10/min per IP) and sets the access cookie.
- `GET /api/boards/[code]` also returns `viewer: { role, userId? }`; the UI takes "am I the owner" from this, never from local storage.
- `GET /api/my-boards` returns the signed-in user's owned boards. Guests' recently joined boards are remembered in localStorage only.
- **Many boards per owner, one unique key each.** A signed-in owner can create any number of boards (no per-account limit in v1). Every board gets its own access code from the 31-character alphabet; uniqueness is enforced by the database (unique index on `boards.code`), creation retries with a fresh code on a collision, and a code is never reused after a board is deleted while its tombstoned data exists. The dashboard lists all of the owner's boards, each showing its own code. The owner sends a board's code to the people who should join that board; entering it opens that board only. A code never reveals the owner, the owner's other boards or any other board, and a guest session holds access to the boards whose codes it has entered and nothing else. A leaked code is handled with revoke (the code is also the board's id, so it cannot be regenerated in v1).
- Sharing: the owner screen shows the access code and link with Copy buttons and a `mailto:` share link. The app sends no email.

### A3. Pages
`/` landing; `/login`; `/register`; `/join` (also the landing join box); `/boards` dashboard (signed-in only, redirects to `/login?next=`); `/b/[code]` board; `/b/[code]/reveal`.

### A4. Landing page (clean and professional)
- Sticky header: logo, Features, How it works, Sign in, Get started.
- Hero: H1 "Retrospectives, workshops and celebrations your whole team can join in seconds", one line of subcopy, primary button "Create a board", and a prominent **Join with code** field (6 characters, auto-uppercase, submit button, inline error).
- A product preview drawn with SVG/CSS (sticky notes, cursors, a vote badge), not a screenshot.
- Three board-type cards (Workshop, Celebration, Team wall), a feature grid (live collaboration, voting and timers, templates, the reveal moment, export), a 3-step "How it works" (create → share the access code → collaborate), a closing call to action, and a footer.
- No fabricated customer logos, statistics or testimonials.
- Neutral palette with one accent, Inter, 8px spacing grid, light and dark via the existing tokens, WCAG AA contrast, skip link, full keyboard use, visible focus, reduced-motion respected, works from 375px to 1440px, page metadata and Open Graph tags.

### A5. Changed task order
Task 6 (running) → 12 accounts → 13 ownership and access → 15 personas (name + avatar) → 14 landing, auth and join screens → 7 → 8 → 9 → 10 (dashboard becomes `/boards`, by account) → 11. Task 7's settings panel also gets passcode, close, revoke and the share-code panel. Retro mode is **approved as phase 2, after Task 11** (user decision 2026-10-28); see Amendment B.

## Amendment B (2026-10-28): Retro mode (phase 2, after Task 11)

A fourth board type, **Retro**, for Agile team retrospectives, built on the existing canvas, sync, accounts and access codes. A thin presentation slice (starter templates on the existing canvas plus AI summary, plan Task 16) is built first; the full engine below gets its own detailed spec and plan afterwards. The agreed scope is:
- **Staged workflow**, configurable per session: Join → Collect feedback → Group (manual, plus optional AI-suggested themes) → Vote → Discuss → Create actions → Wrap up → Export. The server enforces stage order and who may change it; facilitators can add, remove, rename, reorder or skip stages. Every stage duration is a default only: the facilitator can change it, pause or resume the timer, turn it off, or run the stage with no limit, during setup or while facilitating.
- **Templates:** Went Well / Could Be Improved / Blockers / Ideas; Start / Stop / Continue; Mad / Sad / Glad; plus saving a custom format as a reusable template.
- **Notes:** named or anonymous (anonymous notes never expose the author to anyone, the owner included, on any transport or export (the server keeps the author only to decide who may edit or delete the note; the author's own client is told `mine`; removing a participant leaves their anonymous notes in place because deleting exactly their notes would reveal who wrote them; live cursors near a note are a weaker signal that is not hidden)), optional per-person limit, editing can be locked and reopened, unsent drafts survive disconnects.
- **Voting:** default three votes each, configurable; multiple votes on one item optional; totals visible or hidden during voting; start, pause, resume, end, reset; limits and duplicates enforced on the server; consistent tie handling with the facilitator choosing which tied topics to discuss.
- **Discuss:** top three voted topics by default (configurable or hand-picked), with vote count, source notes, discussion notes and a status of not discussed, discussed, deferred, or converted to an action.
- **Actions:** action, owner, due date, success measure, optional status, priority and notes; default maximum of three, configurable; saved without an owner or due date but flagged for follow-up; members can track them after the session.
- **Wrap up:** manual summary editing and Copy Summary, plus an optional AI-written draft (Amendment D); the facilitator can finish, leave read-only, or reopen the session.
- **Export:** CSV (Category, Item, Votes plus session and theme fields; values escaped safely, including cells starting with `=`, `+`, `-` or `@`) and PDF (session details, notes, themes, votes, discussion notes, actions), both generated from one consistent snapshot and respecting anonymity and access settings.
- **Accessibility** as an acceptance rule: keyboard use, labels, contrast and screen-reader support.
- **Acceptance test:** create a session, join as a participant, add and edit feedback, vote, create an action, export.
- **Excluded:** invite-by-email, projects and memberships, co-facilitator roles.

## Amendment C (2026-10-28): participant personas (anonymous name + avatar)

Decided with the user: before joining a board, a guest is offered a **generated anonymous name and avatar**. They either **approve it** (and may shuffle or select a different avatar), **or create their own** name and avatar.
- **Persona** = `{ kind: 'anonymous' | 'custom' | 'account', name, avatar }`, stored per board and per participant (`participants`: `{ boardCode, uid, kind, name, nameLower, avatar, joinedAt }`; unique on `{ boardCode, uid }` and on `{ boardCode, nameLower }`). `uid` here is a **per-board public id** derived by HMAC from the private guest cookie (or, for the signed-in board owner, from the account), never the cookie value itself, so the same person has unrelated ids and independent personas on different boards and nothing links them. Name uniqueness compares a normalised key (NFKD, invisible characters stripped, combining marks stripped only on Latin, Greek and Cyrillic letters so that Indic, kana, Thai and similar names stay distinct, best-effort look-alike folding). A board holds at most 300 participants.
- **Generated anonymous name** = `<Adjective> <Animal>` (at least 48 of each; friendly words only), unique on the board (probe up to 50 times, then append " 2", " 3", ...).
- **Avatar** = a small generated SVG creature built from parts: `{ bg (12), body (8), eyes (8), mouth (8), extra (8) }` (extra = none, glasses, hat, antenna, ears, bow, ...). No emoji, images or external library. A picker shows a live preview, a Shuffle button and a chooser per part.
- **Custom name**: 2–24 characters, control characters stripped, at least one letter or digit, unique on the board (case-insensitive) and not equal to the board owner's name (no impersonating the facilitator). A taken name returns 409; for anonymous names the response carries a fresh suggestion.
- **Anonymous means validated**: an `anonymous` persona must be an exact `<Adjective> <Animal>[ N]` from the lists, so free text cannot be passed off as an anonymous name.
- **Guest identity is proven by a server-signed cookie** (`rs_g`, HttpOnly, HMAC over the uid), not by a uid typed into a request body; this closes the hole where one guest could act as another by copying their visible uid.
- **Server is the only source of identity.** Item `authorName`/`authorAvatar`, cursors, presence and `hello` messages are stamped from the participant record; a `name` in a request body is ignored.
- **Stable once used**: a participant can change their persona until they have authored something on that board; after that it is fixed for that board (keeps authorship consistent). Changes are rate limited (10/hour per uid).
- **Owner** appears as `account`: their account name and an avatar derived from their user id (also changeable until they author something).
- Real privacy for notes (hiding the author from other viewers) is a Retro-mode feature (Amendment B), not part of this amendment.

## Amendment D (2026-10-28): AI grouping and AI summaries

Decided with the user: AI may be used for **grouping** feedback into themes and for **summaries**, using the **lowest model** because both are short text tasks. The user supplied an Anthropic API key.
- **Model:** `claude-haiku-5-5` (the smallest current model), overridable with `AI_SUMMARY_MODEL`. Replies capped at 600 tokens (summary) / 900 tokens (grouping); input is capped (at most 200 items, each trimmed to 300 characters, oldest and longest dropped first, noted in the prompt) so one request stays cheap. No `temperature` parameter is sent: the real API rejects it for this model (HTTP 400 "`temperature` is deprecated for this model"). Implementation note (Task 16): when over the cap the least-voted items are dropped first (then longest, then oldest) so voted items survive, and the prompt carries a text-only "Most-voted" list of the top three items by votes; both are additions to the wording above.
- **Server only:** the key is read from `ANTHROPIC_API_KEY` on the server, never sent to the browser (no `NEXT_PUBLIC_` prefix), never logged. Calls sit behind a small provider interface in `src/lib/ai/` (`suggestThemes(items) -> { themes } | { error }`, `summarize(input) -> { text } | { error }`) so the provider can change.
- **Triggers:** grouping runs when the owner/facilitator presses "Suggest themes". **Summaries are automatic** (user decision 2026-10-28, see D2); the owner can also press "Regenerate". Nothing else calls the model, and only on boards where the owner has switched AI on. Owner actions are enforced on the server. Rate limits per board: grouping 5 per hour, summary generations 5 per hour (automatic ones count), and 40 AI calls per owner per day. Each call logs only a count and token usage, never content.
- **Privacy:** AI is **off per board until the owner switches it on**, and switching it on shows "Board content will be sent to Anthropic to group notes and write summaries. This includes automatic summaries when the board ends." and records the owner's acknowledgement (`board.ai = { enabled, ackAt, autoSummary, autoShare }`). Automatic summaries therefore never run on a board whose owner did not opt in. Prompts contain only an item id, its text and its category, never author names, user ids, emails or avatars; anonymous notes stay anonymous. The setting can be switched off per board; when off or when no key is configured, the buttons are hidden and everything works manually.
- **Resilience:** 15 s timeout, one retry on a transient error. Any failure returns a friendly message and the manual path stays available (manual grouping or individual notes; hand-written summary). The workflow never depends on AI.

### D1. Grouping (Retro mode Group stage)
- "Suggest themes" sends the notes to the model and asks for JSON `{ themes: [{ title, noteIds: [] }] }`. The server **validates** the reply: at most 12 themes, titles 1–60 characters (control characters stripped), every `noteId` must exist on the board, each note appears in at most one theme, unknown ids are dropped, and notes the model leaves out stay ungrouped. Malformed JSON gets one retry, then a friendly error.
- Results are stored as **suggestions** (`themeSuggestions`), separate from the notes. **Suggestions never replace, move, edit or delete original feedback**; notes keep their category, author settings and position.
- The facilitator reviews each suggestion: accept (creates a theme linked to its source notes by id), rename, combine two themes, split notes out of a theme, or dismiss. Themes are always linked to their source notes and can be opened to show them.
- Voting then runs on the approved themes if there are any, otherwise on individual notes. Manual grouping (drag notes into a theme) is always available, with or without AI.
- Standard template: AI grouping is enabled by default **only when a key is configured**; the facilitator can disable it in setup.

### D2. Summaries (automatic)
- **When a summary is generated automatically** (once per trigger, in the background with Next's `after()`, never blocking the request that caused it):
  - Retro mode: when the session enters the **Wrap up** stage.
  - Any board: when the owner **closes** the board (`status: closed`).
  - Celebration board: when the **reveal** opens, a short recap of the cards.
  The owner can also press "Regenerate" at any time (counts toward the rate limit).
- **Never on every edit and never repeatedly:** a trigger generates at most one summary; a second trigger for the same board only generates again if the content changed and the hourly limit allows.
- **Stored on the board:** `board.summary = { text, status: 'draft' | 'shared', source: 'ai' | 'manual', model, generatedAt, editedAt }`. A generated summary starts as a **draft** visible to the owner only ("Draft summary ready — review"), opens in an editable text box, and becomes visible to everyone only when the owner confirms it. The owner can switch on `autoShare` (off by default) so that automatic summaries are shared as soon as they are generated; the summary then carries an "AI-generated" label and the owner can edit or withdraw it.
- Contents: top successes, areas to improve, agreed actions and key takeaways in Retro mode; a short recap of the cards on celebration boards; headlines and open items on workshop boards. The same summary can be written by hand with no AI, and Copy Summary gives editable plain text.
- If generation fails, the board shows "Couldn't write the summary automatically" with a Retry button and the manual editor; nothing else is affected. The owner is told through a board-update message (live) or on next visit.

### D3. Not built yet
Build with Retro mode (after Task 11): `src/lib/ai/` provider, the grouping and summary routes, the suggestion review UI, tests with a fake provider (valid reply, malformed JSON, unknown ids, duplicate note ids, timeout, rate limit, owner-only, no author data in the prompt). **No test calls the real API**; one manual check with the real key happens at the end and is reported to the user.

## Amendment E (2026-10-28): throwables (owner-enabled emoji throwing)

Requested by the user: because everyone is anonymous, participants can *throw* things at items on a board, such as a banana, trash or a monkey, or any custom emoji, but only when the board owner has switched it on.
- **Off by default, owner-controlled.** `board.throwables = { enabled: false, emojis: [...] }`. The owner switches it on or off at any time in board settings and chooses the emoji set: 1–12 unique emoji, any Unicode emoji (validated: each entry must be exactly one emoji grapheme; text, images and markup are rejected). Default set when first enabled: 🍌 🗑️ 🐵 🍅 🌹 ❤️ 👏 🎉. Custom *image* emoji (uploads) are not part of v1.
- **What it does.** A participant picks an emoji from a small tray and clicks an item or a spot on the canvas. The emoji flies there in an arc and lands with a small impact animation that every connected viewer sees live, labelled with the thrower's persona (name and avatar, so it stays anonymous). It is an ephemeral effect: nothing is stored on the item, nothing is counted, and it disappears after a moment.
- **Server-enforced.** Throws travel as ephemeral `throw` messages `{ t: 'throw', emoji, itemId?, x, y }` through `POST /api/rt/send`. For this message type only, the server loads the board and rejects the message unless `throwables.enabled` is true, the emoji is in the board's allowed list, and the board is not revoked, closed or locked (for non-owners). The persona is stamped by the server. Limits: 1 throw per 1.5 s per participant with a burst of 3, enforced on the server; the emoji set and `enabled` flag are validated by the PATCH route (new key `throwables`, owner only).
- **Safety and accessibility.** Because it can be used to mock someone's note, it is off until the owner opts in, the owner can switch it off instantly (clients drop the tray on the next settings broadcast and the server rejects further throws), and throws can never carry text. The animation respects `prefers-reduced-motion` (a simple pop at the target, no flight). Each landing is announced politely to screen readers ("Brave Otter threw 🍌"). The tray is keyboard operable (arrow keys to choose, Enter to arm, then Enter on a focused item to throw).
- **Throw limit.** The server limit is a fixed 4.5 s window of 3 throws per participant (a sustained 1 per 1.5 s with a burst of 3; up to 6 can pass across a window edge); the sender's client counts the same budget over a sliding 4.5 s window, which can never exceed it. Emoji are matched against the owner's list as exact strings.
- **Built in Task 7** (collaboration layer): settings UI for the toggle and the emoji picker, the tray, the flight/impact animation in the effects engine, and the server checks.
