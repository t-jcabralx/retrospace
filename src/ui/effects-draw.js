// Draws the particle list (effects-engine.js) onto a 2D canvas context. Kept apart from the maths so that stays pure.
const TAU = Math.PI * 2

function drawBalloon(ctx, p) {
  const r = p.size
  const sway = Math.sin(p.age * 2 + p.phase) * 4
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(p.x, p.y + r * 1.25)
  ctx.quadraticCurveTo(p.x + sway, p.y + r * 2.1, p.x - sway, p.y + r * 3)
  ctx.stroke()
  ctx.fillStyle = p.color
  ctx.beginPath()
  ctx.ellipse(p.x, p.y, r * 0.82, r, 0, 0, TAU)
  ctx.fill()
  ctx.beginPath() // knot
  ctx.moveTo(p.x, p.y + r * 0.95)
  ctx.lineTo(p.x - r * 0.14, p.y + r * 1.28)
  ctx.lineTo(p.x + r * 0.14, p.y + r * 1.28)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.45)' // highlight
  ctx.beginPath()
  ctx.ellipse(p.x - r * 0.3, p.y - r * 0.38, r * 0.16, r * 0.3, -0.5, 0, TAU)
  ctx.fill()
}

function drawOne(ctx, p) {
  switch (p.kind) {
    case 'confetti': {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.scale(1, Math.cos(p.age * 9 + p.phase)) // tumbling: the piece turns edge-on now and then
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
      break
    }
    case 'balloon':
      drawBalloon(ctx, p)
      break
    case 'rocket':
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = p.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x, p.y + 22)
      ctx.stroke()
      break
    default: { // spark
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.ttl)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
}

// `view` = { w, h, dpr }: the canvas is w x h CSS pixels at dpr device pixels per CSS pixel.
export function drawParticles(ctx, particles, { w, h, dpr }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  for (const p of particles) if (!(p.delay > 0)) drawOne(ctx, p)
}
