# Event board and Spin to win: design

Amendment F to `2026-10-28-kudo-mural-design.md`. Status: **approved** (storage choice added 2026-10-29, see below).

## Goal

A new board type, **Event**, whose main screen is a two-ring prize wheel for raffles and give-aways at team events. The outer ring holds the participants, the inner ring the prizes. The host spins in two steps (prize, then winner) and everybody watches the same spin live. Guests still join with the board code, no account needed.

## Decisions (from the owner)

| Question | Decision |
|---|---|
| How does a spin work? | **Two steps.** Step 1 spins the inner ring and picks the prize. Step 2 spins the outer ring and picks who wins it. |
| Where does it live? | A **new board type, Event**. Its screen is the wheel, not the free canvas. |
| Who can spin? | The **owner plus helpers the owner names**. Everyone else watches. |
| Where is it stored? | The owner chooses at creation: **our server** (shareable, live) or **this device only** (private, nothing kept by us). |

## Storage: our server or this device only

When creating an Event board the owner chooses where it lives:

| | On our server (default) | Only on this device |
|---|---|---|
| Who sees it | Everyone with the code, live | Only whoever has this browser open (the host, on a projector) |
| What we keep | The board, names, prizes, history | **Nothing.** No account, no database record, no network call for the wheel |
| Who picks the winner | The server (`crypto.randomInt`) | The browser (`crypto.getRandomValues`), shown to the room by the host |
| Survives closing the tab | Yes | Yes, in this browser's local storage, until the person clears it |
| Helpers and guest watching | Yes | No (one screen). A JSON export and import moves it to another device |

The same pure wheel module and the same screens run in both modes; only the place the state is read from and written to differs. A device-only board needs no sign-in, is listed on the dashboard under "Only on this device", and says so plainly on screen ("Nothing here is saved on our servers"). Clearing browser data deletes it, so the screen offers a backup export. Live shared boards that keep nothing on the server (a relay-only room, or end-to-end encryption) are possible later but are a separate project.

## The round (state machine)

```
idle ──spin prize──▶ prizeChosen ──spin winner──▶ winnerChosen ──accept──▶ idle
                          │                            │ ├──skip (no-show)──▶ prizeChosen (that person sits out this round)
                          └──────── back ──────────────┘ └──undo──────────▶ idle (round cancelled)
```

- **Accept** records the result in the history, lowers the prize quantity by one (a prize at zero leaves the wheel) and, if "remove winners" is on (the default), takes the winner off the outer ring.
- **Skip** is for someone who is not there: they sit out this round only; the winner is spun again, the prize stays.
- **Undo last result** (after Accept) puts the winner and the prize back and removes the history line.

## Fairness and realtime

- The server chooses every result with `crypto.randomInt`; the browser only plays it. Nobody's screen decides anything.
- A spin is a durable record `{ id, step, index, startAt (server time), durationMs }` on the board plus a realtime message. Every client turns its ring to the same angle at the same moment (using the server clock offset the app already keeps). A client that opens the board mid-spin or after it sees the right state; the history is saved.
- Two helpers pressing Spin at once cannot start two spins: the route only starts a spin from the expected state (compare-and-set on the board revision).
- Participants and prizes are public to everyone on the board (they are shown on the wheel). Joined participants appear under the name they chose.

## What the owner sets up

- **Participants** (outer ring): add one by one, paste a list (one per line; blank lines and exact duplicates are ignored, with a notice), or **Add everyone who joined** (re-run any time; people already on the wheel are not doubled). Each can be switched in or out. Limit 200.
- **Prizes** (inner ring): name, emoji, quantity (1 to 99), colour. Limit 30 distinct prizes.
- **Helpers:** pick from the people who have joined; a helper can run the round (Spin, Accept, Skip, Undo) but not change the setup or the helper list.
- **Rules:** remove winners after accepting (default on).

## Screens and flow

1. **Setup** (owner): two lists with live wheel preview; "Start the draw" opens Spin.
2. **Spin** (everyone): the wheel centred, a pointer at the top, a step bar "1 Pick the prize, 2 Pick the winner". During step 1 only the inner ring turns and the outer ring is dimmed; in step 2 the chosen prize is shown in the hub and only the outer ring turns. Owner and helpers get one large button for the next step (Space also works); everyone else sees "Waiting for the host".
3. **Result moment:** confetti, a large card "Maria wins Gift card", and for host and helpers Accept, Skip (not here), Undo.
4. **History:** a list on the side (Present mode: a drawer), newest first, with CSV export. The owner can clear it.
5. **Present mode:** a bigger wheel for a projector (a CSS layout, not the browser's fullscreen API).

Large lists: above 24 participants the labels become initials with the full name in the side list and on hover/focus, so the ring stays readable.

## Accessibility and low power

- With reduced motion on, nothing spins: the chosen item is highlighted and the result appears.
- Each result is announced in a polite live region; the wheel has a text alternative (the lists); every control is reachable by keyboard.
- Contrast follows the existing tokens, in light and dark.

## Data and API

- `board.type = 'event'` (no canvas items; `ALLOWED_KINDS.event = []`). Board create offers Event with a "Raffle day" template (empty lists).
- `board.wheel = { participants[], prizes[], helpers[], rules, round, history[] }`, all validated server-side. `round = { state, prizeId, winnerId, skipped[], spin }`. History is capped at 500 lines.
- `PATCH /api/boards/[code]` with `{ patch: { wheel: ... } }`: owner only, setup fields only.
- `POST /api/boards/[code]/wheel` with `{ action: 'spin' | 'accept' | 'skip' | 'undo' }`: owner or a named helper; rate limited; returns the new round.
- Realtime: the existing `board` message carries the new `wheel`; a `spin` envelope carries the animation data.
- `GET .../export?format=csv` gains the wheel history for Event boards.

## Not in the first version

Weighted odds, per-prize eligibility, sound, team splitting, self-registration by QR code. Easy to add later because the round and the history are explicit.

## Testing

Pure wheel module (state machine, fairness of the pick, quantities, undo) with unit tests; route tests for the permissions (guest, helper, owner), the compare-and-set and the validation; render tests for the screens; a two-client simulation script against live Upstash; and a check in two real browsers.
