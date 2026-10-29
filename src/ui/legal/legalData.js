// The words of the privacy and terms pages. They describe what the app does today; change them when the app changes.
export const UPDATED = '29 October 2026'
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'jpcabralofficial@gmail.com'

export const PRIVACY = [
  ['Who runs Retrospace', ['Retrospace is run by Jason Cabral, Partners with Veehk Corps. If you have a question about your data, write to the contact address at the bottom of this page.']],
  ['What we keep', [
    'Owners who sign up: your name, your email address and your password (the password is kept only as a one-way scramble that cannot be turned back into the password), and the boards you create.',
    'Guests: no account is needed. We keep a random identifier for your browser, the name and avatar you choose, and what you add to a board (notes, cards, GIF links, pictures, votes, reactions, and your place on a raffle wheel if the host adds you).',
    'Boards: the title, the settings, everything people add, the history of raffle draws, and any summary the owner writes or generates.',
    'Your internet address is used for a short time (about a minute) to stop abuse, such as too many guesses at a passcode. It is not stored with your content.',
  ]],
  ['Anonymous notes', ['When a board allows anonymous notes and you post one that way, your name is hidden from everyone on the board, including the owner, in the screen, in downloads and in AI summaries. We still keep which browser wrote it, so that you can edit or delete your own note.']],
  ['Cookies and similar storage', [
    '`rs_session` keeps an owner signed in. `rs_g` is your guest identity on a board. `rs_a_` followed by a board code remembers that you entered that board’s passcode.',
    'Your browser also keeps a few small preferences on your device (for example whether the wheel sound is on). Nothing is sent to us for that.',
    'We do not use advertising or tracking cookies and we do not run analytics.',
  ]],
  ['Other companies that handle data for us', [
    'Vercel hosts the website. MongoDB Atlas stores the data. Upstash carries the live updates between people on a board.',
    'Google Fonts delivers the typeface (Google sees your internet address when your browser fetches it).',
    'Giphy: when you search for a GIF, your search words go to Giphy, and a GIF shown on a board is loaded from Giphy’s servers.',
    'Anthropic: only if a board’s owner turns on AI summaries, the board’s text is sent to Anthropic to write the summary or suggest themes. Nothing is sent unless the owner switches this on and confirms the notice.',
    'Photos on this website are stored on our own servers.',
  ]],
  ['Encryption', ['The site’s operator can switch on encryption of stored content. When it is on, titles, notes, names, email addresses and raffle lists are stored in the database as scrambled text that cannot be read from the database or a backup. The website unscrambles them only while showing them to a person who is allowed to see them.']],
  ['How long we keep it', [
    'A board and everything on it stay until its owner deletes the board or the account. Deleting an account deletes the owner’s boards, templates and sign-in sessions.',
    'Deleted data is removed from the live database straight away. Provider backups may keep a copy for a short, limited time before they expire.',
  ]],
  ['Your choices', [
    'Owners can delete a board, or the whole account, from the dashboard. Guests can leave at any time; clearing your browser’s cookies for this site removes your guest identity from your device.',
    'You can ask us to see, correct or delete your data by writing to the contact address. If you only took part as a guest, tell us the board code and the name you used.',
  ]],
  ['Children', ['Retrospace is not meant for children under 13, and we do not knowingly collect their data.']],
  ['Changes', ['If this page changes in a way that matters, the date at the top changes too.']],
]

export const TERMS = [
  ['Using Retrospace', ['Retrospace lets people run retrospectives, workshops, celebrations, team walls and raffles on shared boards. By using it you agree to these terms. If you use it for your organisation, you confirm you are allowed to.']],
  ['Your content', [
    'What you add to a board belongs to you or the person who owns it. You give us permission to store it, show it to the people who have the board code, and process it to run the service (for example, to send it to the live-update service or, if the owner turns it on, to write an AI summary).',
    'Board owners are responsible for the people they invite and for what is on their boards. Do not put anything on a board that you do not have the right to share.',
  ]],
  ['What not to do', [
    'Do not post anything unlawful, threatening, harassing, hateful or sexual involving minors, or anything that spreads malware.',
    'Do not try to break into other people’s boards, guess codes or passcodes in bulk, overload the service, or take it apart to get around its limits.',
    'We may remove content or close a board that breaks these rules.',
  ]],
  ['Accounts and codes', ['Keep your password and your board codes safe. Anyone who has a board’s code (and passcode, if set) can take part in it. Owners can lock, close or revoke a board at any time.']],
  ['AI summaries and suggestions', ['AI output can be wrong or badly worded. Owners should read it before they share it. Guests only ever see a summary the owner chose to share.']],
  ['Raffles and prize draws', ['The prize wheel picks results at random on the server. The people who run an event are responsible for their own prizes, rules, eligibility and any local laws about raffles. Retrospace is not a party to any prize.']],
  ['Availability', ['We work to keep Retrospace running but it is provided as it is, with no promise that it will always be available or free of errors. Export what you need to keep (the CSV and image downloads).']],
  ['Limits of responsibility', ['To the extent the law allows, we are not responsible for indirect or consequential losses, or for content added by users. Nothing here limits rights you have by law that cannot be limited.']],
  ['Ending', ['You can stop using Retrospace and delete your account at any time. We may suspend access that breaks these terms.']],
  ['Ownership', ['The Retrospace software and design belong to Jason Cabral, Partners with Veehk Corps. All rights reserved.']],
  ['Changes', ['We may update these terms. If a change matters, the date at the top changes. Using the service after that means you accept the new terms.']],
]
