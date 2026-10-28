// Decorative: the labelled group around it ("Image") already names it, so the alt stays empty to avoid a double announcement.
export default function Image({ item }) {
  return <img className="bd-img" src={item.data.src} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} />
}
