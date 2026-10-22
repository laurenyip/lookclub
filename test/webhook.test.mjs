// The real /api/inbound route against a fake Resend: signed webhook in, photo fetched, reply sent out.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#24477a' } }).jpeg().toBuffer()
const sent = []
const server = http.createServer(async (req, res) => {
  const base = `http://localhost:${server.address().port}`
  const send = (obj) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (req.headers.authorization !== 'Bearer re_test' && !req.url.startsWith('/dl/')) {
    res.writeHead(401)
    return res.end('{}')
  }
  if (req.method === 'GET' && req.url === '/emails/receiving/em_42')
    return send({ object: 'email', id: 'em_42', from: 'Mia <mia@example.com>', subject: '✦ week 1: something blue and old', text: 'nana’s teacup\n\nOn Mon, Oct 26 look club wrote:\n> hi mia', html: null, message_id: '<abc@mail.example.com>' })
  if (req.method === 'GET' && req.url === '/emails/receiving/em_42/attachments')
    return send({ object: 'list', data: [{ id: 'att_1', filename: 'IMG_0042.jpeg', content_type: 'image/jpeg', size: jpeg.length, download_url: `${base}/dl/att_1` }] })
  if (req.url === '/dl/att_1') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    return res.end(jpeg)
  }
  if (req.method === 'POST' && req.url === '/emails/batch') {
    let body = ''
    for await (const c of req) body += c
    sent.push(...JSON.parse(body))
    return send({ data: [{ id: 'out_1' }] })
  }
  res.writeHead(404)
  res.end('{}')
})
await new Promise((r) => server.listen(0, r))
after(() => server.close())

const secret = crypto.randomBytes(24)
Object.assign(process.env, {
  LOOKCLUB_LOCAL: '1',
  LOOKCLUB_DATA: await fs.mkdtemp(path.join(os.tmpdir(), 'lookclub-wh-')),
  RESEND_API_BASE: `http://localhost:${server.address().port}`,
  RESEND_API_KEY: 're_test',
  RESEND_WEBHOOK_SECRET: 'whsec_' + secret.toString('base64'),
  MAIL_REPLY_TO: 'hunt@test.resend.app',
  ADMIN_KEY: 'test-admin-key',
})
const { handle } = await import('../lib/api.mjs')

const post = (path, body, headers = {}) =>
  handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

test('signed webhook → photo saved → threaded reply sent', async () => {
  const admin = { 'x-admin-key': 'test-admin-key' }
  assert.equal((await post('/api/admin/player', { name: 'mia', email: 'mia@example.com', sendWelcome: false })).status, 401)
  assert.equal((await post('/api/admin/player', { name: 'mia', email: 'mia@example.com', sendWelcome: false }, admin)).status, 200)
  assert.equal((await post('/api/admin/start', { prompt: 'something blue and old' }, admin)).status, 200)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].reply_to, 'hunt@test.resend.app')

  const raw = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: 'em_42', from: 'mia@example.com', subject: 'x', attachments: [{ id: 'att_1' }] } })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = crypto.createHmac('sha256', secret).update(`msg_9.${ts}.${raw}`).digest('base64')

  const forged = await post('/api/inbound', raw, { 'svix-id': 'msg_9', 'svix-timestamp': ts, 'svix-signature': 'v1,bm9wZQ==' })
  assert.equal(forged.status, 401)

  const res = await post('/api/inbound', raw, { 'svix-id': 'msg_9', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` })
  const out = await res.json()
  assert.equal(res.status, 200)
  assert.equal(out.result, 'submitted')

  const reply = sent.at(-1)
  assert.deepEqual(reply.to, ['mia@example.com'])
  assert.equal(reply.subject, 'Re: ✦ week 1: something blue and old')
  assert.equal(reply.headers['In-Reply-To'], '<abc@mail.example.com>')

  const view = await (await handle(new Request(`http://localhost/api/admin`, { headers: admin }))).json()
  assert.equal(view.current.submissions[0].caption, 'nana’s teacup')
  assert.equal(view.current.submissions[0].via, 'email')

  // resend retries the same webhook: nothing doubles up
  const again = await (await post('/api/inbound', raw, { 'svix-id': 'msg_9', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` })).json()
  assert.equal(again.result, 'duplicate')
})
