import { esc, startSky, toast, api, storage } from './common.js'

startSky()
const app = document.getElementById('app')
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const HOURS = Array.from({ length: 24 }, (_, h) => [h, h === 0 ? '12am' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`])

let key = storage('sky-admin') || ''
const call = (path, body) => api(path, { method: body ? 'POST' : 'GET', body, headers: { 'x-admin-key': key } })
let S = null

document.getElementById('logout').onclick = () => {
  storage('sky-admin', null)
  location.reload()
}

function login(msg) {
  app.innerHTML = `<div class="notice"><div class="label"><span class="star">✦</span>admin</div><h1>who goes there?</h1>
    <p>${esc(msg || 'enter your admin key (the ADMIN_KEY you set on Netlify).')}</p>
    <form id="lf" style="max-width:340px;margin:0 auto"><input class="field" type="password" id="k" placeholder="admin key" autofocus>
    <div class="row" style="justify-content:center"><button class="btn">open</button></div></form></div>`
  document.getElementById('lf').onsubmit = (e) => {
    e.preventDefault()
    key = document.getElementById('k').value
    storage('sky-admin', key)
    load()
  }
}

async function load() {
  if (!key) return login()
  try {
    S = await call('/api/admin')
  } catch (e) {
    if (e.status === 401) return login('that key didn’t work.')
    app.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`
    return
  }
  render()
}

const sel = (name, value, options) =>
  `<select class="field" name="${name}">${options.map(([v, l]) => `<option value="${v}" ${+v === +value ? 'selected' : ''}>${l}</option>`).join('')}</select>`

function render() {
  const s = S.settings
  const cur = S.current
  const open = cur && cur.status === 'open'
  const playerName = Object.fromEntries(S.players.map((p) => [p.id, p.name]))
  const active = S.players.filter((p) => p.active).length

  app.innerHTML = `
  <section class="hero small" style="padding-top:4vh">
    <div class="label"><span class="star">✦</span>${esc(s.circleName)} · ${s.paused ? 'paused' : 'running'}</div>
    ${
      cur
        ? `<h1 class="prompt"><span class="q">“</span>${esc(cur.prompt)}<span class="q">”</span></h1>
           <div class="meta"><span>week ${cur.number}</span><span>${cur.submissions.length} of ${active} in</span>
           <span>${open ? `reveal ${esc(cur.revealWhen)}` : 'revealed'}</span>
           ${open && cur.reminderWhen ? `<span>${cur.reminderSent ? 'reminder sent' : `reminder ${esc(cur.reminderWhen)}`}</span>` : ''}
           ${!open && S.nextPromptWhen ? `<span>next prompt ${esc(S.nextPromptWhen)}</span>` : ''}</div>`
        : `<h1 class="prompt">no weeks yet</h1><div class="meta"><span>${s.paused ? 'start the game below, or kick off week 1 right now.' : `first prompt goes out ${esc(S.nextPromptWhen || 'soon')}`}</span></div>`
    }
  </section>

  <div class="grid2">
    <div class="card">
      <h3>${s.paused ? 'the game is paused' : 'the game is running'}</h3>
      <p>${s.paused ? 'nothing goes out automatically while paused.' : esc(S.schedule)}</p>
      <div class="row">
        <button class="btn" id="togglePause">${s.paused ? 'start the weekly schedule' : 'pause everything'}</button>
        ${open ? `<button class="pill quiet" id="reveal">reveal now</button><button class="pill quiet" id="remind">nudge the stragglers</button>` : ''}
      </div>
    </div>
    <div class="card">
      <h3>start a week right now</h3>
      <p>sends a prompt to everyone immediately${open ? ' (and reveals the current week first)' : ''}. leave blank to use the next one in your queue.</p>
      <input class="field" id="customPrompt" placeholder="${esc(S.prompts[0] || 'something blue and old')}">
      <div class="row"><button class="btn" id="startNow">send the prompt ✦</button></div>
    </div>
  </div>

  <section>
    <div class="section-head"><h2>invite friends</h2><span class="aside">${s.joinOpen ? 'anyone with the link can join' : 'joining is closed'}</span></div>
    <div class="card">
      <div class="addr" style="max-width:100%"><span>${esc(S.inviteLink)}</span><button class="pill" id="copyInvite">copy</button></div>
      <div class="row"><button class="linkish" id="toggleJoin">${s.joinOpen ? 'close joining' : 'open joining'}</button><button class="linkish" id="newCode">make a new link (old one stops working)</button></div>
    </div>
  </section>

  <section>
    <div class="section-head"><h2>the circle</h2><span class="aside">${active} getting prompts · ${S.players.length} total</span></div>
    <div class="card">
      <div class="table-wrap"><table>
        <tr><th>name</th><th>email</th><th>status</th><th></th></tr>
        ${S.players
          .map(
            (p) => `<tr>
          <td>${esc(p.name)}</td>
          <td>${esc(p.email)}${p.altEmails?.length ? `<div class="dim" style="font-size:12px">also ${esc(p.altEmails.join(', '))}</div>` : ''}</td>
          <td>${p.active ? '<span class="ok">getting prompts</span>' : '<span class="dim">paused</span>'}</td>
          <td style="white-space:nowrap">
            <button class="linkish" data-copylink="${esc(p.token)}">copy their link</button>
            <button class="linkish" data-welcome="${p.id}">re-send link</button>
            <button class="linkish" data-alt="${p.id}">other emails</button>
            <button class="linkish" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'pause' : 'resume'}</button>
            <button class="linkish" data-remove="${p.id}">remove</button>
          </td></tr>`
          )
          .join('') || '<tr><td colspan="4" class="dim">nobody yet — add yourself first, then send the invite link.</td></tr>'}
      </table></div>
      <form id="addForm" class="form-grid" style="margin-top:8px">
        <label>name<input class="field" name="name" required></label>
        <label>email<input class="field" name="email" type="email" required></label>
        <label style="align-self:end"><button class="btn" style="margin-top:4px">add</button></label>
      </form>
      <label class="check"><input type="checkbox" id="sendWelcome" checked> email them a welcome with their link</label>
    </div>
  </section>

  ${
    cur
      ? `<section>
    <div class="section-head"><h2>week ${cur.number} photos</h2><span class="aside">only you can see these before the reveal</span></div>
    <div class="subs">${
      cur.submissions
        .map(
          (x) => `<figure><img src="/api/photo?k=${encodeURIComponent(x.thumb)}&a=${encodeURIComponent(key)}" alt="">
          <figcaption><b style="color:#fff">${esc(playerName[x.playerId] || '?')}</b> · via ${x.via}${x.late ? ' · late' : ''}<br>${esc(x.caption)}
          <br><button class="linkish" data-delsub="${x.playerId}">remove</button></figcaption></figure>`
        )
        .join('') || '<p class="empty-note">nothing yet.</p>'
    }</div></section>`
      : ''
  }

  <div class="grid2" style="margin-top:56px">
    <div class="card">
      <h3>prompt queue</h3>
      <p>one per line, used top to bottom. when it runs out, prompts come from a built-in list of 52.</p>
      <textarea class="field" id="queue" placeholder="something blue and old">${esc(S.prompts.join('\n'))}</textarea>
      <div class="row"><button class="btn" id="saveQueue">save queue</button><span class="dim" style="font-size:13px">${S.prompts.length} waiting</span></div>
    </div>
    <div class="card">
      <h3>schedule</h3>
      <form id="settingsForm">
        <div class="form-grid">
          <label>circle name<input class="field" name="circleName" value="${esc(s.circleName)}"></label>
          <label>timezone<input class="field" name="timezone" value="${esc(s.timezone)}"></label>
          <label>prompt day${sel('promptDay', s.promptDay, DAYS.map((d, i) => [i, d]))}</label>
          <label>prompt time${sel('promptHour', s.promptHour, HOURS)}</label>
          <label>reveal day${sel('revealDay', s.revealDay, DAYS.map((d, i) => [i, d]))}</label>
          <label>reveal time${sel('revealHour', s.revealHour, HOURS)}</label>
          <label>reminder day${sel('reminderDay', s.reminderDay, DAYS.map((d, i) => [i, d]))}</label>
          <label>reminder time${sel('reminderHour', s.reminderHour, HOURS)}</label>
        </div>
        <label class="check"><input type="checkbox" name="remindersOn" ${s.remindersOn ? 'checked' : ''}> send a reminder to people who haven’t posted</label>
        <div class="row"><button class="btn">save schedule</button></div>
        <p class="dim" style="font-size:12px;margin-top:10px">changes apply from the next week.</p>
      </form>
    </div>
  </div>

  <section>
    <div class="section-head"><h2>email setup</h2><span class="aside">resend.com</span></div>
    <div class="card">
      <p>${S.mail.sending ? '<span class="ok">✓ sending is on</span>' : '<span class="no">✕ sending is off</span> — add RESEND_API_KEY. (locally, emails land in <a href="/dev/outbox">/dev/outbox</a>.)'}</p>
      <p>from: <span style="color:#fff">${esc(S.mail.from)}</span></p>
      <p>${S.mail.replyTo ? `<span class="ok">✓ replies go to</span> <span style="color:#fff">${esc(S.mail.replyTo)}</span>` : '<span class="no">✕ no MAIL_REPLY_TO</span> — friends will upload on the web instead of replying.'}</p>
      <p>${S.mail.webhook ? '<span class="ok">✓ webhook secret set</span>' : '<span class="no">✕ no RESEND_WEBHOOK_SECRET</span>'} — webhook url: <span style="color:#fff">${esc(S.siteUrl)}/api/inbound</span></p>
    </div>
  </section>

  ${
    S.rounds.length
      ? `<section><div class="section-head"><h2>every week</h2></div><div class="card"><div class="table-wrap"><table>
      <tr><th>week</th><th>prompt</th><th>photos</th><th>status</th></tr>
      ${S.rounds.map((r) => `<tr><td>${r.number}</td><td><a href="/?w=${encodeURIComponent(r.id)}">${esc(r.prompt)}</a></td><td>${r.status === 'open' ? '—' : r.count}</td><td>${r.status}</td></tr>`).join('')}
    </table></div></div></section>`
      : ''
  }`

  bind()
}

async function act(fn, ok) {
  try {
    await fn()
    if (ok) toast(ok)
    await load()
  } catch (e) {
    toast(e.message)
  }
}

function bind() {
  const $ = (id) => document.getElementById(id)
  $('togglePause').onclick = () => act(() => call('/api/admin/settings', { paused: !S.settings.paused }), S.settings.paused ? 'running ✦' : 'paused')
  if ($('reveal')) $('reveal').onclick = () => confirm('open the gallery for everyone now?') && act(() => call('/api/admin/reveal', {}), 'revealed ✦')
  if ($('remind')) $('remind').onclick = () => act(async () => toast(`nudged ${(await call('/api/admin/remind', {})).sent} people`))
  $('startNow').onclick = () => {
    const prompt = $('customPrompt').value.trim()
    if (!confirm(`send ${prompt ? `“${prompt}”` : 'the next prompt'} to everyone now?`)) return
    act(() => call('/api/admin/start', { prompt }), 'prompt sent ✦')
  }
  $('copyInvite').onclick = () => navigator.clipboard.writeText(S.inviteLink).then(() => toast('invite link copied'))
  $('toggleJoin').onclick = () => act(() => call('/api/admin/settings', { joinOpen: !S.settings.joinOpen }))
  $('newCode').onclick = () => confirm('make a new invite link? the old one stops working.') && act(() => call('/api/admin/settings', { newInviteCode: true }), 'new link made')

  document.querySelectorAll('[data-copylink]').forEach((b) => (b.onclick = () => navigator.clipboard.writeText(`${S.siteUrl}/?me=${b.dataset.copylink}`).then(() => toast('their link is copied — it’s private to them'))))
  document.querySelectorAll('[data-welcome]').forEach((b) => (b.onclick = () => act(() => call('/api/admin/player/welcome', { id: b.dataset.welcome }), 'sent')))
  document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => act(() => call('/api/admin/player', { id: b.dataset.toggle, active: b.dataset.active !== 'true' }))))
  document.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => confirm('remove them from the circle? their old photos stay in past weeks.') && act(() => call('/api/admin/player/remove', { id: b.dataset.remove }), 'removed')))
  document.querySelectorAll('[data-alt]').forEach(
    (b) =>
      (b.onclick = () => {
        const p = S.players.find((x) => x.id === b.dataset.alt)
        const v = prompt(`other addresses ${p.name} might reply from (comma separated):`, (p.altEmails || []).join(', '))
        if (v !== null) act(() => call('/api/admin/player', { id: p.id, altEmails: v }), 'saved')
      })
  )
  document.querySelectorAll('[data-delsub]').forEach((b) => (b.onclick = () => confirm('remove this photo?') && act(() => call('/api/admin/submission/remove', { roundId: S.current.id, playerId: b.dataset.delsub }), 'removed')))

  $('addForm').onsubmit = (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    act(() => call('/api/admin/player', { name: fd.get('name'), email: fd.get('email'), sendWelcome: $('sendWelcome').checked }), 'added ✦')
  }
  $('saveQueue').onclick = () => act(() => call('/api/admin/prompts', { prompts: $('queue').value.split('\n') }), 'queue saved')
  $('settingsForm').onsubmit = (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const body = Object.fromEntries(fd.entries())
    body.remindersOn = fd.has('remindersOn')
    act(() => call('/api/admin/settings', body), 'schedule saved')
  }
}

load()
