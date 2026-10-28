# Retrospace demo script (10 to 12 minutes)

Written from two live end-to-end runs of a production build against real MongoDB Atlas, Upstash and Giphy; the second (`.superpowers/sdd/2026-10-28-kudo-mural/task-20-e2e-report.md`) covered the retro workflow, anonymous notes, team wall, removal, exports and restart persistence. **The AI features (summary and theme suggestions) did not work against the real API in that run** (see "Known rough edges"), so do not demo them until that is fixed. Do the demo on a laptop, not a phone: the Retro board's top bar overflows at phone width.

## Prerequisites

- A laptop for the presenter (the owner) and a phone or second browser profile for the guest. Both need to reach the host.
- The app running with `npm run build && npm start` and the environment variables listed in "Pre-flight checklist".
- Pre-create (do this 10 minutes before):
  1. An owner account (email + password) so sign-up on stage is optional; keep the sign-up for the live part if you have a clean email.
  2. One **Celebration** board (Birthday, recipient "Maria") with 4 to 5 cards already on it, including one Giphy GIF and one photo, and a reveal time you will set to 1 to 2 minutes ahead on stage.
  3. One **Retro** board (Went Well / Could Be Improved / Blockers / Ideas) with about 10 notes spread over the columns (leave AI off, see "Do NOT demo").
- A second device is ideal. A second browser window in a private session also works (separate cookies = a separate guest).

## Walkthrough

| # | Minutes | Do this | Say this | Expect |
|---|---|---|---|---|
| 1 | 0:00 | Open the landing page. Scroll slowly: hero, Join box, four board types, features. | "Retrospectives, workshops and celebrations. Guests join with a 6-character code and no account." | Four board types (Workshop, Celebration, Retro, Team wall). Works in light and dark. |
| 2 | 0:45 | Click **Get started**, register (name, email, password). | "The owner has an account; everyone else is anonymous." | Lands on an empty "Your boards" dashboard. |
| 3 | 1:15 | **New board** > Celebration > Birthday > recipient "Maria" > Create. | "Eight occasions. The title is built from the recipient." | Board opens with the headline and an **Add a card** button. |
| 4 | 2:00 | **Add a card**: type a message, pick a colour, **Add a GIF**, search "birthday", arrow keys + Enter, Post. | "Real Giphy search, keyboard friendly, 'Powered by GIPHY' shown." | GIF preview, then the card appears. |
| 5 | 3:00 | Open Settings (gear). Show the **access code** and link; mention passcode, lock, close and revoke (do not toggle revoke on stage). | "One code, optionally a passcode. The owner can close or revoke at any time." | Share panel with code, link, Share by email. |
| 6 | 3:30 | On the phone: open the landing page, type the code in lower case, **Join**. Choose "Stay anonymous", press **Shuffle**, **Join as ...** and add a card. | "Guests get a generated name and avatar, or pick their own." | The owner screen shows the guest in the presence cluster, their cursor with a name chip, and the card arriving live. |
| 7 | 4:30 | **New board** > Retro > pick a template > on the **Columns** step rename a column, remove one, reorder with the arrows, add one, then Create. | "Columns are yours: rename, reorder, add, remove. You can also save the set as a template." | The board opens with a frame per column in the order you chose. Pick the emoji with the keyboard-friendly picker (re-check on your machine: a pick did not apply in testing). |
| 8 | 5:30 | On the Retro board: the stage header and facilitator bar. **Start**, then **Next stage** into **Collect**. The guest tries to add a note in Join (refused) and in Collect (accepted). | "The facilitator drives the retro: Join, Collect, Group, Vote, Review, Actions, Wrap up. Notes only open when it is time." | Shared timer per stage, "This stage is closed for notes" for guests outside Collect. |
| 9 | 6:15 | Guest toggles **Post anonymously** and adds a note. Owner opens the board's export > **CSV** with author names. | "An anonymous note hides its author from everyone, including me." | The card shows an Anonymous badge on every screen; the CSV author column says Anonymous. |
| 10 | 7:00 | **Next stage** to **Vote**: each person votes (3 each). **Next stage** to **Review and discuss**: ranked results, mark a topic Discussed. Then **Create actions**: add an action card with an owner and a due date. | "Voting only exists in the Vote stage; the ranking drives the discussion; actions get an owner and a date." | Counts live; "Voting is not open" afterwards; action cards flag a missing owner or date. |
| 11 | 8:15 | **New board** > Team wall. Settings > add people (give one a birthday of today). **Give a shout-out** from the owner and the guest, react with an emoji, toggle Feed / Canvas. | "A long-lived wall of shout-outs with birthdays and anniversaries." | Banner "Happy birthday ..." and the shout-outs; guests never receive birthdays or start dates. |
| 12 | 9:15 | Retro board > Settings > participants: **Remove** the guest. Then export **PNG** and open **Print / Save as PDF**. | "Removed guests are locked out; their notes can stay. Exports for the minutes." | The guest's next request is refused ("You were removed from this board"). A PNG downloads; the print view lists the notes by column. |
| 13 | 10:00 | Top bar clock: **1 min** timer, then **+1 min**. | "A shared timer everyone sees the same." | Countdown on both devices. Press Stop. |
| 14 | 10:30 | Settings > Throw emoji > Allow throwing. Guest taps the banana in the tray and clicks a note. | "Throw a banana at an idea." | Banana flies in with the thrower's name on the owner's screen. |
| 15 | 11:00 | Back to the Celebration board > Settings > Celebration: set the reveal time 1 to 2 minutes ahead, **Save time**. Open the **recipient link** (`/b/<code>/reveal`) on the phone in a window that is not the owner. | "Maria sees only a countdown until the reveal." | Countdown with no card text. At zero it moves to the intro (cake, balloons), then the slideshow: auto-advance (about 8 s per card), Pause, arrow keys, "Card n of m", see the whole board. |

Timing hints: steps 1 to 6 take about 4 minutes if the account and boards are ready; the reveal countdown (step 15) is the longest dead time, so set it to about 60 to 90 seconds and talk through the security model while it counts down. Steps 13 and 14 are the easiest to drop if you are over time. There is deliberately no AI step (see below).

## If something goes wrong

| Symptom | Quick recovery |
|---|---|
| "Couldn't load this page" on the reveal page or board | Reload after 30 seconds. Cause seen in testing: the per-IP probing limiter returned 429 for a shared address. On a shared Wi-Fi or one laptop with many tabs, close extra tabs and wait one minute. |
| Presenter and guest on the same machine do not look like two people | Use a private window or a second browser profile for the guest (cookies are per browser). |
| Cursors or presence missing | Upstash is not configured or unreachable; the app falls back to polling every few seconds (no cursors). Check the Upstash REST URL/token. |
| Giphy tiles are grey boxes | Wait 3 to 5 seconds; if still empty, paste a `https://...giphy.gif` link into "Or paste a GIF link". |
| "Choose a name first" when a guest tries to add something | They skipped the persona chooser; reload and pick one. |
| Wrong passcode loop | Passcode attempts are limited (10 a minute per IP). Wait a minute. |
| AI controls say "Not available on this server" | `ANTHROPIC_API_KEY` is missing on the host. Skip the AI step. |
| Board shows "Syncing" forever | Server cannot reach MongoDB: check the Atlas network access allowlist for the host's IP. |
| Typing in a new note seems to do nothing | Press Escape cancels an edit. Type, then click empty canvas to commit. |

## Do NOT demo

- **AI summary and AI theme suggestions**: against the real API "Suggest themes" failed with "The AI did not write anything" (the model produced output, the app did not read it; probable cause in `src/lib/ai/anthropic.js`), and the summary was not run. Fix and re-verify first.
- **A phone as the owner device**: on a Retro board the top bar overflows at 375px and the Settings gear cannot be tapped.
- **Revoke and passcode changes on a board with guests already connected**: they take effect on the next connection or poll, up to 5 minutes for open streams.
- **The "See the whole board" view as a security feature**: it is a UI-only read-only mode; anyone holding the code can write through the normal join flow.
- **Real touch gestures**, **Safari/Firefox**, **password reset**, **email verification**: not built or not tested.
- Settings > **Stages** editor, saved column templates and drag reordering: not exercised in the final run.

## Known rough edges (from the final end-to-end run)

- AI theme suggestions fail against the real API (Major); AI summary unproven.
- Retro top bar overflows at 375px and the Settings gear is off-screen (Major).
- Columns editor: the emoji popover is clipped at the drawer's left edge and an emoji pick did not change the column title in testing (re-test by hand).
- The print view and PNG leave out action cards.
- CSV file name uses the UTC date, the PNG the local date.
- A state change you make from a second tab of the same account only shows up in the first tab after a reload.
- Console shows repeated "preloaded CSS not used" warnings.
- On a phone the stage header, facilitator bar and Discuss panel take most of the screen height.

## Accepted limits to state honestly if asked

- The board code is the only secret: anyone with it can open the board and see celebration cards **before the reveal**. The countdown protects the surprise from the recipient's page, not from a code holder.
- Rate limits are fixed windows. Without Upstash they are per server process and the realtime layer falls back to polling.
- Guests behind one address share the join and probing limits.

## Not verified in the final run

AI summary (draft private to the owner, share) and a working AI theme suggestion, the Stages editor, a real keyboard-only pass, the kicked-participant screen and the delete-items option in the UI, saved templates, drag reorder, a real print preview, a second physical device, real touch, Safari/Firefox, a Vercel runtime, and a repeat of the 20-guest simulation. Verified live: staged retro, anonymous notes, team wall, participant removal (API), CSV/PNG/print, headers, restart persistence.

## Pre-flight checklist

- [ ] Node 20 or newer (verified on v24). `npm install && npm run build && npm start`.
- [ ] `RT_SECRET` set (required in production, long random value).
- [ ] `MONGODB_URI` and `MONGODB_DB` set; the Atlas **network access allowlist** includes the host's outbound IPs.
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set (live cursors, presence, shared limits).
- [ ] `NEXT_PUBLIC_GIPHY_API_KEY` set **before the build** (it is inlined at build time).
- [ ] `ANTHROPIC_API_KEY` set; `AI_SUMMARY_MODEL` if you do not want the default (`claude-haiku-5-5`).
- [ ] `NEXT_PUBLIC_SITE_URL` set to the public URL so share links are right (also needed at build time).
- [ ] Served over HTTPS behind a proxy that sets the client IP header.
- [ ] Open the landing page, register, create a board, join it from a phone, and see the guest appear. Do this 15 minutes before you present.
