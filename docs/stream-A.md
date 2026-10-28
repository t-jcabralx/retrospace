# Hardening notes (Task 20)

What changed after the final whole-project review, and the wording the README and the spec should pick up. (The README
itself is untouched by this stream; the merger can paste from here.)

## Behaviour now

| Area | Rule |
|---|---|
| Item kinds | The server only accepts the kinds a board type can draw: workshop `note,text,shape,connector,frame,image`; retro the same plus `action,theme,topic`; celebration the same plus `card`; wall `shoutout,note,text`. Anything else is rejected per op ("A shoutout can't be added to this board"). `ItemView` skips a kind it cannot draw, and a React error boundary (plus `app/error.js`) replaces a white screen with a panel. |
| Pictures | Image `src` <= 400 KB, card photo <= 200 KB, GIF link <= 4 KB; `src` must be a `data:image/` or `https:` URL. Clients aim lower (workshop 1200 px / 250 KB, card photo 600 px / 120 KB). A board holds at most 3 MB of data URLs; the add or update that would pass it is refused ("This board has reached its picture limit"). |
| Storage | A deleted item keeps only its id, geometry and stamps (data, votes, reactions are cleared). A board holds at most 4000 documents (live + deleted) and 2000 live items. |
| Broadcasts | An `ops` envelope for a move, vote or reaction omits the heavy data fields and carries `slim: true`; clients merge it into the item they hold (and ignore it for an item they do not hold; the next poll fetches it whole). Adds and picture replacements go out whole. |
| Deleted boards | `DELETE` publishes `{t:'deleted'}`. A 404 from `/since` or `/api/rt/join` is terminal on the client ("Board not found"), no more polling. |
| Limits | ops: 300/min per participant (board public id), 3000/min per address. rt/join: 300/min per participant, 600/min per address. Persona: 300 PUT/min per address, 100 new participants/min per board. A 429 from rt/join makes the client poll meanwhile and retry the stream after Retry-After. Body caps: 16 KB default, 4 KB for rt/join, rt/send and persona, 256 KB for `people`, 1.5 MB for ops. |
| Secrets | In production `RT_SECRET` is required (no fallback to the Upstash token). Changing it orphans every stored identity: guests become new people, owners are asked to choose a persona again and the names they used stay taken. |
| AI | Besides the per-board (5/h) and per-owner (40/day) limits there is a global cap, `AI_DAILY_CAP` (default 300 a day). Also set a monthly spend limit in the Anthropic console. |
| Stream | Default connection lifetime 270 s (below Vercel's 300 s). |
| Headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `Permissions-Policy` (camera, microphone, geolocation, payment off). No full CSP yet. |
| Other | `package.json` engines `node >= 22`; unique index on `users.id`; password hashes use scrypt N = 2^15 (older hashes keep their own N); `/since` is asked from `lastSeen - 2000`; the board snapshot sends the people list to the owner only; the reveal page polls through one self-rescheduling loop (`ui/revealPoller.js`), so repeated visibility changes cannot multiply it. |

## README and spec wording to fix

- README "What is not sent" (AI): replace with: *The text of notes and cards is sent. Participant names, avatars, ids, e-mail addresses, the access code and the owner's identity are not, but anything people type into a note or card may itself contain names.* The in-app notice already says this.
- README `NEXT_PUBLIC_SITE_URL`: it only feeds `metadataBase` (page metadata); share links use the address the page is opened at.
- README / `.env.example`: `RT_SECRET` is mandatory in production and effectively permanent (see above). `RT_STREAM_MAX_MS` defaults to 270000. New optional `AI_DAILY_CAP`.
- Landing: "Hold the cards back" became "Reveal everything at once on the recipient page". The recipient link contains the board code, so cards are readable by anyone with it before the reveal time only through the board itself; a separate recipient token is deferred.
- Spec A2: the passcode access cookie is not bound to a guest uid (it is an HMAC of the code and the passcode hash). Spec: a deleted board's code can be reused. `/api/rt/send` authorizes by the signed membership token alone (30 minute life). Spec section 3: the guest uid lives in the signed `rs_g` cookie, not in localStorage. Spec A4 lists a team wall and export that are not in this build (the wall comes with its own stream). Spec D2: automatic celebration summaries are not built.
- Accepted and worth stating: vote lists are attributable to personas; the owner's account name is visible to guests; `?view=1` is a UI-only read-only mode.
