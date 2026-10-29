import { ImageResponse } from 'next/og'
import { ShareCard, SHARE_ALT } from '../ui/site/brandImage.jsx'

export const alt = SHARE_ALT
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(<ShareCard />, size)
}
