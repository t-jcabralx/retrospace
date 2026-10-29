# Retrospace

A collaborative board for retrospectives, workshops and celebrations. Stick notes, images and GIFs on a shared canvas, vote, share a timer and see everyone's cursors live. Built with Next.js 16, MongoDB and an Upstash Redis realtime bridge, in plain JSX.

## Run

```bash
npm install
cp .env.example .env.local   # optional; without MONGODB_URI an in-memory store is used
npm run dev                  # http://localhost:3000
npm test
npm run build
```

## Status

Everything in the spec is built: workshop canvas, celebration board with reveal, retro boards (configurable columns and saved templates, staged workflow, anonymous notes, action cards, AI summary and AI theme suggestions, print/PDF view), team wall, participant removal, and CSV/PNG export. Not built: password reset and email verification. `npm test` passes and the production build succeeds.

Final end-to-end verification (production build, real MongoDB Atlas, Upstash, Giphy and Anthropic, a browser as the owner and a scripted guest; reports in `.superpowers/sdd/2026-10-28-kudo-mural/task-20-e2e-report.md` and `task-20-e2e2-report.md`):

**Verified live:** the 375px Retro top bar; the staged Retro end to end (Join refuses guest notes, Collect, Group, Vote with the creation-time limit, Discuss, Actions with owner/due flags, Wrap up); the Settings drawer on a staged board; saved column templates; anonymous notes (no author data in any JSON, CSV says "Anonymous"); AI summary (private draft, then shared) and AI theme suggestions (accepted theme is votable); participant removal (403 on every route); team wall and its Canvas toolbar; CSV, PNG and print view; persistence across a server restart.

**Known bugs (see `docs/DEMO.md`, "Known rough edges"):** the stage bar does not repaint after Start / Next until the page is reloaded (`retro` is missing from `BOARD_FIELDS` in `src/client/state.js`); Settings > Stages cannot be saved with whole-minute durations (`step="0.5"` in `src/ui/settings/StagesSection.jsx`).

**Not verified:** a real second browser as guest, a runtime capture of presence `sel` for anonymous notes, the Stages editor saving, drag reordering, real print preview, real touch, Safari/Firefox, a Vercel runtime, the 20-guest simulation re-run.

## Retro boards

Create a **Retro board** from the dashboard and pick a template: **Went Well / Could Be Improved / Blockers / Ideas**, **Start / Stop / Continue** or **Mad / Sad / Glad**. Each is a header line plus one column (a frame) per heading, laid out left to right. It is the same canvas as a workshop board (shared timer, throwable emoji, the access code and the optional passcode), driven by a **staged workflow**: Join, Collect feedback, Group, Vote, Review and discuss, Create actions, Wrap up. A new board starts in Join, not started; the owner presses **Start** and **Next stage** in the facilitator bar. Guests can only add notes in Collect, vote only in Vote (the per-person limit is chosen when the board is created), and add actions only in Create actions. The Settings drawer of such a board has a **Stages** section instead of separate Voting and Timer sections. A note's column is simply the frame whose area holds the middle of the note.

### AI summary (optional)

The owner can switch on **AI summaries** in the board's settings, and open **Summary** in the top bar to write one by hand or have a draft written.

- **Off until the owner turns it on.** The first time, the settings show what is sent and ask the owner to press "I understand"; the board then records when (`ai.ackAt`). Nothing is ever sent for a board where that has not happened. It can be switched off again at any time.
- **What is sent to Anthropic:** only the text of notes, text items, shapes with text and (on celebration boards) card messages, each trimmed to 300 characters, the title of the column each one sits in, the board title (not on celebration boards, where it carries the recipient's name) and the text of the top three voted items. At most 200 items go; the least voted, longest and oldest are dropped first, and the prompt says so.
- **What is not sent:** names, user or guest ids, avatars, e-mail addresses, card signers, the access code or passcode, the owner's identity, or anything else about people. The board text is passed to the model as untrusted data between delimiters with an instruction never to follow it; the answer is plain text and is only ever shown as text.
- **Drafts are private.** A generated summary is a *draft* that only the owner can see (it is never in the snapshot, the polling feed, the live broadcast or the reveal route that guests use). The owner edits it and presses **Share with everyone**; **Make private** takes it back. Guests then see it labelled "AI-generated" (and "edited by the owner" if it was changed).
- **Automatic summary.** With "Write a summary automatically when the board is closed", closing the board writes one draft in the background (Next `after()`, so closing is never slowed), once per closure. With "Share automatically" that automatic summary is shared at once, still labelled AI-generated; pressing Generate always makes a draft.
- **Limits:** 5 summaries per board per hour and 40 per owner per day (a request that never reached the provider, or that it rejected as misconfigured, is not counted; a timeout or an empty answer is). One summary is written at a time per board. Each provider call times out after 15 seconds and is retried once.
- **Logging:** the server logs one line per call with counts only (`status`, `kind`, number of items, milliseconds, token counts). The key, the board's text and the model's answer are never logged.

`scripts/ai-smoke.mjs` makes one real call with a few invented notes and prints the model, the outcome, the length, token counts and the first 120 characters (never the key): `ANTHROPIC_API_KEY=... node scripts/ai-smoke.mjs`. With `AI_FAKE=1` it exercises the same path with the development fake. No test calls the real API.

AI **theme suggestions** use the same consent and limits: the owner presses **Suggest themes** in the Themes panel, reviews the proposed groups and accepts, renames or dismisses them; nothing changes on the board until accepted, and notes are never edited.

## Celebration boards

Pick an occasion (birthday, promotion, farewell, work anniversary, welcome, new baby, congratulations, thank you) and name the recipient. Everyone with the board code adds **cards** with **Add a card**: a message (up to 500 characters), the name it is signed with, a colour, and an optional GIF (Giphy search, or paste an `https://` link) or photo. Cards land in a masonry grid and can still be dragged.

The owner's settings drawer has a **Celebration** section: the recipient's name, a reveal time (shown in your own time zone; clear it, or press **Reveal now**) and two links to copy. Send contributors the board link (`/b/<code>`) and keep the recipient link (`/b/<code>/reveal`) for the person being celebrated. Until the reveal time that page shows a countdown and receives no cards at all (the owner previews it); then it plays an intro with the occasion's effect, a slideshow of the cards (auto-advance with a Pause button, arrow keys, swipe; no auto-advance when the device asks for reduced motion) and an end screen that leads to a read-only view of the whole board. The code is still the board's only secret: anyone who holds it can open `/b/<code>` and see the cards early, so the countdown is a nicety that protects the surprise, not a security boundary: do not put anything on a celebration board that you would not want a code-holder to read before the reveal.

GIF search uses the Giphy React SDK when `NEXT_PUBLIC_GIPHY_API_KEY` is set (PG-13, English). It sends the search words to Giphy from the person's browser, and the SDK's result tiles report views and clicks (pingbacks, with a per-session id) to Giphy's analytics; the picker says so and shows "Powered by GIPHY". Only the chosen GIF's https address and size are stored on the card.

## Dependencies

The Giphy picker uses `@giphy/js-fetch-api` and `@giphy/react-components` (exact versions), which need `styled-components` as a peer (also pinned). `npm audit` reports 5 findings, all inside that tree and none reachable from this app: `js-cookie` (cookie-attribute injection in `assign()`) comes in through `react-use`, whose cookie hook the SDK and this app never call; `uuid` (missing bounds check) comes in through `@giphy/js-util` and only matters when a caller passes the `buf` argument, which nothing here does. The fixes need a breaking `npm audit fix --force`, which was deliberately not run; revisit when Giphy updates its packages.

## Environment

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` (default `retrospace`) | persistence |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | live sync, presence, rate limits |
| `RT_SECRET` (**required in production**) | signs board membership tokens and passcode access cookies; with `NODE_ENV=production` the app throws `RT_SECRET must be set in production` instead of falling back to a built-in secret, unless `UPSTASH_REDIS_REST_TOKEN` is set. Optional in development |
| `NEXT_PUBLIC_GIPHY_API_KEY` (optional) | GIF search through the Giphy React SDK (a public web SDK key, sent to the browser by design); without it, paste a GIF URL |
| `ANTHROPIC_API_KEY`, `AI_SUMMARY_MODEL` (optional) | AI-written summary drafts (server-side only, never sent to the browser; default model `claude-haiku-5-5`). Without a key the AI controls say "Not available on this server" and summaries are written by hand |
| `AI_FAKE=1` (development only) | a canned summary instead of a real call, so the summary screens can be tried without a key. Ignored when `NODE_ENV=production`; `AI_FAKE_DELAY_MS` changes its 1.2 s pause |
| `RT_STREAM_MAX_MS` (optional) | longest a single realtime (SSE) connection stays open, default `300000` (5 minutes), always capped by the 30-minute membership token; the client reconnects and is re-authorised each time |
| `NEXT_PUBLIC_SITE_URL` (optional) | share links |

When Mongo is missing, an in-memory store is used so `npm run dev` works with zero setup.

## Deployment notes

- **Run behind a proxy that sets the client IP.** Per-IP rate limits (login, register and others) read the client address from `x-vercel-forwarded-for`, then `x-real-ip`, then the first entry of `x-forwarded-for`. The platform or reverse proxy in front of the app must overwrite these headers; if the app is exposed directly, a client can send its own and sidestep every per-IP limit. The per-email failed-login limiter (10 failures per 15 minutes per address) does not depend on the IP and is the real brake on password guessing.
- **Configure Upstash Redis in production.** Without it, rate limits for login and register fall back to an in-process counter that is per server instance (not shared between serverless instances or restarts).
- **AI spend limits are approximate.** The AI summary limits (5 per board per hour, 40 per owner per day) are fixed windows, and without Redis they are counted per server process, so they bound spend only approximately (several instances or a restart each get a fresh count). One click costs at most 2 provider calls (one retry) of at most 600 output tokens each, and a failed call that may have been billed keeps its slot.
- Sessions are an `HttpOnly; SameSite=Lax` cookie, marked `Secure` when `NODE_ENV=production`, so serve the app over HTTPS.
- **Set `RT_SECRET` in production** (a long random value). It signs the realtime membership tokens (valid 30 minutes, refreshed by the client) and the board passcode cookies. Without it, or an Upstash token, a production server refuses to issue or check them rather than use a guessable secret. `npm start` therefore needs `RT_SECRET=...` in its environment.
- **Join limits are deliberately strict and fail closed.** Entering a board passcode is limited to 10 attempts a minute per IP, so a classroom of guests behind one NAT or proxy address can be throttled while they all join at once (they retry after the `Retry-After` interval). Separately, a board allows 30 wrong passcode guesses per 15 minutes in total; after that every guest, including ones with the right passcode, is locked out of joining that board for up to 15 minutes. A correct passcode does not use up a slot, but it also does not reset the count.
- **Code probing is metered per IP.** Board lookups and `/api/join/[code]` share one budget per address: 20 unknown-code misses a minute and 200 denials (unknown, passcode required, revoked) a minute, then 429 with `Retry-After`; successful reads are never counted. The budget is per address, not per person, so anyone behind the same IP (an office or school NAT) can spend the 20 unknown-code misses and make every guest on that address get 429 for the rest of that minute-long window. This is an accepted trade-off of the limiter. With Redis configured each guarded request also reads two small counters. The `/b/[code]` page itself does not look the code up; the client asks the metered API.
- Revoking a board or changing its passcode stops new reads at once. An already-open realtime stream is closed by the server after `RT_STREAM_MAX_MS` (default 5 minutes, and never past the connection's membership token); the client then reconnects, and every connect re-checks board access, so a revoked or re-passcoded guest is out within about 5 minutes (a guest polling `/since` is stopped at the next poll). A former guest's membership token also stops working for ephemeral messages (cursors) within 30 minutes. Set `RT_STREAM_MAX_MS` lower for a tighter window at the cost of more reconnects.

## Deploying

1. Node 20 or newer; `npm install && npm run build && npm start` (set `NEXT_PUBLIC_*` variables before the build, they are inlined).
2. Set `RT_SECRET` (required in production), `MONGODB_URI`, `MONGODB_DB`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_GIPHY_API_KEY`, `ANTHROPIC_API_KEY` (and `AI_SUMMARY_MODEL` if not the default), `NEXT_PUBLIC_SITE_URL`.
3. Allow the host's outbound IPs in the MongoDB Atlas network access list.
4. Serve over HTTPS behind a proxy that sets the client IP (see Deployment notes).
5. Smoke test: register, create a board, join it from a second browser as a guest. The demo script is in `docs/DEMO.md`.

## Ownership

© 2026 Jason Cabral, Partners with Veehk Corps. All rights reserved. See `LICENSE`.
