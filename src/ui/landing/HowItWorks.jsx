const STEPS = [
  { title: 'Create a board', text: 'Sign up, choose a workshop, retro or celebration template and give your board a name.' },
  { title: 'Share the access code', text: 'Every board has its own six-character code and link. Add a passcode if you want one more lock.' },
  { title: 'Collaborate live', text: 'Guests enter the code, pick a name and avatar, and start adding to the board together.' },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="ls-section" aria-labelledby="how-title">
      <div className="rs-wrap">
        <header className="ls-head">
          <p className="ls-eyebrow">How it works</p>
          <h2 id="how-title" className="ls-h2">From idea to live board in three steps</h2>
        </header>
        <ol className="ls-steps">
          {STEPS.map(({ title, text }, i) => (
            <li key={title} className="ls-step">
              <span className="ls-num" aria-hidden="true">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
