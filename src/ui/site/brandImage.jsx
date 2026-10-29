// The Retrospace mark and the share card, drawn with plain inline styles because next/og (satori) renders only a CSS subset.
// Same drawing as src/app/icon.svg and the LogoMark component.
const ACCENT = '#5b5bf0'

export function Mark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill={ACCENT} />
      <path d="M9 10.5A2.5 2.5 0 0111.5 8h9a2.5 2.5 0 012.5 2.5v6a2.5 2.5 0 01-2.5 2.5H15l-3.6 3.2c-.6.5-1.4.1-1.4-.7V19h-.5A2.5 2.5 0 019 16.5z" fill="#ffffff" />
      <path d="M12.5 12.5h7M12.5 15.5h4" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export const SHARE_ALT = 'Retrospace: live boards for retrospectives, workshops and celebrations'

export function ShareCard() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: 'linear-gradient(135deg, #12141b 0%, #1b1e33 100%)', color: '#f4f5fb' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Mark size={84} />
        <div style={{ marginLeft: 24, fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>Retrospace</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>Retrospectives, workshops and celebrations.</div>
        <div style={{ marginTop: 28, fontSize: 34, color: '#a9aecb' }}>Share a six-character code. Your whole team joins in seconds.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 28, color: '#a9aecb' }}>
        <div style={{ display: 'flex', padding: '8px 20px', borderRadius: 999, border: `2px solid ${ACCENT}`, color: '#ffffff' }}>No account needed to join</div>
      </div>
    </div>
  )
}
