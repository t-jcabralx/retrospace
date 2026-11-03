import Image from 'next/image'
import './banner.css'

// A wide, decorative photo at the top of a plain page (support, terms, privacy). The photos are in public/photos.
export default function PageBanner({ src }) {
  return (
    <div className="pb" aria-hidden="true">
      <Image src={src} alt="" fill priority sizes="(min-width: 800px) 760px, 100vw" />
    </div>
  )
}
