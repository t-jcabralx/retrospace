/** @type {import('next').NextConfig} */
// allowedDevOrigins lets friends open `npm run dev` through a tunnel or your LAN address (dev server blocks other origins by default)
// Security headers on every response. No full CSP yet (Giphy, Google Fonts and inline styles would need a careful allow-list);
// framing is refused outright, which is the part that matters for a board people paste links to.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]
const nextConfig = { async headers() { return [{ source: '/:path*', headers: securityHeaders }] }, reactStrictMode: false, allowedDevOrigins: ['*.trycloudflare.com', '*.loca.lt', '*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.app', '*.ngrok.io', '*.vercel.app', '192.168.*.*', '10.*.*.*', '172.16.*.*'] }
export default nextConfig
