// Every /api/* route. Exported as one handler so Netlify and the local dev server share it.
import crypto from 'node:crypto'
import * as G from './game.mjs'
import * as db from './store.mjs'
import { handleInboundEmail } from './inbound.mjs'
import { verifyWebhook, getReceivedEmail, listReceivedAttachments } from './mail.mjs'

const LOCAL = process.env.LOOKCLUB_LOCAL === '1'

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function isAdmin(req) {
  const want = process.env.ADMIN_KEY || (LOCAL ? 'dev' : '')
  const got = req.headers.get('x-admin-key') || new URL(req.url).searchParams.get('a') || ''
  if (!want || want.length < 3 || got.length !== want.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

async function player(req) {
  const t = req.headers.get('x-token') || new URL(req.url).searchParams.get('t')
  return G.playerByToken(t)
}

async function body(req) {
  try { return await req.json() } catch { return {} }
}

async function fileFromForm(form) {
  const file = form.get('photo')
  if (!file || typeof file === 'string') throw new G.UserError('pick a photo first')
  return { buffer: Buffer.from(await file.arrayBuffer()), contentType: file.type }
}

const routes = {
  // ---- players ----
  'GET /api/me': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    return json(await G.viewFor(me, new URL(req.url).searchParams.get('w')))
  },

  'POST /api/upload': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    const form = await req.formData()
    const { buffer, contentType } = await fileFromForm(form)
    const { sub, replaced } = await G.submitPhoto({ player: me, buffer, contentType, caption: form.get('caption') || '', via: 'web' })
    return json({ ok: true, sub, replaced })
  },

  'POST /api/caption': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    const { caption } = await body(req)
    return json({ ok: true, sub: await G.setCaption(me, caption) })
  },

  'POST /api/remove': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    const cur = await G.currentRound()
    if (cur) await G.removeSubmission(cur.id, me.id)
    return json({ ok: true })
  },

  'POST /api/star': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    const { roundId, playerId } = await body(req)
    const list = await G.toggleStar(me, roundId, playerId)
    return json({ ok: true, stars: list.length, starredByMe: list.includes(me.id) })
  },

  'POST /api/pause': async (req) => {
    const me = await player(req)
    if (!me) return json({ error: 'not in the circle' }, 401)
    const { active } = await body(req)
    await G.updatePlayer(me.id, { active: !!active })
    return json({ ok: true })
  },

  'GET /api/photo': async (req) => {
    const key = new URL(req.url).searchParams.get('k') || ''
    const me = await player(req)
    const ok = isAdmin(req) || (me && (await G.canSeePhoto(key, me)))
    if (!ok) return new Response('nope', { status: 403 })
    const photo = await db.getPhoto(key)
    if (!photo) return new Response('gone', { status: 404 })
    return new Response(photo.data, {
      headers: { 'Content-Type': photo.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' },
    })
  },

  // ---- joining ----
  'GET /api/invite': async (req) => {
    const s = await G.getSettings()
    const code = new URL(req.url).searchParams.get('code')
    const ok = s.joinOpen && code === s.inviteCode
    const players = ok ? await G.getPlayers() : []
    return json({ ok, circleName: s.circleName, schedule: G.scheduleLine(s), names: players.filter((p) => p.active).map((p) => p.name) })
  },

  'POST /api/join': async (req) => {
    const s = await G.getSettings()
    const { code, name, email } = await body(req)
    if (!s.joinOpen || code !== s.inviteCode) return json({ error: 'that invite link isn’t working anymore — ask for a fresh one' }, 403)
    const { player, created } = await G.addPlayer({ name, email })
    // an existing email gets their link by email, not on screen, so nobody can grab someone else's spot
    return json({ ok: true, created, token: created ? player.token : null })
  },

  // ---- admin ----
  'GET /api/admin': async () => json(await G.adminView()),
  'POST /api/admin/settings': async (req) => json({ ok: true, settings: await G.saveSettings(await body(req)) }),
  'POST /api/admin/prompts': async (req) => json({ ok: true, prompts: await G.savePromptQueue((await body(req)).prompts || []) }),
  'POST /api/admin/player': async (req) => {
    const b = await body(req)
    if (b.id) return json({ ok: true, player: await G.updatePlayer(b.id, b) })
    return json({ ok: true, ...(await G.addPlayer(b, { sendWelcome: b.sendWelcome !== false })) })
  },
  'POST /api/admin/player/remove': async (req) => {
    await G.removePlayer((await body(req)).id)
    return json({ ok: true })
  },
  'POST /api/admin/player/welcome': async (req) => {
    const { id } = await body(req)
    const p = (await G.getPlayers()).find((x) => x.id === id)
    if (!p) return json({ error: 'no such player' }, 404)
    await G.sendWelcomeEmail(p)
    return json({ ok: true })
  },
  'POST /api/admin/start': async (req) => {
    const { prompt } = await body(req)
    const round = await G.startRound({ prompt })
    await G.saveSettings({ paused: false })
    return json({ ok: true, round })
  },
  'POST /api/admin/reveal': async () => {
    const cur = await G.currentRound()
    if (!cur || cur.status !== 'open') return json({ error: 'no open week to reveal' }, 400)
    return json({ ok: true, round: await G.revealRound(cur) })
  },
  'POST /api/admin/remind': async () => {
    const cur = await G.currentRound()
    if (!cur || cur.status !== 'open') return json({ error: 'no open week' }, 400)
    return json({ ok: true, sent: await G.sendReminders(cur) })
  },
  'POST /api/admin/submission/remove': async (req) => {
    const { roundId, playerId } = await body(req)
    await G.removeSubmission(roundId, playerId)
    return json({ ok: true })
  },
  'POST /api/admin/tick': async () => json(await G.tick()),

  // ---- email in (Resend webhook) ----
  'POST /api/inbound': async (req) => {
    const raw = await req.text()
    if (!verifyWebhook(raw, req.headers)) return json({ error: 'bad signature' }, 401)
    const event = JSON.parse(raw)
    if (event.type !== 'email.received') return json({ ok: true, ignored: event.type })
    const id = event.data?.email_id || event.data?.id
    const email = await getReceivedEmail(id)
    const attachments = await listReceivedAttachments(id)
    const result = await handleInboundEmail({
      id,
      from: email?.from || event.data?.from,
      subject: email?.subject || event.data?.subject,
      text: email?.text,
      html: email?.html,
      messageId: email?.message_id || event.data?.message_id,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        contentType: a.content_type || a.contentType,
        size: a.size,
        download: async () => {
          const r = await fetch(a.download_url)
          if (!r.ok) throw new Error(`attachment download ${r.status}`)
          return Buffer.from(await r.arrayBuffer())
        },
      })),
    })
    console.log('inbound', id, result)
    return json({ ok: true, ...result })
  },
}

// local-only helpers: fake an email reply, move time forward
const devRoutes = {
  'POST /api/dev/inbound': async (req) => {
    const form = await req.formData()
    const file = form.get('photo')
    const attachments = []
    if (file && typeof file !== 'string') {
      const buf = Buffer.from(await file.arrayBuffer())
      attachments.push({ filename: file.name, contentType: file.type, size: buf.length, download: async () => buf })
    }
    return json(
      await handleInboundEmail({
        id: 'dev-' + Date.now(),
        from: form.get('from'),
        subject: form.get('subject') || '✦ week 1',
        text: form.get('text') || '',
        attachments,
      })
    )
  },
  'POST /api/dev/tick': async (req) => {
    const { now } = await body(req)
    return json(await G.tick(now ? new Date(now) : new Date()))
  },
}

export async function handle(req) {
  const { pathname } = new URL(req.url)
  const key = `${req.method} ${pathname.replace(/\/$/, '')}`
  let fn = routes[key] || (LOCAL && devRoutes[key])
  if (!fn) return json({ error: 'not found' }, 404)
  if (pathname.startsWith('/api/admin') && !isAdmin(req)) return json({ error: 'wrong admin key' }, 401)
  try {
    return await fn(req)
  } catch (e) {
    if (e instanceof G.UserError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'something broke on our side — try again in a sec' }, 500)
  }
}
