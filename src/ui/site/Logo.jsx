// The Retrospace mark (same drawing as src/app/icon.svg): an accent rounded square with a white note and speech tail.
export function LogoMark({ size = 32 }) {
  return (
    <svg className="rs-logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M9 10.5A2.5 2.5 0 0111.5 8h9a2.5 2.5 0 012.5 2.5v6a2.5 2.5 0 01-2.5 2.5H15l-3.6 3.2c-.6.5-1.4.1-1.4-.7V19h-.5A2.5 2.5 0 019 16.5z" fill="var(--rs-on-accent)" />
      <path d="M12.5 12.5h7M12.5 15.5h4" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
