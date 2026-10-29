import { ImageResponse } from 'next/og'
import { Mark } from '../ui/site/brandImage.jsx'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#5b5bf0' }}><Mark size={132} /></div>,
    size,
  )
}
