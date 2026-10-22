// The game: players, weekly rounds, submissions, reveal, and the hourly tick that runs it all.
import crypto from 'node:crypto'
import * as db from './store.mjs'
import { sendEmails, mailConfig } from './mail.mjs'
import * as T from './emails.mjs'
import { PROMPT_BANK } from './prompts.mjs'
import { nextOccurrence, formatWhen, localDateId, DAY_NAMES } from './time.mjs'
import { processImage } from './images.mjs'

export const APP_NAME = 'look club'

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const newToken = () => crypto.randomBytes(18).toString('base64url')
const newId = () => crypto.randomBytes(5).toString('hex')
const normEmail = (e) => String(e || '').trim().toLowerCase()

export const siteUrl = () => (process.env.SITE_URL || process.env.URL || 'http://localhost:8888').replace(/\/$/, '')
export const playerLink = (p, roundId) => `${siteUrl()}/?me=${p.token}${roundId ? `&w=${roundId}` : ''}`

// ---------- settings ----------

const DEFAULTS = {
  circleName: APP_NAME,
  timezone: 'America/Vancouver',
  promptDay: 4,
  promptHour: 12,
  remindersOn: true,
  reminderDay: 2,
  reminderHour: 18,
  revealDay: 3,
  revealHour: 20,
  paused: true,
  armedAt: null,
  joinOpen: true,
  inviteCode: null,
}

export async function getSettings() {
  let s = await db.getJSON('settings')
  if (!s || !s.inviteCode) {
    s = { ...DEFAULTS, ...s, inviteCode: newToken().slice(0, 10) }
    await db.setJSON('settings', s)
  }
  return { ...DEFAULTS, ...s }
}

export async function saveSettings(patch) {
  const s = await getSettings()
  const next = { ...s }
  const hour = (v) => Math.min(23, Math.max(0, parseInt(v, 10) || 0))
  const day = (v) => Math.min(6, Math.max(0, parseInt(v, 10) || 0))
  if ('circleName' in patch) next.circleName = String(patch.circleName).trim().slice(0, 60) || APP_NAME
  if ('timezone' in patch) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone })
      next.timezone = patch.timezone
    } catch {
      throw new UserError('that timezone isn’t one i know (try something like America/Vancouver)')
    }
  }
  for (const k of ['promptDay', 'reminderDay', 'revealDay']) if (k in patch) next[k] = day(patch[k])
  for (const k of ['promptHour', 'reminderHour', 'revealHour']) if (k in patch) next[k] = hour(patch[k])
  for (const k of ['remindersOn', 'joinOpen']) if (k in patch) next[k] = !!patch[k]
  if ('paused' in patch) {
    next.paused = !!patch.paused
    if (s.paused && !next.paused) next.armedAt = new Date().toISOString()
  }
  if (patch.newInviteCode) next.inviteCode = newToken().slice(0, 10)
  await db.setJSON('settings', next)
  return next
}

const hourLabel = (h) => (h === 0 ? '12am' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`)

export function scheduleLine(s) {
  return `every ${DAY_NAMES[s.promptDay]} at ${hourLabel(s.promptHour)} you’ll get one prompt by email. reply with a photo (or upload on the site). on ${DAY_NAMES[s.revealDay]} at ${hourLabel(s.revealHour)} the gallery opens and everyone’s photos appear at once.`
}

// ---------- players ----------

export async function getPlayers() {
  return db.getJSON('players', [])
}

async function savePlayers(players) {
  await db.setJSON('players', players)
}

export async function addPlayer({ name, email }, { sendWelcome = true } = {}) {
  name = String(name || '').trim().slice(0, 40)
  email = normEmail(email)
  if (!name) throw new UserError('add a name so friends know whose photo is whose')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('that email doesn’t look right')
  const players = await getPlayers()
  let player = players.find((p) => p.email === email || (p.altEmails || []).includes(email))
  let created = false
  if (!player) {
    player = { id: newId(), name, email, altEmails: [], token: newToken(), active: true, joinedAt: new Date().toISOString() }
    players.push(player)
    created = true
  } else {
    player.active = true
  }
  await savePlayers(players)
  if (sendWelcome) await sendWelcomeEmail(player)
  return { player, created }
}

export async function sendWelcomeEmail(player) {
  const s = await getSettings()
  const m = T.welcomeEmail({
    circle: s.circleName,
    siteUrl: siteUrl(),
    name: player.name,
    link: playerLink(player),
    scheduleLine: scheduleLine(s),
  })
  await sendEmails([{ to: player.email, ...m }])
}

export async function updatePlayer(id, patch) {
  const players = await getPlayers()
  const p = players.find((x) => x.id === id)
  if (!p) throw new UserError('no such player', 404)
  if ('name' in patch) p.name = String(patch.name).trim().slice(0, 40) || p.name
  if ('active' in patch) p.active = !!patch.active
  if ('altEmails' in patch)
    p.altEmails = String(patch.altEmails)
      .split(/[\s,]+/)
      .map(normEmail)
      .filter((e) => e.includes('@'))
  if (patch.newToken) p.token = newToken()
  await savePlayers(players)
  return p
}

export async function removePlayer(id) {
  const players = await getPlayers()
  await savePlayers(players.filter((p) => p.id !== id))
}

export async function playerByToken(token) {
  if (!token) return null
  const players = await getPlayers()
  return players.find((p) => p.token === token) || null
}

export async function playerByEmail(email) {
  email = normEmail(email)
  const players = await getPlayers()
  return players.find((p) => p.email === email || (p.altEmails || []).includes(email)) || null
}

// ---------- prompts ----------

export async function getPromptQueue() {
  return db.getJSON('prompts', [])
}

export async function savePromptQueue(list) {
  const clean = list.map((t) => String(t).trim()).filter(Boolean).slice(0, 200)
  await db.setJSON('prompts', clean)
  return clean
}

async function takeNextPrompt() {
  const queue = await getPromptQueue()
  if (queue.length) {
    const next = queue.shift()
    await savePromptQueue(queue)
    return next
  }
  const used = new Set((await allRounds()).map((r) => r.prompt.toLowerCase()))
  const fresh = PROMPT_BANK.filter((p) => !used.has(p.toLowerCase()))
  const pool = fresh.length ? fresh : PROMPT_BANK
  return fresh.length ? pool[0] : pool[Math.floor(Math.random() * pool.length)]
}

// ---------- rounds ----------

export async function roundIds() {
  return db.getJSON('rounds', [])
}

export async function getRound(id) {
  return id ? db.getJSON(`round/${id}`) : null
}

async function saveRound(r) {
  await db.setJSON(`round/${r.id}`, r)
}

export async function currentRound() {
  const ids = await roundIds()
  return getRound(ids[ids.length - 1])
}

async function allRounds() {
  const ids = await roundIds()
  return (await Promise.all(ids.map(getRound))).filter(Boolean)
}

export async function getSubmissions(roundId) {
  const keys = await db.listKeys(`sub/${roundId}/`)
  const subs = await Promise.all(keys.map((k) => db.getJSON(k)))
  return subs.filter(Boolean).sort((a, b) => a.at.localeCompare(b.at))
}

export async function nextPromptAt(now = new Date()) {
  const s = await getSettings()
  if (s.paused) return null
  const cur = await currentRound()
  if (cur && cur.status === 'open') return null
  const after = new Date(Math.max(cur ? Date.parse(cur.startAt) + 3600e3 : 0, Date.parse(s.armedAt || now.toISOString())))
  return nextOccurrence(after, s.promptDay, s.promptHour, s.timezone)
}

export async function startRound({ prompt, now = new Date() } = {}) {
  const s = await getSettings()
  const cur = await currentRound()
  if (cur && cur.status === 'open') await revealRound(cur, { now })
  const ids = await roundIds()
  const number = ids.length + 1
  const text = String(prompt || '').trim().slice(0, 140) || (await takeNextPrompt())
  const revealAt = nextOccurrence(now, s.revealDay, s.revealHour, s.timezone)
  let reminderAt = s.remindersOn ? nextOccurrence(now, s.reminderDay, s.reminderHour, s.timezone) : null
  if (reminderAt && reminderAt >= revealAt) reminderAt = null
  const round = {
    id: `${localDateId(now, s.timezone)}-w${number}`,
    number,
    prompt: text,
    startAt: now.toISOString(),
    reminderAt: reminderAt && reminderAt.toISOString(),
    revealAt: revealAt.toISOString(),
    status: 'open',
    reminderSent: false,
    revealedAt: null,
    count: 0,
    covers: [],
  }
  await saveRound(round)
  await db.setJSON('rounds', [...ids, round.id])

  const canReply = !!mailConfig().replyTo
  const players = (await getPlayers()).filter((p) => p.active)
  const revealWhen = formatWhen(round.revealAt, s.timezone)
  await sendEmails(
    players.map((p) => ({
      to: p.email,
      ...T.promptEmail({
        circle: s.circleName,
        siteUrl: siteUrl(),
        number,
        prompt: text,
        name: p.name,
        link: playerLink(p),
        revealWhen,
        canReply,
      }),
    }))
  )
  return round
}

export async function sendReminders(round) {
  const s = await getSettings()
  const subs = await getSubmissions(round.id)
  const done = new Set(subs.map((x) => x.playerId))
  const players = (await getPlayers()).filter((p) => p.active && !done.has(p.id))
  const canReply = !!mailConfig().replyTo
  const revealWhen = formatWhen(round.revealAt, s.timezone)
  await sendEmails(
    players.map((p) => ({
      to: p.email,
      ...T.reminderEmail({ circle: s.circleName, siteUrl: siteUrl(), number: round.number, prompt: round.prompt, name: p.name, link: playerLink(p), revealWhen, canReply }),
    }))
  )
  round.reminderSent = true
  await saveRound(round)
  return players.length
}

async function refreshSummary(round) {
  const subs = await getSubmissions(round.id)
  round.count = subs.length
  round.covers = subs.slice(0, 4).map((x) => x.thumb)
  await saveRound(round)
  return subs
}

export async function revealRound(round, { now = new Date() } = {}) {
  if (round.status === 'revealed') return round
  const s = await getSettings()
  round.status = 'revealed'
  round.revealedAt = now.toISOString()
  const subs = await refreshSummary(round)
  const players = (await getPlayers()).filter((p) => p.active)
  await sendEmails(
    players.map((p) => ({
      to: p.email,
      ...T.revealEmail({ circle: s.circleName, siteUrl: siteUrl(), number: round.number, prompt: round.prompt, name: p.name, link: playerLink(p, round.id), count: subs.length }),
    }))
  )
  return round
}

// Runs every hour (and on demand). Safe to call as often as you like.
export async function tick(now = new Date()) {
  const s = await getSettings()
  if (s.paused) return { did: 'nothing (paused)' }
  const cur = await currentRound()
  if (cur && cur.status === 'open') {
    const did = []
    if (!cur.reminderSent && cur.reminderAt && now >= new Date(cur.reminderAt)) {
      await sendReminders(cur)
      did.push('reminded')
    }
    if (now >= new Date(cur.revealAt)) {
      await revealRound(cur, { now })
      did.push('revealed')
    }
    return { did: did.join(', ') || 'nothing (round open)' }
  }
  const next = await nextPromptAt(now)
  if (next && now >= next) {
    const r = await startRound({ now })
    return { did: `started week ${r.number}` }
  }
  return { did: 'nothing (waiting)', next }
}

// ---------- submissions ----------

export async function submitPhoto({ player, buffer, contentType, caption = '', via }) {
  const round = await currentRound()
  if (!round) throw new UserError('there’s no prompt running yet — hang tight for the first one')
  if (!buffer || !buffer.length) throw new UserError('that photo came through empty')
  if (buffer.length > 25 * 1024 * 1024) throw new UserError('that photo is a bit too big (25mb max)')

  const processed = await processImage(buffer)
  const base = `p/${round.id}/${player.id}/${Date.now().toString(36)}`
  let photo, thumb, width = null, height = null
  if (processed) {
    photo = `${base}.jpg`
    thumb = `${base}-t.jpg`
    width = processed.width
    height = processed.height
    await db.putPhoto(photo, processed.full, 'image/jpeg')
    await db.putPhoto(thumb, processed.thumb, 'image/jpeg')
  } else {
    photo = thumb = `${base}.orig`
    await db.putPhoto(photo, buffer, contentType || 'application/octet-stream')
  }

  const key = `sub/${round.id}/${player.id}`
  const prev = await db.getJSON(key)
  if (prev) await deletePhotos(prev)
  const sub = {
    playerId: player.id,
    roundId: round.id,
    photo,
    thumb,
    width,
    height,
    caption: String(caption || '').trim().slice(0, 280),
    via,
    at: new Date().toISOString(),
    late: round.status === 'revealed',
  }
  await db.setJSON(key, sub)
  if (round.status === 'revealed') await refreshSummary(round)
  return { round, sub, replaced: !!prev }
}

async function deletePhotos(sub) {
  await db.deletePhoto(sub.photo)
  if (sub.thumb !== sub.photo) await db.deletePhoto(sub.thumb)
}

export async function removeSubmission(roundId, playerId) {
  const key = `sub/${roundId}/${playerId}`
  const sub = await db.getJSON(key)
  if (!sub) return
  await deletePhotos(sub)
  await db.del(key)
  const round = await getRound(roundId)
  if (round?.status === 'revealed') await refreshSummary(round)
}

// for test runs: the week, its photos and its stars disappear (the next week reuses its number)
export async function deleteRound(roundId) {
  const ids = await roundIds()
  if (!ids.includes(roundId)) throw new UserError('no such week', 404)
  for (const sub of await getSubmissions(roundId)) await removeSubmission(roundId, sub.playerId)
  await db.del(`stars/${roundId}`)
  await db.del(`round/${roundId}`)
  await db.setJSON('rounds', ids.filter((id) => id !== roundId))
}

export async function setCaption(player, caption) {
  const round = await currentRound()
  const key = `sub/${round?.id}/${player.id}`
  const sub = round && (await db.getJSON(key))
  if (!sub) throw new UserError('add a photo first')
  sub.caption = String(caption || '').trim().slice(0, 280)
  await db.setJSON(key, sub)
  return sub
}

// who may see a photo key: its owner always, everyone once that week is revealed
export async function canSeePhoto(key, player) {
  const m = /^p\/([^/]+)\/([^/]+)\//.exec(key)
  if (!m) return false
  if (player.id === m[2]) return true
  const round = await getRound(m[1])
  return round?.status === 'revealed'
}

// ---------- reactions ----------

export async function toggleStar(player, roundId, targetId) {
  const round = await getRound(roundId)
  if (!round || round.status !== 'revealed') throw new UserError('stars open with the gallery')
  const key = `stars/${roundId}`
  const stars = await db.getJSON(key, {})
  const list = new Set(stars[targetId] || [])
  list.has(player.id) ? list.delete(player.id) : list.add(player.id)
  stars[targetId] = [...list]
  await db.setJSON(key, stars)
  return stars[targetId]
}

// ---------- views ----------

export async function viewFor(player, roundId) {
  const s = await getSettings()
  const ids = await roundIds()
  const current = await currentRound()
  const round = roundId && ids.includes(roundId) ? await getRound(roundId) : current
  const players = await getPlayers()
  const names = Object.fromEntries(players.map((p) => [p.id, p.name]))

  let week = null
  if (round) {
    const subs = await getSubmissions(round.id)
    const revealed = round.status === 'revealed'
    const stars = revealed ? await db.getJSON(`stars/${round.id}`, {}) : {}
    const submittedIds = new Set(subs.map((x) => x.playerId))
    const circle = players
      .filter((p) => p.active || submittedIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, done: submittedIds.has(p.id) }))
    week = {
      id: round.id,
      number: round.number,
      prompt: round.prompt,
      startAt: round.startAt,
      revealAt: round.revealAt,
      revealWhen: formatWhen(round.revealAt, s.timezone),
      revealed,
      isCurrent: round.id === current?.id,
      circle,
      mine: subs.find((x) => x.playerId === player.id) || null,
      photos: revealed
        ? subs.map((x) => ({
            playerId: x.playerId,
            name: names[x.playerId] || 'someone',
            photo: x.photo,
            thumb: x.thumb,
            width: x.width,
            height: x.height,
            caption: x.caption,
            late: x.late,
            stars: (stars[x.playerId] || []).length,
            starredByMe: (stars[x.playerId] || []).includes(player.id),
          }))
        : [],
    }
  }

  const past = (await allRounds())
    .filter((r) => r.status === 'revealed')
    .reverse()
    .map((r) => ({ id: r.id, number: r.number, prompt: r.prompt, count: r.count, covers: r.covers }))

  const next = await nextPromptAt()
  return {
    circleName: s.circleName,
    me: { id: player.id, name: player.name, email: player.email, active: player.active },
    replyTo: mailConfig().replyTo || null,
    schedule: scheduleLine(s),
    nextPromptWhen: next ? formatWhen(next, s.timezone) : null,
    paused: s.paused,
    week,
    past,
  }
}

export async function adminView() {
  const s = await getSettings()
  const cfg = mailConfig()
  const cur = await currentRound()
  const next = await nextPromptAt()
  const rounds = (await allRounds()).reverse().map((r) => ({ id: r.id, number: r.number, prompt: r.prompt, status: r.status, count: r.count, revealAt: r.revealAt, startAt: r.startAt }))
  let current = null
  if (cur) {
    const subs = await getSubmissions(cur.id)
    current = { ...cur, revealWhen: formatWhen(cur.revealAt, s.timezone), reminderWhen: cur.reminderAt && formatWhen(cur.reminderAt, s.timezone), submissions: subs }
  }
  return {
    settings: s,
    siteUrl: siteUrl(),
    inviteLink: `${siteUrl()}/join?code=${s.inviteCode}`,
    mail: { sending: !!cfg.apiKey, from: cfg.from, replyTo: cfg.replyTo, webhook: !!cfg.webhookSecret },
    players: await getPlayers(),
    prompts: await getPromptQueue(),
    current,
    rounds,
    nextPromptWhen: next ? formatWhen(next, s.timezone) : null,
    schedule: scheduleLine(s),
  }
}
