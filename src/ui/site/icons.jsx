// 24px stroke icons for the marketing and account pages (currentColor, decorative). The canvas icons live in ../icons.jsx.
const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }
const I = (children) => function Icon(props) { return <svg {...base} {...props}>{children}</svg> }

export const CursorsIcon = I(<><path d="M4 4l6.5 15 2.2-6.3L19 10.5z" /><path d="M14 15.5l5 4.5" /></>)
export const MaskIcon = I(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.6-4 3.2-6 7-6s6.4 2 7 6" /></>)
export const VoteIcon = I(<><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.6 1.6" /><path d="M9.5 3h5" /></>)
export const KeyIcon = I(<><circle cx="8" cy="15" r="4" /><path d="M11 12.5L20 4M16 8l2.5 2.5" /></>)
export const PartyIcon = I(<><path d="M4 20l4.5-12 7.5 7.5z" /><path d="M13 5.5v.01M18 9v.01M17 3.5l.5 2M20.5 13l-2 .5" /></>)
export const SmileIcon = I(<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14c1 1.6 2.2 2.2 3.5 2.2s2.5-.6 3.5-2.2" /><path d="M9 9.5v.01M15 9.5v.01" /></>)
export const SparkIcon = I(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16v4M17 18h4" /></>)
export const LayoutIcon = I(<><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M9.5 9.5V20" /></>)
export const CanvasIcon = I(<><rect x="3.5" y="4" width="8" height="8" rx="1.5" /><rect x="13.5" y="8" width="7" height="8" rx="1.5" /><rect x="6.5" y="14.5" width="6" height="5.5" rx="1.5" /></>)
export const GiftIcon = I(<><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M12 9v11M3.5 9h17M12 9c-1-4-5.5-4.5-5.5-2S9 9 12 9zm0 0c1-4 5.5-4.5 5.5-2S15 9 12 9z" /></>)
export const LoopIcon = I(<><path d="M4 12a8 8 0 0113.7-5.6L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 01-13.7 5.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></>)
export const ArrowIcon = I(<path d="M5 12h14M13 6l6 6-6 6" />)
export const EyeIcon = I(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>)
export const EyeOffIcon = I(<><path d="M3 3l18 18" /><path d="M10.6 5.7c.45-.1.9-.2 1.4-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 01-3.2 3.9M6.6 7.4A15.6 15.6 0 002.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9" /><path d="M9.9 10a3 3 0 004.1 4.1" /></>)
export const CopyIcon = I(<><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M15.5 8.5v-2a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2" /></>)
export const CheckIcon = I(<path d="M5 12.5l4.5 4.5L19 7.5" />)
export const LinkIcon = I(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0010 18.7l1-1" /></>)
export const PlusIcon = I(<path d="M12 5v14M5 12h14" />)
export const LogOutIcon = I(<><path d="M9.5 4.5h-3a2 2 0 00-2 2v11a2 2 0 002 2h3" /><path d="M15 8l4 4-4 4M19 12H9.5" /></>)
export const CloseIcon = I(<path d="M6 6l12 12M18 6L6 18" />)
export const HeartIcon = I(<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.4 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" strokeWidth="1" />)

export const TYPE_ICONS = { workshop: CanvasIcon, celebration: GiftIcon, retro: LoopIcon, wall: SparkIcon, event: PartyIcon }
export const typeIcon = (type) => TYPE_ICONS[type] ?? CanvasIcon
