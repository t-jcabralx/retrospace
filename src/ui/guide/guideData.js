// The words of the guide page, kept apart from the markup. Everything here describes what the app does today.

export const TOC = [
  ['start', 'Start here'],
  ['owner', 'If you create boards'],
  ['guest', 'If you join a board'],
  ['board', 'Working on a board'],
  ['stages', 'The Retro stages'],
  ['wheel', 'Prize wheel'],
  ['anonymous', 'Anonymous notes'],
  ['ai', 'AI summary'],
  ['help', 'Problems'],
]

export const BOARD_TYPES = [
  ['Workshop', 'Brainstorms and planning on a free canvas: sticky notes, text, shapes, connectors, frames and images.'],
  ['Celebration', 'Cards for someone special, with GIFs, a reveal time and a private reveal page for the recipient.'],
  ['Retro', 'A team retrospective that walks everyone through seven stages. Explained step by step below.'],
  ['Event raffle', 'A two-ring prize wheel for raffles and give-aways. Explained below.'],
  ['Team wall', 'A long-lived wall of shout-outs, reactions, birthdays and milestones.'],
]

export const OWNER_STEPS = [
  ['Sign up', 'Press Get started and enter your name, email and a password. You land on My boards.'],
  ['Create a board', 'Press New board, choose a type and a template. On a Retro board you also choose the columns: rename, reorder, remove or add your own, and save the set as a template.'],
  ['Share the code', 'Open Settings (the gear) to find the six-character access code and the link. Send it to your team. Optionally add a passcode.'],
  ['Run the session', 'Use the stage bar (Retro), the timer and the Settings to guide everyone. You can create as many boards as you like, each with its own code.'],
]

export const GUEST_STEPS = [
  ['Open the site', 'Go to the Retrospace home page and type the six-character code into Join with code. Capital letters or small letters both work.'],
  ['Enter the passcode', 'Only if the owner set one.'],
  ['Choose how you appear', 'Stay anonymous with a generated name and avatar (press Shuffle for another), or type your own name and build your avatar.'],
  ['Join', 'Press Join. No account and nothing to install. Your name is fixed once you have added something, so pick it first.'],
]

export const TOOLS = [
  ['Select', 'Click to pick, drag to move, drag a handle to resize. Drag a box to pick several.'],
  ['Sticky note (N)', 'Click the board, type, then click an empty spot to finish.'],
  ['Text (T)', 'Free text on the canvas.'],
  ['Shapes', 'Rectangle, ellipse and diamond.'],
  ['Connector', 'Click one item, then another, to join them with a line.'],
  ['Frame', 'A named area that groups what is inside it.'],
  ['Image', 'Add a picture. On cards, search Giphy or paste a GIF link.'],
]

export const TIPS = [
  'Edit text by double-clicking an item (double-tap on a phone). Finish with Cmd or Ctrl + Enter, or click an empty spot. Esc cancels.',
  'Delete: select the item and press Delete, or tap the red trash button at the top. That button is how you delete on a phone.',
  'Undo and redo are the arrows in the top bar. Zoom is at the bottom right.',
  'You can only change your own notes. The board owner can change or delete anyone’s.',
  'Throw emoji: the owner turns it on in Settings, Throw emoji. A row of emoji appears at the bottom. Tap one, then click a note to throw it. Esc cancels.',
  'Export: the download icon at the top saves a PNG, a CSV of the notes, or opens a printable page you can save as PDF.',
]

// The Retro flow. `owner` and `guests` say who does what; `tip` is the one thing to remember.
export const STAGES = [
  {
    key: 'join', name: 'Join', minutes: '1 min',
    what: 'The waiting room. People arrive, choose how they appear, and wait for you.',
    owner: 'Wait until everyone is in, then press Start.',
    guests: 'Choose a name and avatar. Notes cannot be added yet.',
    tip: 'If guests say the board is empty, this is why. Press Start.',
  },
  {
    key: 'collect', name: 'Collect feedback', minutes: '5 min',
    what: 'Everyone writes notes into the columns, such as Went Well, Could Be Improved, Blockers and Ideas. One idea per note.',
    owner: 'Press Next stage from Join. You can also write notes yourself. Close notes or Reopen notes pauses writing.',
    guests: 'Add notes, as themselves or anonymously.',
    tip: 'This is the only stage where guests can write.',
  },
  {
    key: 'group', name: 'Group', minutes: 'no timer',
    what: 'Similar notes are put together so the team sees the big themes instead of dozens of single notes.',
    owner: 'Drag related notes together. Optionally ask the AI to suggest themes, then accept, rename, combine or ignore them.',
    guests: 'Watch. Only you organise.',
    tip: 'Nothing changes until you accept a theme.',
  },
  {
    key: 'vote', name: 'Vote', minutes: '2 min',
    what: 'Everyone votes on what matters most. Each person has the same limited number of votes (3 by default).',
    owner: 'Open the stage. You vote too.',
    guests: 'Press the vote button on a note. Press it again to take the vote back.',
    tip: 'The most-voted notes become the topics for the next stage.',
  },
  {
    key: 'discuss', name: 'Review and discuss', minutes: '8 min',
    what: 'The team talks through the top-voted topics, one at a time.',
    owner: 'Pick the topics to discuss (the top ones are chosen for you; you can change them). Use the timer and +1 min when needed.',
    guests: 'Read the topic on screen and talk.',
    tip: 'Ties are shown, so you decide which of them to discuss.',
  },
  {
    key: 'actions', name: 'Create actions', minutes: '5 min',
    what: 'Turn the discussion into a few concrete actions: what we will do, who will do it, by when, and how we will know it worked.',
    owner: 'Add actions, or let guests add them (there is a limit, 3 by default).',
    guests: 'Add an action with an owner and a due date.',
    tip: 'Fewer, clearer actions get done. An action without an owner or date is flagged.',
  },
  {
    key: 'wrapup', name: 'Wrap up', minutes: '2 min',
    what: 'Close the session and keep a record.',
    owner: 'Generate the AI summary, review it, and share it. Export the notes if you want a copy.',
    guests: 'Read the shared summary.',
    tip: 'Guests only see a summary you choose to share.',
  },
]

export const WHEEL_STEPS = [
  ['Create an Event board', 'New board, Event raffle. The board opens on its Setup tab. Guests join with the code just like any other board.'],
  ['Add people and prizes', 'Paste names (one per line or separated by commas), or press Add everyone who joined. Add prizes with an emoji and how many there are, then Save changes. People are on the outer ring and prizes on the inner ring.'],
  ['Choose the celebration', 'Pick an effect for winners (confetti, fireworks, balloons, stars or sparkles), or choose a Giphy GIF for every winner. A prize can have its own effect or GIF: use the ☆ on the prize.'],
  ['Spin for the prize', 'Press the SPIN button in the middle of the wheel, the big button, or the space bar. The inner ring turns and stops on the prize.'],
  ['Spin for the winner', 'Press it again. The outer ring turns and stops on the winner, and everyone sees the same spin and the celebration.'],
  ['Accept, skip or spin again', 'Accept winner records the result and takes the winner off the wheel. Not here, skip spins again for the same prize. Spin the winner again goes back one step. Undo the last draw takes back an accepted result.'],
]

export const WHEEL_TIPS = [
  'Helpers: in Setup you can tick people who joined to let them run the draw too. Only you change the lists.',
  'Present puts a bigger wheel on screen for a projector. Esc leaves it. The speaker button adds a tick and a fanfare (off until you turn it on).',
  'History lists every accepted draw, newest first, and downloads as a CSV file.',
  'The server picks every result. Guests only watch, and nobody can change what comes up.',
]

export const AI_STEPS = [
  'Settings, AI summaries: switch it on and press I understand. Notes are sent to Anthropic to write the summary, so you confirm that first.',
  'Open Summary and press Generate (or Write manually). The result is a draft only you can see.',
  'Read it on the Report tab. Fix anything on the Edit tab and press Save changes.',
  'When you are happy, press Share with everyone. Make private takes it back.',
  'On the report, Copy as table pastes into Docs or email, and Download PDF or Download image saves a clean copy.',
]

export const HELP = [
  ['Guests see an empty board or cannot add notes', 'On a Retro board press Start, then Next stage to Collect feedback.'],
  ['“This stage is closed for notes”', 'The Retro is past Collect, or notes were closed. Press Back or Reopen notes.'],
  ['“Choose a name first”', 'Reload the page and choose a name and avatar before adding anything.'],
  ['I cannot edit someone else’s note', 'By design. Only the author and the board owner can change a note.'],
  ['A text box I made disappeared', 'An empty text box is removed when you click away. Type something first.'],
  ['The emoji row or live movement is missing', 'The live connection is down. Check your internet and reload. If it happens for everyone, the host should check realtime.'],
  ['Wrong passcode', 'Attempts are limited. Wait a minute and try again, or ask the owner.'],
  ['I forgot my password', 'Password reset is not available yet. Ask the host for help.'],
]
