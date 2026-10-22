// Shared bits: the starry sky, the bubble cursor, toasts and a tiny fetch helper.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ---------- sky ----------
export function startSky() {
  const canvas = document.getElementById('sky')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  let stars = []
  let shooting = null
  let w, h, dpr

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = innerWidth
    h = innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const count = Math.round((w * h) / 5200)
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() < 0.08 ? 1.3 + Math.random() * 0.6 : 0.4 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.4,
      tint: Math.random() < 0.15 ? (Math.random() < 0.5 ? '255,214,235' : '200,225,255') : '255,255,255',
    }))
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h)
    for (const s of stars) {
      const a = reduceMotion ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + (t / 1000) * s.speed))
      ctx.beginPath()
      ctx.fillStyle = `rgba(${s.tint},${a * 0.9})`
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
      if (s.r > 1.3) {
        ctx.fillStyle = `rgba(${s.tint},${a * 0.12})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (!reduceMotion) {
      if (!shooting && Math.random() < 0.0016) {
        shooting = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.35, life: 0 }
      }
      if (shooting) {
        const s = shooting
        s.life += 1
        const len = 90
        const px = s.x - s.life * 7
        const py = s.y + s.life * 3.2
        const g = ctx.createLinearGradient(px, py, px + len, py - len * 0.45)
        const fade = Math.max(0, 1 - s.life / 45)
        g.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + len, py - len * 0.45)
        ctx.stroke()
        if (s.life > 45) shooting = null
      }
      requestAnimationFrame(draw)
    }
  }

  resize()
  addEventListener('resize', resize)
  requestAnimationFrame(draw)
}

// ---------- cursor: a bubble that turns into a pill saying what will happen ----------
export function startCursor() {
  if (!matchMedia('(pointer: fine)').matches) return
  const el = document.createElement('div')
  el.className = 'cursor'
  el.innerHTML = '<img class="c-bubble" src="/images/bubble.png" alt=""><span class="c-pill"></span>'
  document.body.appendChild(el)
  document.documentElement.classList.add('has-cursor')
  const pill = el.querySelector('.c-pill')
  let x = -100, y = -100, cx = x, cy = y

  addEventListener('pointermove', (e) => {
    x = e.clientX
    y = e.clientY
    el.classList.add('visible')
    const target = e.target.closest?.('[data-cursor]')
    if (target) {
      pill.textContent = target.dataset.cursor
      el.classList.add('pill')
    } else el.classList.remove('pill')
  })
  addEventListener('pointerdown', () => el.classList.add('press'))
  addEventListener('pointerup', () => el.classList.remove('press'))
  document.addEventListener('mouseleave', () => el.classList.remove('visible'))

  ;(function loop() {
    cx += (x - cx) * (reduceMotion ? 1 : 0.32)
    cy += (y - cy) * (reduceMotion ? 1 : 0.32)
    el.style.transform = `translate(${cx}px, ${cy}px)`
    requestAnimationFrame(loop)
  })()
}

// ---------- toast ----------
let toastTimer
export function toast(msg) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast pill'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
}

// ---------- api ----------
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  if (body instanceof FormData) opts.body = body
  else if (body !== undefined) {
    opts.body = JSON.stringify(body)
    opts.headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, opts)
  let data = {}
  try { data = await res.json() } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'something went wrong'), { status: res.status })
  return data
}

export function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    return null
  }
}
