// Email through Resend: sending, reading received mail, verifying webhooks.
// Without RESEND_API_KEY (local dev) emails are written to .data/outbox instead.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const API = process.env.RESEND_API_BASE || 'https://api.resend.com'

export function mailConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'look club <onboarding@resend.dev>',
    replyTo: process.env.MAIL_REPLY_TO || '',
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
  }
}

async function resend(method, url, body) {
  const { apiKey } = mailConfig()
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (!res.ok) throw new Error(`resend ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`)
  return json
}

async function writeOutbox(messages) {
  const dir = path.join(process.env.LOOKCLUB_DATA || path.resolve('.data'), 'outbox')
  await fs.mkdir(dir, { recursive: true })
  for (const m of messages) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
    await fs.writeFile(path.join(dir, name), JSON.stringify({ ...m, sentAt: new Date().toISOString() }, null, 2))
    console.log(`[outbox] to ${m.to} — ${m.subject}`)
  }
}

// messages: [{ to, subject, html, text, headers? }]
export async function sendEmails(messages) {
  if (!messages.length) return
  const { apiKey, from, replyTo } = mailConfig()
  const full = messages.map((m) => ({
    from,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(m.headers ? { headers: m.headers } : {}),
  }))
  if (!apiKey) return writeOutbox(full.map((m) => ({ ...m, to: m.to[0] })))
  for (let i = 0; i < full.length; i += 100) {
    await resend('POST', '/emails/batch', full.slice(i, i + 100))
  }
}

export async function getReceivedEmail(id) {
  const res = await resend('GET', `/emails/receiving/${encodeURIComponent(id)}`)
  return res?.data ?? res
}

export async function listReceivedAttachments(id) {
  const res = await resend('GET', `/emails/receiving/${encodeURIComponent(id)}/attachments`)
  return res?.data ?? []
}

// Resend signs webhooks the Svix way
export function verifyWebhook(rawBody, headers) {
  const { webhookSecret } = mailConfig()
  if (!webhookSecret) return false
  const id = headers.get('svix-id')
  const ts = headers.get('svix-timestamp')
  const sigHeader = headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 10) return false
  const key = Buffer.from(webhookSecret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest()
  return sigHeader.split(' ').some((part) => {
    const sig = Buffer.from(part.split(',')[1] || '', 'base64')
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected)
  })
}
