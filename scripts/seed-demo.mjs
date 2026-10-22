// npm run demo (with `npm run dev` running) — fills the local site with a pretend circle so you can click around.
import sharp from 'sharp'

const BASE = process.env.BASE || 'http://localhost:8888'
const ADMIN = process.env.ADMIN_KEY || 'dev'

async function call(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin-key': ADMIN, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${path}: ${json.error}`)
  return json
}

// little painted "photos" so the demo has something to look at
function painting(seed, w, h) {
  const r = (n) => {
    seed = (seed * 9301 + 49297) % 233280
    return (seed / 233280) * n
  }
  const hues = [210 + r(30), 190 + r(40), 330 + r(30), 35 + r(20)]
  const shapes = Array.from({ length: 7 }, (_, i) => {
    const hue = hues[i % hues.length]
    return `<ellipse cx="${r(w)}" cy="${h * 0.35 + r(h * 0.6)}" rx="${40 + r(w / 3)}" ry="${30 + r(h / 4)}" fill="hsl(${hue},${40 + r(40)}%,${30 + r(45)}%)" opacity="${0.5 + r(0.5)}"/>`
  }).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hues[0]},45%,${55 + r(25)}%)"/><stop offset="1" stop-color="hsl(${hues[3]},35%,${40 + r(30)}%)"/></linearGradient>
    <filter id="b"><feGaussianBlur stdDeviation="${6 + r(14)}"/></filter></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><g filter="url(#b)">${shapes}</g></svg>`)
}

async function photo(seed, portrait) {
  const [w, h] = portrait ? [900, 1200] : [1200, 900]
  return sharp(painting(seed, w, h)).jpeg({ quality: 85 }).toBuffer()
}

async function emailReply(from, text, seed, portrait) {
  const form = new FormData()
  form.append('from', from)
  form.append('text', text)
  form.append('photo', new Blob([await photo(seed, portrait)], { type: 'image/jpeg' }), 'IMG.jpg')
  return call('/api/dev/inbound', form)
}

const friends = [
  ['lauren', 'lauren@example.com'],
  ['mia', 'mia@example.com'],
  ['jo', 'jo@example.com'],
  ['sam', 'sam@example.com'],
  ['priya', 'priya@example.com'],
  ['theo', 'theo@example.com'],
]
for (const [name, email] of friends) await call('/api/admin/player', { name, email, sendWelcome: false })

await call('/api/admin/prompts', { prompts: ['something blue and old', 'a shadow that looks like something else', 'the smallest beautiful thing you saw'] })
await call('/api/admin/start', {})
await emailReply('mia@example.com', 'my grandpa’s denim jacket, older than my mom', 3, true)
await emailReply('jo@example.com', 'the bike that lives outside the bakery', 11, false)
await emailReply('sam@example.com', 'a 1970s ashtray at the thrift store', 27, false)
await emailReply('priya@example.com', 'my nani’s blue bangles', 41, true)
await emailReply('lauren@example.com', 'the oldest blue thing in my room', 58, true)
await call('/api/admin/reveal', {})

await call('/api/admin/start', {})
await emailReply('mia@example.com', 'my hand pretending to be a bird', 72, false)
await emailReply('theo@example.com', '', 85, true)

const { players } = await call('/api/admin')
const me = players.find((p) => p.email === 'lauren@example.com')
console.log(`demo ready → ${BASE}/?me=${me.token}`)
