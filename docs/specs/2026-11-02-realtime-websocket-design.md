# Realtime over WebSocket, from a separate backend

Status: **website side built; the backend is its own project** (`retrospace-realtime`, a separate repository and deployment). Nothing changes for anyone
until that backend is running and `REALTIME_WS_URL` is set on the website.

## Why

Vercel's serverless functions cannot hold a WebSocket open. Live messages (cursors, selections, live drags, hello) therefore travelled as one web
request each (`/api/rt/send`, with rate-limit and publish commands on Upstash), and everything came back over a Server-Sent Events stream.

## The split

- **The website (this repository, on Vercel)** keeps everything it did: accounts, boards, saving, the database. It publishes "something changed" on the
  board's Upstash channel after a save, as before. New here: ``POST /api/rt/authorize`, the browser's WebSocket client, and `REALTIME_WS_URL`.
- **The realtime backend (`retrospace-realtime`, Express + `ws`)** holds the connections. It has **no database and no encryption keys**. It needs only
  `RT_SECRET` (the same as the website), the same Upstash database, and the website's address.

## How a person connects

1. The browser asks the website `POST /api/rt/join` (cookies; access checked: passcode, revoked link). The website answers with the **ticket**
   (`<exp>.<hmac>`, 30 minutes, for this person on this board) and, when `REALTIME_WS_URL` is set, the backend's address.
2. The browser opens `wss://backend/ws?code&uid&tok&cid`. The backend checks the origin, the ticket's HMAC and expiry.
3. The backend asks the website `POST /api/rt/authorize {code, uid}`, **signed** (`x-rt-ts`, `x-rt-sig` = HMAC-SHA256 of `rtauth:<ts>:<code>:<uid>`
   with `RT_SECRET`, valid for 60 s). The website answers with facts only: the person's stored name and avatar, whether they are the owner, whether
   the link is revoked, whether they were removed, whether the board is read-only, and the throw settings. Anything not signed gets the same `403`.
4. If the person may be there, the connection is kept for at most 270 s (and never past the ticket). It is then closed with code `4001` and the browser
   repeats from step 1, so a revoked link or a removal bites within that time.

## Messages

- **Browser → backend:** `{"t":"eph","msg":{…}}` for live messages with no answer needed (cursor, sel, drag, hello, typing). Celebrate and throw still go
  to the website's `/api/rt/send`, because the sender is told "slow down".
- **Backend → browser:** the same envelopes the plain stream carries (`ops`, `board`, `kicked`, `deleted`, `eph`), plus `{"t":"err","status","error"}`
  for a refused live message, which the browser ignores.
- **Between copies and from the website:** the Upstash channel `kb:<code>`. The backend delivers a live message to the room's other sockets at once and
  publishes it tagged with its own id so other copies deliver it and it does not deliver it twice.

## Kept in step by hand, pinned by tests on both sides

The ticket format, the authorize signature, and the rules for live messages (`src/lib/ephemeral.js` here; `src/rules.mjs` there).
`test/rt-authorize.test.mjs` here and `test/vectors.test.mjs` there hold the same two known-answer constants.

## Failure behaviour

If the backend is down, full, or refuses (origin, ticket, a website that cannot be asked), the browser falls back to the plain stream for the rest of
that page's life. Remove `REALTIME_WS_URL` and redeploy to send everybody back to the plain stream.
