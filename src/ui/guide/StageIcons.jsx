// One small drawing per Retro stage, in the current text colour so it follows light and dark. Decorative.
const I = (children) => function Icon() {
  return <svg className="gd-icon" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
}

export const STAGE_ICONS = {
  // people arriving at a door
  join: I(<><rect x="26" y="8" width="14" height="30" rx="2" /><circle cx="30" cy="24" r="1" fill="currentColor" /><circle cx="13" cy="17" r="5" /><path d="M5 38c0-7 4-11 8-11s8 4 8 11" /></>),
  // a sticky note being written
  collect: I(<><path d="M8 10h26a2 2 0 012 2v20l-8 8H10a2 2 0 01-2-2z" /><path d="M28 40v-6a2 2 0 012-2h6" /><path d="M14 18h14M14 25h9" /></>),
  // several notes drawn together into a group
  group: I(<><rect x="6" y="8" width="16" height="14" rx="2" /><rect x="26" y="8" width="16" height="14" rx="2" /><rect x="16" y="28" width="16" height="14" rx="2" /><path d="M14 22v3a3 3 0 003 3M34 22v3a3 3 0 01-3 3" /></>),
  // a hand putting a vote in a box
  vote: I(<><rect x="6" y="26" width="36" height="16" rx="3" /><path d="M16 26v-4M32 26v-4" /><path d="M14 8h20l-2 14H16z" /><path d="M20 15l3 3 6-6" /></>),
  // two speech bubbles
  discuss: I(<><path d="M6 10h22a2 2 0 012 2v12a2 2 0 01-2 2H16l-6 6v-6H6a2 2 0 01-2-2V12a2 2 0 012-2z" /><path d="M34 18h8a2 2 0 012 2v12a2 2 0 01-2 2h-3v6l-6-6H24" /></>),
  // a checklist
  actions: I(<><rect x="8" y="6" width="32" height="36" rx="3" /><path d="M15 17l3 3 5-6M15 31l3 3 5-6" /><path d="M28 18h6M28 32h6" /></>),
  // a flag on a hill
  wrapup: I(<><path d="M12 42V8" /><path d="M12 10h24l-5 8 5 8H12" /><path d="M6 42h36" /></>),
}
