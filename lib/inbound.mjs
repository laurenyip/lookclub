// Email replies -> submissions. Works on a normalised email so the Resend webhook and local dev share it.
import * as db from './store.mjs'
import { sendEmails } from './mail.mjs'
import * as T from './emails.mjs'
import { looksLikeImage } from './images.mjs'
import { formatWhen } from './time.mjs'
import {
  UserError,
  getSettings,
  playerByEmail,
  playerLink,
  siteUrl,
  submitPhoto,
  updatePlayer,
} from './game.mjs'

export function parseAddress(from) {
  const s = String(from || '')
  const m = /<([^>]+)>/.exec(s)
  return (m ? m[1] : s).trim().toLowerCase()
}

// keep only what the person typed above the quoted prompt email
export function extractReply(text, html) {
  let t = text
  if (!t && html) {
    t = String(html)
      .split(/<div[^>]+class="?gmail_quote|<blockquote|<div[^>]+id="?appendonsend|<hr/i)[0]
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
  }
  if (!t) return ''
  t = String(t).replace(/\r/g, '')
  const cut = [
    /\n?On [^\n]{0,200}(\n[^\n]{0,200})?wrote:/i, // gmail / apple mail
    /\n-{2,}\s*Original Message/i,
    /\n_{5,}/, // outlook divider
    /\nFrom: [^\n]+\n(Sent|Date): /i,
    /\n>/,
    /\n-- ?\n/,
    /(^|\n)Sent from my (iPhone|iPad|Galaxy|Samsung|Android|Pixel|phone|mobile)/i,
    /(^|\n)Get Outlook for /i,
  ]
  for (const re of cut) {
    const m = re.exec(t)
    if (m) t = t.slice(0, m.index)
  }
  return t
    .replace(/\[(image|cid):[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

const MIN_PHOTO_BYTES = 12 * 1024 // smaller images are usually signature logos

async function notify(to, subject, lines, link, linkText, headers) {
  const s = await getSettings()
  await sendEmails([{ to, headers, ...T.noticeEmail({ circle: s.circleName, siteUrl: siteUrl(), subject, lines, link, linkText }) }])
}

/**
 * email: { id, from, subject, text, html, messageId, attachments: [{ filename, contentType, size, download: () => Promise<Buffer> }] }
 */
export async function handleInboundEmail(email) {
  if (email.id) {
    const seen = await db.getJSON(`inbound/${email.id}`)
    if (seen) return { result: 'duplicate' }
    await db.setJSON(`inbound/${email.id}`, { at: new Date().toISOString() })
  }

  const s = await getSettings()
  const address = parseAddress(email.from)
  const threading = email.messageId ? { 'In-Reply-To': email.messageId, References: email.messageId } : undefined
  const reSubject = (fallback) => (email.subject ? (/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`) : fallback)

  const player = await playerByEmail(address)
  if (!player) {
    // don't reply to obvious robots
    if (/no-?reply|mailer-daemon|postmaster/i.test(address)) return { result: 'ignored' }
    await notify(
      address,
      reSubject(`hmm, who’s this?`),
      [`this address isn’t part of ${s.circleName} yet, so your photo didn’t go anywhere.`, `if you’re already playing, reply from the email you joined with — or ask whoever invited you to add this address too.`],
      s.joinOpen ? `${siteUrl()}/join?code=${s.inviteCode}` : null,
      'join the circle',
      threading
    )
    return { result: 'unknown sender' }
  }

  const body = extractReply(email.text, email.html)
  const images = (email.attachments || []).filter((a) => looksLikeImage(a.filename, a.contentType))

  if (/^(stop|unsubscribe|pause)\b/i.test(body) && !images.length) {
    await updatePlayer(player.id, { active: false })
    await notify(player.email, reSubject('taking a break'), [`okay ${player.name} — no more prompts for now.`, `whenever you want back in, reply “start” or just send a photo.`], null, null, threading)
    return { result: 'paused player' }
  }
  if (/^(start|resume)\b/i.test(body) && !images.length) {
    await updatePlayer(player.id, { active: true })
    await notify(player.email, reSubject('welcome back'), [`you’re back in, ${player.name} ✦ prompts will come every week again.`], playerLink(player), 'see this week', threading)
    return { result: 'resumed player' }
  }

  if (!images.length) {
    await notify(
      player.email,
      reSubject('no photo found'),
      [`hmm, i couldn’t find a photo in your reply, ${player.name}.`, `try attaching it again (not as a link), or upload it on the web instead.`],
      playerLink(player),
      'upload on the web',
      threading
    )
    return { result: 'no image' }
  }

  // the biggest real photo wins
  const sorted = [...images].sort((a, b) => (b.size || 0) - (a.size || 0))
  const pick = sorted.find((a) => !a.size || a.size >= MIN_PHOTO_BYTES) || sorted[0]

  try {
    const buffer = await pick.download()
    if (!player.active) await updatePlayer(player.id, { active: true })
    const { round, sub, replaced } = await submitPhoto({ player, buffer, contentType: pick.contentType, caption: body, via: 'email' })
    const m = T.confirmEmail({
      circle: s.circleName,
      siteUrl: siteUrl(),
      prompt: round.prompt,
      name: player.name,
      link: playerLink(player),
      caption: sub.caption,
      revealWhen: formatWhen(round.revealAt, s.timezone),
      late: sub.late,
      replaced,
    })
    await sendEmails([{ to: player.email, headers: threading, ...m, subject: reSubject(m.subject) }])
    return { result: replaced ? 'replaced' : 'submitted', playerId: player.id, roundId: round.id }
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'something went wrong saving your photo — try once more, or upload on the web.'
    if (!(e instanceof UserError)) console.error('inbound failed', e)
    await notify(player.email, reSubject('that didn’t work'), [msg], playerLink(player), 'upload on the web', threading)
    return { result: 'error', error: msg }
  }
}
