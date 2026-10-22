import { esc, startSky, startCursor, toast, api, storage } from './common.js'

startSky()
startCursor()

const $ = (s) => document.querySelector(s)
const app = $('#app')

// your personal link (?me=...) is remembered so the plain address works next time
const params = new URLSearchParams(location.search)
if (params.get('me')) {
  storage('sky-token', params.get('me'))
  params.delete('me')
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''))
}
const token = storage('sky-token')
const photoUrl = (key) => `/api/photo?k=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`
const call = (path, opts = {}) => api(path, { ...opts, headers: { 'x-token': token || '' } })

let state = null
let countdownTimer = null

async function load() {
  if (!token) return renderOutsider()
  const w = new URLSearchParams(location.search).get('w')
  try {
    state = await call(`/api/me${w ? `?w=${encodeURIComponent(w)}` : ''}`)
  } catch (e) {
    if (e.status === 401) {
      storage('sky-token', null)
      return renderOutsider(true)
    }
    app.innerHTML = `<div class="notice"><h1>clouds</h1><p>${esc(e.message)}</p></div>`
    return
  }
  render()
}

function go(w) {
  history.pushState(null, '', w ? `/?w=${encodeURIComponent(w)}` : '/')
  load().then(() => scrollTo({ top: 0, behavior: 'smooth' }))
}
addEventListener('popstate', load)

// ---------- outsiders ----------

function renderOutsider(expired) {
  $('#topRight').innerHTML = ''
  app.innerHTML = `
    <div class="notice">
      <div class="label"><span class="star">✦</span>a private sky</div>
      <h1>this gallery is just for the circle</h1>
      <p>${expired ? 'that link doesn’t work anymore. ' : ''}open the personal link from your welcome email (or any prompt email) and you’ll land right here.</p>
      <p>new? ask whoever invited you for the invite link.</p>
    </div>`
}

// ---------- main ----------

function render() {
  const { week } = state
  document.title = week ? `${week.prompt} · ${state.circleName}` : state.circleName
  $('#logo').innerHTML = `<span class="spark">✦</span>${esc(state.circleName)}`
  renderTop()

  if (!week) {
    app.innerHTML = `
      <section class="hero">
        <div class="label"><span class="star">✦</span>welcome, ${esc(state.me.name)}</div>
        <h1 class="prompt">the first prompt is on its way</h1>
        <div class="meta"><span>${state.nextPromptWhen ? `it lands ${esc(state.nextPromptWhen)}.` : 'it lands as soon as the game starts.'}</span></div>
      </section>
      <section><div class="card how"><h3>how it works</h3><p>${esc(state.schedule)}</p></div></section>
      ${renderPast()}`
    return
  }

  const viewingPast = !week.isCurrent
  app.innerHTML = `
    <section class="hero ${week.revealed ? 'small' : ''}">
      <div class="label"><span class="star">✦</span>week ${week.number} · ${viewingPast ? 'from the archive' : week.revealed ? 'the gallery is open' : 'this week’s prompt'}</div>
      <h1 class="prompt"><span class="q">“</span>${esc(week.prompt)}<span class="q">”</span></h1>
      <div class="meta">${heroMeta(week)}</div>
    </section>
    ${week.revealed ? '' : renderCircle(week)}
    ${!viewingPast ? renderMine(week) : ''}
    ${week.revealed ? renderGallery(week) : renderSealed(week)}
    ${renderPast(week.id)}`

  bind()
  startCountdown(week)
}

function renderTop() {
  const me = state.me
  $('#topRight').innerHTML = `
    ${state.week && !state.week.isCurrent ? `<button class="pill quiet" data-go="" data-cursor="this week">← this week</button>` : ''}
    <button class="pill" id="meBtn" data-cursor="you">${esc(me.name)}${me.active ? '' : ' · paused'}</button>`
  $('#menu').innerHTML = `
    <div class="small">signed in as ${esc(me.email)}</div>
    <button data-act="${me.active ? 'pause' : 'resume'}">${me.active ? 'pause my weekly prompts' : 'resume my weekly prompts'}</button>
    <button data-act="how">how this works</button>
    <button data-act="forget">forget me on this device</button>`
  $('#meBtn').onclick = (e) => {
    e.stopPropagation()
    $('#menu').classList.toggle('open')
  }
  $('#menu').onclick = async (e) => {
    const act = e.target.dataset.act
    if (!act) return
    $('#menu').classList.remove('open')
    if (act === 'pause' || act === 'resume') {
      await call('/api/pause', { method: 'POST', body: { active: act === 'resume' } })
      toast(act === 'pause' ? 'prompts paused — come back any time' : 'welcome back ✦')
      load()
    }
    if (act === 'how') toast(state.schedule.split('. ')[0] + '.')
    if (act === 'forget') {
      storage('sky-token', null)
      location.href = '/'
    }
  }
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)))
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu')) $('#menu').classList.remove('open')
})

function heroMeta(week) {
  if (!week.isCurrent) return `<span>${week.photos.length} ${week.photos.length === 1 ? 'photo' : 'photos'}</span>`
  if (week.revealed)
    return `<span>${week.photos.length} of you went looking.</span>${state.nextPromptWhen ? `<span>next prompt ${esc(state.nextPromptWhen)}</span>` : ''}`
  return `<span>the gallery opens ${esc(week.revealWhen)}</span><span class="countdown" id="countdown"></span>`
}

function startCountdown(week) {
  clearInterval(countdownTimer)
  const el = $('#countdown')
  if (!el) return
  const tick = () => {
    const ms = Date.parse(week.revealAt) - Date.now()
    if (ms <= 0) {
      el.textContent = 'any moment now ✦'
      clearInterval(countdownTimer)
      return
    }
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1000)
    el.textContent = `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  }
  tick()
  countdownTimer = setInterval(tick, 1000)
}

function renderCircle(week) {
  const done = week.circle.filter((f) => f.done).length
  return `
    <section>
      <div class="section-head"><h2>who’s found theirs</h2><span class="aside">${done} of ${week.circle.length}</span></div>
      <div class="circle">
        ${week.circle
          .map(
            (f) => `<div class="friend ${f.done ? 'done' : ''}" title="${esc(f.name)}${f.done ? ' found theirs' : ' is still looking'}">
              <div class="bubble">${esc(f.name.trim()[0]?.toLowerCase() || '?')}</div>${esc(f.name)}</div>`
          )
          .join('')}
      </div>
    </section>`
}

function renderMine(week) {
  const mine = week.mine
  if (mine) {
    return `
      <section>
        <div class="section-head"><h2>yours</h2><span class="aside">${week.revealed ? 'in the gallery' : 'only you can see this until the reveal'}</span></div>
        <div class="card mine">
          <img src="${photoUrl(mine.thumb)}" alt="your photo">
          <div>
            <h3>you found it ✦</h3>
            <p>${week.revealed ? 'it’s in the gallery below.' : `it stays hidden until ${esc(week.revealWhen)}.`}</p>
            <input class="field" id="capEdit" maxlength="280" placeholder="add a caption (optional)" value="${esc(mine.caption)}">
            <div class="row">
              <button class="btn" id="saveCap" data-cursor="save">save caption</button>
              <label class="pill quiet" data-cursor="swap" style="position:relative;overflow:hidden">swap photo<input type="file" accept="image/*" id="swapFile" style="position:absolute;inset:0;opacity:0"></label>
              <button class="linkish" id="removeMine">take it back</button>
            </div>
          </div>
        </div>
      </section>`
  }
  const late = week.revealed
  return `
    <section>
      <div class="section-head"><h2>${late ? 'add yours (late is fine)' : 'your turn'}</h2><span class="aside">one photo · any camera</span></div>
      <div class="card submit-grid">
        <div class="how">
          <h3>go looking</h3>
          <ol>
            <li>find “${esc(week.prompt)}” out in the world — however you read it.</li>
            ${state.replyTo ? `<li>reply to the prompt email with your photo. whatever you write becomes the caption.</li>` : ''}
            <li>${state.replyTo ? 'or drop it here.' : 'drop it here.'} ${late ? 'it goes straight into the gallery.' : 'nobody sees it until the reveal.'}</li>
          </ol>
          ${state.replyTo ? `<div class="addr" style="margin-top:6px"><span>${esc(state.replyTo)}</span><button class="pill" data-copy="${esc(state.replyTo)}" data-cursor="copy">copy</button></div>` : ''}
        </div>
        <form id="uploadForm">
          <label class="drop" id="drop" data-cursor="choose a photo">
            <input type="file" accept="image/*" id="file">
            <div><span class="big-star">✦</span>drop a photo or tap to choose<div class="hint">jpg, png, heic — we’ll resize it</div></div>
          </label>
          <input class="field" id="caption" maxlength="280" placeholder="a caption, if you want">
          <div class="row"><button class="btn big" id="send" disabled data-cursor="send it">send it up ✦</button></div>
        </form>
      </div>
    </section>`
}

function renderSealed(week) {
  const done = week.circle.filter((f) => f.done && f.id !== state.me.id)
  const waiting = week.circle.filter((f) => !f.done && f.id !== state.me.id)
  if (!done.length && !waiting.length) return ''
  return `
    <section>
      <div class="section-head"><h2>the gallery</h2><span class="aside">sealed until ${esc(week.revealWhen)}</span></div>
      <div class="sealed-grid">
        ${done.map((f) => `<div class="sealed"><span class="s">✦</span><span class="who">${esc(f.name)}</span>sealed</div>`).join('')}
        ${waiting.map((f) => `<div class="sealed empty"><span class="s">✦</span>${esc(f.name)}<span>still looking</span></div>`).join('')}
      </div>
    </section>`
}

function renderGallery(week) {
  if (!week.photos.length) return `<section><p class="empty-note">nobody went looking this week. the sky was empty.</p></section>`
  return `
    <section>
      <div class="section-head"><h2>how everyone saw it</h2><span class="aside">${matchMedia('(hover: none)').matches ? 'tap a photo for its caption' : 'hover a photo for its caption'}</span></div>
      <div class="gallery">
        ${week.photos
          .map(
            (p, i) => `
          <figure class="shot" style="animation-delay:${Math.min(i, 12) * 90}ms">
            <button class="frame" data-open="${i}" data-cursor="look closer" aria-label="open ${esc(p.name)}’s photo">
              <img src="${photoUrl(p.thumb)}" alt="${esc(p.caption || `${p.name}’s photo`)}" loading="lazy" ${p.width ? `width="${p.width}" height="${p.height}"` : ''}>
              ${p.caption ? `<span class="has-cap" aria-hidden="true">“</span><span class="overlay"><span class="cap">${esc(p.caption)}</span></span>` : ''}
            </button>
            <figcaption>
              <div><span class="who">${esc(p.name)}</span>${p.late ? '<span class="tag">late</span>' : ''}</div>
              <button class="star-btn ${p.starredByMe ? 'on' : ''}" data-star="${esc(p.playerId)}" data-cursor="${p.starredByMe ? 'unstar' : 'star it'}" aria-label="star"><span class="s">✦</span><span class="n">${p.stars || ''}</span></button>
            </figcaption>
          </figure>`
          )
          .join('')}
      </div>
    </section>`
}

function renderPast(currentId) {
  const past = (state.past || []).filter((r) => r.id !== currentId)
  if (!past.length) return ''
  return `
    <section>
      <div class="section-head"><h2>past skies</h2><span class="aside">${past.length} ${past.length === 1 ? 'week' : 'weeks'}</span></div>
      <div class="past">
        ${past
          .map((r) => {
            const covers = r.covers || []
            const tiles = covers.length === 1 ? [covers[0]] : [0, 1, 2, 3].map((i) => covers[i])
            return `<a href="/?w=${encodeURIComponent(r.id)}" data-week="${esc(r.id)}" data-cursor="open week ${r.number}">
              <div class="mosaic ${covers.length === 1 ? 'one' : ''}">${tiles.map((c) => (c ? `<img src="${photoUrl(c)}" alt="" loading="lazy">` : '<span></span>')).join('')}</div>
              <div class="p">“${esc(r.prompt)}”</div>
              <div class="n">week ${r.number} · ${r.count} ${r.count === 1 ? 'photo' : 'photos'}</div>
            </a>`
          })
          .join('')}
      </div>
    </section>`
}

// ---------- interactions ----------

function bind() {
  document.querySelectorAll('[data-week]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      go(a.dataset.week)
    })
  )
  document.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy)
        toast('copied ✦')
      } catch {
        toast(b.dataset.copy)
      }
    })
  )
  // with a mouse the caption shows on hover; on touch, the first tap shows it and the second opens the photo
  const touch = matchMedia('(hover: none)').matches
  document.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const shot = b.closest('.shot')
      if (touch && b.querySelector('.overlay') && !shot.classList.contains('show-cap')) {
        document.querySelectorAll('.shot.show-cap').forEach((s) => s.classList.remove('show-cap'))
        shot.classList.add('show-cap')
        return
      }
      openLightbox(+b.dataset.open)
    })
  )
  document.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => star(b)))

  const file = $('#file')
  if (file) {
    const drop = $('#drop')
    let chosen = null
    const pick = (f) => {
      if (!f) return
      chosen = f
      drop.querySelector('img.preview')?.remove()
      const img = document.createElement('img')
      img.className = 'preview'
      img.src = URL.createObjectURL(f)
      img.onerror = () => img.remove() // e.g. heic in chrome: no preview, still uploads
      drop.appendChild(img)
      $('#send').disabled = false
    }
    file.onchange = () => pick(file.files[0])
    drop.addEventListener('dragover', (e) => {
      e.preventDefault()
      drop.classList.add('over')
    })
    drop.addEventListener('dragleave', () => drop.classList.remove('over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('over')
      pick(e.dataTransfer.files[0])
    })
    $('#uploadForm').onsubmit = async (e) => {
      e.preventDefault()
      if (chosen) await upload(chosen, $('#caption').value, $('#send'))
    }
  }

  const swap = $('#swapFile')
  if (swap) swap.onchange = () => swap.files[0] && upload(swap.files[0], $('#capEdit').value, null)
  const saveCap = $('#saveCap')
  if (saveCap)
    saveCap.onclick = async () => {
      await call('/api/caption', { method: 'POST', body: { caption: $('#capEdit').value } })
      toast('caption saved')
    }
  const removeMine = $('#removeMine')
  if (removeMine)
    removeMine.onclick = async () => {
      if (!confirm('take your photo back out?')) return
      await call('/api/remove', { method: 'POST' })
      toast('taken back')
      load()
    }
}

// shrink big photos in the browser first so uploads are quick
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const max = 2200
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file // the server can usually still read it
  }
}

async function upload(file, caption, button) {
  if (button) {
    button.disabled = true
    button.textContent = 'sending it up…'
  } else toast('sending it up…')
  try {
    const form = new FormData()
    form.append('photo', await shrink(file))
    form.append('caption', caption || '')
    const res = await call('/api/upload', { method: 'POST', body: form })
    toast(res.replaced ? 'swapped ✦' : 'it’s in ✦')
    await load()
  } catch (e) {
    toast(e.message)
    if (button) {
      button.disabled = false
      button.textContent = 'send it up ✦'
    }
  }
}

async function star(b) {
  const res = await call('/api/star', { method: 'POST', body: { roundId: state.week.id, playerId: b.dataset.star } })
  const p = state.week.photos.find((x) => x.playerId === b.dataset.star)
  p.stars = res.stars
  p.starredByMe = res.starredByMe
  b.classList.toggle('on', res.starredByMe)
  b.dataset.cursor = res.starredByMe ? 'unstar' : 'star it'
  b.querySelector('.n').textContent = res.stars || ''
  b.classList.remove('pop')
  void b.offsetWidth
  if (res.starredByMe) b.classList.add('pop')
}

// ---------- lightbox ----------

const lb = $('#lightbox')
let lbIndex = 0
function openLightbox(i) {
  lbIndex = i
  showLightbox()
  lb.classList.add('open')
  lb.setAttribute('aria-hidden', 'false')
}
function showLightbox() {
  const photos = state.week.photos
  const p = photos[(lbIndex + photos.length) % photos.length]
  lb.querySelector('img').src = photoUrl(p.photo)
  lb.querySelector('img').alt = p.caption || `${p.name}’s photo`
  lb.querySelector('.who').textContent = p.name
  lb.querySelector('.cap').textContent = p.caption || ''
}
function closeLightbox() {
  lb.classList.remove('open')
  lb.setAttribute('aria-hidden', 'true')
}
const step = (d) => {
  lbIndex = (lbIndex + d + state.week.photos.length) % state.week.photos.length
  showLightbox()
}
lb.querySelector('.lb-close').onclick = closeLightbox
lb.querySelector('.lb-prev').onclick = () => step(-1)
lb.querySelector('.lb-next').onclick = () => step(1)
lb.addEventListener('click', (e) => {
  if (e.target === lb || e.target.classList.contains('stage')) closeLightbox()
})
addEventListener('keydown', (e) => {
  if (!lb.classList.contains('open')) return
  if (e.key === 'Escape') closeLightbox()
  if (e.key === 'ArrowLeft') step(-1)
  if (e.key === 'ArrowRight') step(1)
})
let touchX = null
lb.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true })
lb.addEventListener('touchend', (e) => {
  if (touchX === null) return
  const dx = e.changedTouches[0].clientX - touchX
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
  touchX = null
})

load()
