// npm test — runs a full week end to end against a throwaway local store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lookclub-'))
process.env.LOOKCLUB_LOCAL = '1'
process.env.LOOKCLUB_DATA = dir
process.env.MAIL_REPLY_TO = 'hunt@test.resend.app'
delete process.env.RESEND_API_KEY

const G = await import('../lib/game.mjs')
const { handleInboundEmail, extractReply, parseAddress } = await import('../lib/inbound.mjs')
const { nextOccurrence, zonedParts } = await import('../lib/time.mjs')
const { verifyWebhook } = await import('../lib/mail.mjs')
const sharp = (await import('sharp')).default

const outbox = async () => {
  const d = path.join(dir, 'outbox')
  const files = (await fs.readdir(d).catch(() => [])).sort()
  return Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(d, f), 'utf8'))))
}
const photo = (color) => sharp({ create: { width: 1200, height: 900, channels: 3, background: color } }).jpeg().toBuffer()
const attach = (buf, name = 'IMG_0001.jpg') => ({ filename: name, contentType: 'image/jpeg', size: buf.length, download: async () => buf })

test('next occurrence respects the timezone', () => {
  // wed 22 oct 2026, noon in vancouver → next monday 9am vancouver = 16:00 utc (PDT)
  const after = new Date('2026-10-22T19:00:00Z')
  const t = nextOccurrence(after, 1, 9, 'America/Vancouver')
  assert.equal(t.toISOString(), '2026-10-26T16:00:00.000Z')
  // los angeles still falls back on nov 1 (bc stays on daylight time), so it's 17:00 utc
  const t2 = nextOccurrence(new Date('2026-11-03T00:00:00Z'), 1, 9, 'America/Los_Angeles')
  assert.equal(t2.toISOString(), '2026-11-09T17:00:00.000Z')
  assert.equal(zonedParts(t2, 'America/Los_Angeles').hour, 9)
})

test('reply text becomes a clean caption', () => {
  const gmail = 'my grandma’s teapot!\r\n\r\nOn Mon, Oct 26, 2026 at 9:00 AM look club <\r\nhunt@x.resend.app> wrote:\r\n> hi lauren'
  assert.equal(extractReply(gmail), 'my grandma’s teapot!')
  assert.equal(extractReply('[image: IMG_0042.jpeg]\nfound it at the market\n\nSent from my iPhone'), 'found it at the market')
  assert.equal(extractReply(null, '<div dir="ltr">old jeans<br></div><div class="gmail_quote">On Mon…</div>'), 'old jeans')
  assert.equal(parseAddress('Lauren Yip <Lauren@Example.com>'), 'lauren@example.com')
})

test('webhook signatures are checked', () => {
  const secret = crypto.randomBytes(24)
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + secret.toString('base64')
  const body = '{"type":"email.received"}'
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = crypto.createHmac('sha256', secret).update(`msg_1.${ts}.${body}`).digest('base64')
  const h = (s) => new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': s })
  assert.equal(verifyWebhook(body, h(`v1,${sig}`)), true)
  assert.equal(verifyWebhook(body + ' ', h(`v1,${sig}`)), false)
  assert.equal(verifyWebhook(body, h('v1,AAAA')), false)
})

test('a whole week: join, prompt, reply by email, upload, reveal, stars', async () => {
  const { player: lauren } = await G.addPlayer({ name: 'lauren', email: 'lauren@example.com' })
  const { player: mia } = await G.addPlayer({ name: 'mia', email: 'Mia@Example.com' })
  const { player: jo } = await G.addPlayer({ name: 'jo', email: 'jo@example.com' })
  assert.equal((await outbox()).filter((m) => /you’re in/.test(m.subject)).length, 3)

  // paused by default: tick does nothing
  assert.match((await G.tick(new Date('2026-10-22T19:30:00Z'))).did, /paused/)

  await G.saveSettings({ paused: false })
  await G.savePromptQueue(['something blue and old'])
  const s = await G.getSettings()
  s.armedAt = '2026-10-21T19:00:00.000Z'
  const db = await import('../lib/store.mjs')
  await db.setJSON('settings', s)

  // thursday morning: nothing yet. thursday noon vancouver: week 1 starts
  assert.match((await G.tick(new Date('2026-10-22T18:00:00Z'))).did, /waiting/)
  assert.match((await G.tick(new Date('2026-10-22T19:00:30Z'))).did, /started week 1/)
  const round = await G.currentRound()
  assert.equal(round.prompt, 'something blue and old')
  assert.equal(round.revealAt, '2026-10-29T03:00:00.000Z') // wednesday 8pm vancouver (utc-7)
  const prompts = (await outbox()).filter((m) => m.subject.startsWith('✦ week 1'))
  assert.equal(prompts.length, 3)
  assert.equal(prompts[0].reply_to, 'hunt@test.resend.app')

  // mia replies by email with a photo + a tiny signature logo
  const logo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer()
  const r1 = await handleInboundEmail({
    id: 'em_1',
    from: 'Mia <mia@example.com>',
    subject: '✦ week 1: something blue and old',
    text: 'my grandpa’s denim jacket\n\nOn Mon, Oct 26 look club wrote:\n> hi mia',
    attachments: [attach(logo, 'logo.png'), attach(await photo('#2a4b8d'))],
  })
  assert.equal(r1.result, 'submitted')
  assert.equal((await handleInboundEmail({ id: 'em_1', from: 'mia@example.com' })).result, 'duplicate')
  const subs = await G.getSubmissions(round.id)
  assert.equal(subs.length, 1)
  assert.equal(subs[0].caption, 'my grandpa’s denim jacket')
  assert.equal(subs[0].width, 1200)
  assert.ok((await outbox()).some((m) => m.to === 'mia@example.com' && /^Re: /.test(m.subject)))

  // a stranger gets a polite bounce; no photo gets a hint
  assert.equal((await handleInboundEmail({ id: 'em_2', from: 'rando@else.com', text: 'hi', attachments: [] })).result, 'unknown sender')
  assert.equal((await handleInboundEmail({ id: 'em_3', from: 'jo@example.com', text: 'here!', attachments: [] })).result, 'no image')

  // jo uploads on the web, lauren doesn't play
  await G.submitPhoto({ player: jo, buffer: await photo('#6fa8dc'), caption: 'old blue bike', via: 'web' })

  // before the reveal, lauren only sees who's done, not photos
  let view = await G.viewFor(lauren)
  assert.equal(view.week.photos.length, 0)
  assert.deepEqual(view.week.circle.map((c) => c.done), [false, true, true])
  assert.equal(await G.canSeePhoto(subs[0].photo, lauren), false)
  assert.equal(await G.canSeePhoto(subs[0].photo, mia), true)

  // tuesday 6pm: reminder to lauren only
  assert.match((await G.tick(new Date('2026-10-28T01:00:30Z'))).did, /reminded/)
  const reminders = (await outbox()).filter((m) => m.subject.startsWith('still hunting'))
  assert.deepEqual(reminders.map((m) => m.to), ['lauren@example.com'])

  // wednesday 8pm: reveal
  assert.match((await G.tick(new Date('2026-10-29T03:00:30Z'))).did, /revealed/)
  view = await G.viewFor(lauren)
  assert.equal(view.week.revealed, true)
  assert.equal(view.week.photos.length, 2)
  assert.equal(await G.canSeePhoto(subs[0].photo, lauren), true)
  assert.equal((await outbox()).filter((m) => m.subject.startsWith('the gallery is open')).length, 3)

  // stars
  await G.toggleStar(lauren, round.id, mia.id)
  view = await G.viewFor(mia)
  assert.equal(view.week.photos.find((p) => p.playerId === mia.id).stars, 1)

  // a late one still counts
  const late = await handleInboundEmail({ id: 'em_4', from: 'lauren@example.com', text: 'sorry!', attachments: [attach(await photo('#123456'))] })
  assert.equal(late.result, 'submitted')
  assert.equal((await G.getRound(round.id)).count, 3)

  // "stop" pauses prompts
  assert.equal((await handleInboundEmail({ id: 'em_5', from: 'jo@example.com', text: 'stop', attachments: [] })).result, 'paused player')

  // next day, thursday noon: week 2, from the built-in list, only to active players
  assert.match((await G.tick(new Date('2026-10-29T19:00:30Z'))).did, /started week 2/)
  const w2 = await G.currentRound()
  assert.equal(w2.number, 2)
  assert.notEqual(w2.prompt, 'something blue and old')
  assert.equal((await outbox()).filter((m) => m.subject.startsWith('✦ week 2')).length, 2)
  view = await G.viewFor(lauren)
  assert.equal(view.past.length, 1)
  assert.equal(view.past[0].count, 3)
})
