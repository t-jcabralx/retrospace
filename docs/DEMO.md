# Retrospace demo script (10 to 12 minutes)

Written from three live end-to-end runs of a production build against real MongoDB Atlas, Upstash, Giphy and Anthropic. The last two (`.superpowers/sdd/2026-10-28-kudo-mural/task-20-e2e-report.md` and `task-20-e2e2-report.md`) cover everything below. **All four board types and every feature in the spec are built** (workshop canvas, celebration with reveal, retro with the staged workflow, anonymous notes, action cards, saved column templates, AI summary and AI theme suggestions, team wall, participant removal, CSV/PNG/print export). What is not built: password reset and email verification.

Do the demo on a laptop for the owner. A phone works as the **guest** device. A phone as the owner is usable at 375px since the top bar fix, but the Retro stage bar and panels take most of the screen, so do not present from it.

**Two bugs found in the last run that you must know about before presenting** (details under "Known rough edges"):

1. The stage bar does not repaint after **Start**, **Next stage** or **Back**: the server moves on, but the owner's (and guests') screen keeps showing the old stage until the page is **reloaded**. Reload after every stage change until this is fixed (the cause is `retro` missing from `BOARD_FIELDS` in `src/client/state.js`; the timer does update, which is misleading).
2. **Settings > Stages cannot be saved** with whole-minute durations (the minutes boxes use `step="0.5"` from a minimum of `0.17`, so the browser refuses to submit). Do not demo the Stages editor until this is fixed.

## Prerequisites

- A laptop for the presenter (the owner) and a phone or second browser profile for the guest. Both need to reach the host.
- The app deployed (or `npm run build && npm start`) with the variables in "Pre-flight checklist". Create the demo boards **on the deployed site**, not on localhost.
- Pre-create (do this 10 minutes before):
  1. An owner account (email + password), so sign-up on stage is optional.
  2. One **Celebration** board (Birthday, recipient "Maria") with 4 to 5 cards, including one Giphy GIF (use a GIF, not a photo upload) and a reveal time you set 1 to 2 minutes ahead on stage.
  3. One **Retro** board for the live flow: you create it on stage (step 7), so only decide the columns and keep the default 3 votes per person. If you want a pre-filled backup, make a second Retro board and add about 10 notes, **but remember a new Retro board starts in the Join stage and is not started**: guests can only add notes in the Collect stage, so move that backup board to Collect first (Start, Next stage, reload).
- A second device is ideal. A second browser window in a private session also works (separate cookies = a separate guest).
- Turn on AI for the Retro board **only after** the Anthropic spend limit is set (see checklist). Each summary or theme suggestion costs a few cents at most.

## Walkthrough

| # | Minutes | Do this | Say this | Expect |
|---|---|---|---|---|
| 1 | 0:00 | Open the landing page. Scroll slowly: hero, Join box, four board types, features. | "Retrospectives, workshops and celebrations. Guests join with a 6-character code and no account." | Four board types (Workshop, Celebration, Retro, Team wall). Works in light and dark. |
| 2 | 0:45 | Click **Get started**, register (name, email, password). | "The owner has an account; everyone else is anonymous." | Lands on an empty "Your boards" dashboard. |
| 3 | 1:15 | **New board** > Celebration > Birthday > recipient "Maria" > Create. | "Eight occasions. The title is built from the recipient." | Board opens with the headline and an **Add a card** button. |
| 4 | 2:00 | **Add a card**: type a message, pick a colour, **Add a GIF**, search "birthday", arrow keys + Enter, Post. | "Real Giphy search, keyboard friendly, 'Powered by GIPHY' shown." | GIF preview, then the card appears. |
| 5 | 3:00 | Open Settings (gear). Show the **access code** and link; mention passcode, lock, close and revoke (do not toggle revoke on stage). | "One code, optionally a passcode. The owner can close or revoke at any time." | Share panel with code, link, Share by email. |
| 6 | 3:30 | On the phone: open the landing page, type the code in lower case, **Join**. Choose "Stay anonymous", press **Shuffle**, **Join as ...** and add a card. | "Guests get a generated name and avatar, or pick their own." | The owner screen shows the guest in the presence cluster, their cursor with a name chip, and the card arriving live. |
| 7 | 4:30 | **New board** > Retro > pick a template > on the **Columns** step rename a column, remove one, reorder with the arrows, add one (optionally **Save template**, then reuse it from "My templates") > next step: title and **Votes per person** (3 by default; this is where the vote limit is set) > Create. | "Columns are yours: rename, reorder, add, remove, and save the set as a template. Votes per person is decided up front." | The board opens in the **Join** stage with a frame per column in your order. The stage bar reads "STEP 1 OF 7 Join, Not started" with a **Start** button. |
| 8 | 5:30 | Guest joins this board (as in step 6) and tries to add a note: **refused** ("This stage is closed for notes"). Owner presses **Start** (Join gets its 1 minute clock), then **Next stage** to **Collect feedback**. **Reload the owner page** (known bug 1). Guest adds a note: accepted. | "The facilitator drives the retro: Join, Collect, Group, Vote, Review, Actions, Wrap up. Notes only open when it is time." | Shared timer per stage (5 minutes for Collect). Owner and guest can both add notes in Collect. **Lock notes** / **Reopen notes** toggles it. |
| 9 | 6:15 | Guest toggles **Post anonymously** and adds a note. Owner opens **Export > CSV** with author names. | "An anonymous note hides its author from everyone, including me." | The card shows an Anonymous badge on every screen; the CSV author column says Anonymous. Optionally Settings > **Anonymous notes** > Always so the owner's notes are anonymous too. |
| 10 | 7:00 | **Next stage** (Group: the guest's tools are disabled, only the facilitator organises), **Next stage** to **Vote** (reload): each person votes with the vote button on a note; the limit is the creation value (3). **Next stage** to **Review and discuss**: the top topics are listed, mark one Discussed and add a note. **Next stage** to **Create actions**: add an action card with an owner and a due date (and one without, to show the flags). | "Voting only exists in the Vote stage; the ranking drives the discussion; actions get an owner and a date." | "You have 3 of 3 votes left", then a refusal on the fourth vote; "Voting is not open" outside Vote; action cards flag **Needs owner** and **Needs due date**; the owner may exceed the action limit, guests are stopped at the maximum. |
| 11 | 8:00 | **AI** (only if you rehearsed it): Settings > AI summaries > on > **I understand** (the notice says notes are sent to Anthropic for summaries and suggested themes). Open **Summary** > **Generate** (about 5 seconds). Then **Themes** > **Suggest themes** > **Accept** one. | "A draft only I can see; guests see it only after I share it. Suggested themes are proposals, never edits." | A labelled AI draft (about 700 characters, structured as went well / improve / ideas / takeaways). **Share with everyone** asks to confirm, then guests see it. An accepted theme appears as a theme card that can be voted on in the Vote stage. |
| 12 | 9:00 | **New board** > Team wall. Settings > add people (give one a birthday of today). **Give a shout-out** from the owner and the guest, react with an emoji, toggle Feed / Canvas. | "A long-lived wall of shout-outs with birthdays and anniversaries." | Banner "Happy birthday ..." and the shout-outs; guests never receive birthdays or start dates. The Canvas view offers only Select, Sticky note and Text. |
| 13 | 10:00 | Retro board > Settings > People: **Remove** the guest (optionally tick "Also delete their notes"). Export **PNG** and open **Print / Save as PDF**. | "Removed guests are locked out; their notes can stay (and anonymous ones always stay)." | The guest's next request is refused (403 "You were removed from this board"); a removed browser sees "You were removed from this board". A PNG downloads; the print view lists the notes by column. |
| 14 | 10:45 | Top bar clock: **1 min** timer, then **+1 min**. Optionally Settings > Throw emoji > Allow throwing; the guest throws a banana. | "A shared timer everyone sees the same." | Countdown on both devices. |
| 15 | 11:15 | Back to the Celebration board > Settings > Celebration: set the reveal time 1 to 2 minutes ahead, **Save time**. Open the **recipient link** (`/b/<code>/reveal`) on the phone in a window that is not the owner. | "Maria sees only a countdown until the reveal." | Countdown with no card text. At zero it moves to the intro, then the slideshow (about 8 s per card, Pause, arrow keys, "Card n of m"). |

Timing hints: steps 1 to 6 take about 4 minutes if the account and boards are ready. Steps 11, 14 and 15 are the easiest to drop. Set the reveal to 60 to 90 seconds and talk through the security model while it counts down.

## If something goes wrong

| Symptom | Quick recovery |
|---|---|
| The stage bar still shows the previous stage after Start / Next | Known bug: reload the page (owner and guests). The server state is right. |
| Settings > Stages "Save stages" does nothing | Known bug (whole minutes rejected by the browser). Skip it; use the stage bar's **+1 min** instead. |
| "Couldn't load this page" on the reveal page or board | Reload after 30 seconds. The per-IP probing limiter can return 429 for a shared address; close extra tabs and wait one minute. |
| Presenter and guest on the same machine do not look like two people | Use a private window or a second browser profile for the guest (cookies are per browser). |
| Cursors or presence missing | Upstash is not configured or unreachable; the app falls back to polling every few seconds (no cursors). Check the Upstash REST URL/token. |
| Giphy tiles are grey boxes | Wait 3 to 5 seconds; if still empty, paste a `https://...giphy.gif` link into "Or paste a GIF link". |
| "Choose a name first" when a guest tries to add something | They skipped the persona chooser; reload and pick one. |
| Wrong passcode loop | Passcode attempts are limited (10 a minute per IP). Wait a minute. |
| AI controls say "Not available on this server" | `ANTHROPIC_API_KEY` is missing on the host. Skip the AI step. |
| Summary or themes fail | Retry once; the app times out at 15 seconds. Otherwise write the summary by hand ("Write manually"). |
| Board shows "Syncing" forever | Server cannot reach MongoDB: check the Atlas network access allowlist for the host's IP. |
| Typing in a new note seems to do nothing | Press Escape cancels an edit. Type, then click empty canvas to commit. |

## What was verified live (final run) and what was not

**Verified live in a browser or through the real API** (production build, real Mongo, Upstash, Giphy, Anthropic): sign-up; New board dialog with the Columns step (keyboard-only rename, move, remove, add all work, focus moves sensibly); saved column templates (save, reuse from "My templates", delete with confirm); the 375px Retro top bar (no overflow, Settings gear and Summary reachable); the whole staged Retro (Join refuses guest notes, Collect accepts them for guest and owner, Group closed to guest notes, Vote with the creation-time limit and a refused extra vote, Discuss panel with topics and statuses, Actions with Needs owner / Needs due date flags and the action maximum, stage jumping); Settings drawer on a staged board (no standalone Voting or Timer section, a Stages section, Esc closes it and focus returns to the gear, Tab stays inside); anonymous notes (guest, owner; no author name, avatar or id in snapshot or `since` JSON for either; CSV with authors says Anonymous); real AI summary (private draft, absent from guest JSON, then shared and visible to the guest); real AI theme suggestions (3 sensible themes, one accepted, then votable); participant removal from the UI (guest then gets 403 on reads, ops and realtime send); team wall Canvas toolbar limited to Select, Sticky note, Text; persistence across a server restart (stage, notes, votes, summary, themes, AI settings, owner session).

**Not verified** (or only partly): a real second browser as the guest (the guest was a scripted client, so the guest-side tooltip on disabled tools in Group was not seen); whether the app's own client ever emits a presence `sel` for an anonymous note at runtime (the code filters it, but a network capture was inconclusive); the owner's notes becoming anonymous in "Always" mode through the UI (the server only forces it for guests, the client sets it for the owner); the Settings > Stages editor saving (blocked by a bug); drag reordering of columns; a real print preview; real touch; Safari and Firefox; a Vercel runtime; the 20-guest simulation re-run.

## Known rough edges

- **Major: stage changes do not repaint the stage bar** for the owner or guests until a reload (`BOARD_FIELDS` in `src/client/state.js` has no `retro`, so the `board` action drops it; the same list also lacks `anonymousNotes`).
- **Major: Settings > Stages cannot be saved** with whole minutes (`step="0.5"` with `min="0.17"` in `src/ui/settings/StagesSection.jsx`).
- Minor: the new-column title in the Columns editor is focused with "Column 4" not selected, so typing appends to it.
- Minor: in Vote, the header text item is votable like a note.
- Minor: on a participant card the note count leaves out anonymous notes ("4 notes" for five items).
- Minor: a remote client that sends a presence `sel` for an anonymous note (only a hand-made client can) shows its own name tag on it; this does not reveal the author.
- The print view and PNG leave out action cards. The CSV file name uses the UTC date, the PNG the local date.
- Console shows repeated "preloaded CSS not used" warnings; no errors.
- The facilitator bar, stage header and Discuss panel take most of the screen on a phone.

## Accepted limits to state honestly if asked

- The board code is the only secret: anyone with it can open the board and see celebration cards **before the reveal**. The countdown protects the surprise from the recipient's page, not from a code holder.
- Rate limits are fixed windows; guests behind one address share the join and probing limits. Without Upstash the counters are per server process and realtime falls back to polling.
- A live cursor resting near an anonymous note is not hidden; it is a weak signal.
- Removing a participant leaves their anonymous notes (they cannot be attributed); other notes are kept unless you tick "Also delete their notes".
- Revoke and passcode changes reach guests with an open connection within about 5 minutes.
- AI summaries and theme suggestions cost a few cents each (small model, one retry at most); the limits (5 per board per hour, 40 per owner per day) are per process without Redis.
- The Giphy key is a tier-limited web key; heavy use can hit its rate limit (grey tiles; paste a GIF link instead).
- "See the whole board" in the recipient view is read-only in the UI only; anyone with the code can write through the normal join flow.

## Do NOT demo

- The **Stages editor** (cannot save until fixed) and anything that relies on the stage bar repainting by itself.
- **Revoke and passcode changes on a board with guests already connected.**
- **Photo uploads** (large); use GIF links.
- **Real touch gestures**, **Safari/Firefox**, **password reset**, **email verification**.

## Pre-flight checklist (one page)

Vercel (or any Node host) environment:

- [ ] `RT_SECRET`: required, long random value (production refuses to run without it unless an Upstash token is set).
- [ ] `MONGODB_URI` and `MONGODB_DB`; the Atlas **network access allowlist** includes the host's outbound IPs (or 0.0.0.0/0 for Vercel).
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (live cursors, presence, shared limits).
- [ ] `ANTHROPIC_API_KEY`, and `AI_SUMMARY_MODEL` if you do not want the default (`claude-haiku-5-5`). Set an **Anthropic spend limit** on the key.
- [ ] `NEXT_PUBLIC_GIPHY_API_KEY` set **before the build** (it is inlined at build time).
- [ ] `NEXT_PUBLIC_SITE_URL` set to the public URL so share links are right (also build time).

Platform:

- [ ] Fluid compute (long-lived realtime streams) enabled; function region, MongoDB Atlas cluster and Upstash database are all in **the same region**.
- [ ] Served over HTTPS behind a proxy that sets the client IP header (`x-vercel-forwarded-for` on Vercel).
- [ ] Node 20 or newer (verified on v24).

Content and rehearsal (do this the day before and again 15 minutes before):

- [ ] Create the demo boards **on the deployed site**, not on localhost.
- [ ] Use **GIF links**, not photo uploads, on the Celebration board.
- [ ] Register, create a Retro board, join it from a phone, and see the guest appear.
- [ ] Rehearse the **Retro + AI flow once** end to end (Start, Collect, Vote, Discuss, Actions, Summary, Themes), including the reload after each stage change while bug 1 is open.
- [ ] Have a backup: a second browser profile signed in as the owner, and the recorded run of this script.
