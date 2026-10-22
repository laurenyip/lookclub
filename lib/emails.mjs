// Email templates. Inline styles only; Moto loads in Apple Mail, everyone else gets Georgia.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const NAVY = '#0b1427'
const DISPLAY = "'Moto', Georgia, 'Times New Roman', serif"
const SANS = 'Arial, Helvetica, sans-serif'

function layout({ siteUrl, label, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<style>@font-face{font-family:'Moto';src:url('${esc(siteUrl)}/fonts/moto.woff2') format('woff2');}</style></head>
<body style="margin:0;padding:0;background:${NAVY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};">
<tr><td align="center" style="padding:36px 16px 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="font-family:${SANS};font-size:12px;letter-spacing:2px;color:rgba(255,255,255,.62);text-transform:lowercase;padding-bottom:6px;">
<span style="color:#fff;">✦</span>&nbsp; ${esc(label)}</td>
<td align="right" style="font-family:${SANS};font-size:11px;color:rgba(255,255,255,.35);letter-spacing:6px;">· ✦ ·</td></tr>
<tr><td colspan="2" style="padding-top:22px;">${body}</td></tr>
<tr><td colspan="2" style="padding-top:44px;font-family:${SANS};font-size:12px;line-height:19px;letter-spacing:.4px;color:rgba(255,255,255,.42);">${footer || ''}</td></tr>
</table></td></tr></table></body></html>`
}

const p = (html, extra = '') =>
  `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;letter-spacing:.4px;color:rgba(255,255,255,.86);${extra}">${html}</p>`

const big = (text) =>
  `<p style="margin:0 0 28px;font-family:${DISPLAY};font-size:40px;line-height:46px;color:#ffffff;font-weight:400;">“${esc(text)}”</p>`

const pill = (href, text) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:9px 20px;border-radius:999px;border:1px solid rgba(255,255,255,.92);background:#1a2140;color:#ffffff;text-decoration:none;font-family:${DISPLAY};font-size:15px;letter-spacing:.6px;">${esc(text)}</a>`

const stopLine = (circle) =>
  `you’re getting this because you’re part of ${esc(circle)}. reply “stop” to take a break from prompts.`

export function promptEmail({ circle, siteUrl, number, prompt, name, link, revealWhen, canReply }) {
  const how = canReply
    ? p(`reply to this email with <b style="color:#fff;">one photo</b>. write a line in your reply if you want — it becomes your caption.`)
    : p(`upload <b style="color:#fff;">one photo</b> at your link below. add a caption if you want.`)
  const body =
    p(`hi ${esc(name)} — this week’s prompt is`, 'color:rgba(255,255,255,.62);') +
    big(prompt) +
    how +
    p(`nobody sees anything until the gallery opens <b style="color:#fff;">${esc(revealWhen)}</b>. then we all see it together.`) +
    `<div style="padding-top:12px;">${pill(link, canReply ? 'or upload on the web' : 'upload your photo')}</div>`
  return {
    subject: `✦ week ${number}: ${prompt}`,
    html: layout({ siteUrl, label: `${circle} · week ${number}`, body, footer: stopLine(circle) }),
    text: `hi ${name} — this week's prompt is:\n\n"${prompt}"\n\n${canReply ? 'reply to this email with one photo (and a caption if you like).' : 'upload one photo at your link.'}\nthe gallery opens ${revealWhen}.\n\n${link}\n\nreply "stop" to take a break.`,
  }
}

export function reminderEmail({ circle, siteUrl, number, prompt, name, link, revealWhen, canReply }) {
  const body =
    p(`still hunting, ${esc(name)}? there’s time.`, 'color:rgba(255,255,255,.62);') +
    big(prompt) +
    p(`the gallery opens <b style="color:#fff;">${esc(revealWhen)}</b>. ${canReply ? 'just reply to this email with a photo.' : 'upload at your link.'}`) +
    `<div style="padding-top:12px;">${pill(link, 'upload on the web')}</div>`
  return {
    subject: `still hunting? “${prompt}”`,
    html: layout({ siteUrl, label: `${circle} · week ${number}`, body, footer: stopLine(circle) }),
    text: `still hunting, ${name}? this week: "${prompt}". the gallery opens ${revealWhen}. ${link}`,
  }
}

export function revealEmail({ circle, siteUrl, number, prompt, name, link, count }) {
  const body =
    p(`the gallery is open.`, 'color:rgba(255,255,255,.62);') +
    big(prompt) +
    p(`${count} ${count === 1 ? 'person' : 'people'} went looking. come see how differently everyone saw it.`) +
    `<div style="padding-top:12px;">${pill(link, 'open the gallery')}</div>`
  return {
    subject: `the gallery is open ✦ ${prompt}`,
    html: layout({ siteUrl, label: `${circle} · week ${number}`, body, footer: stopLine(circle) }),
    text: `hi ${name}, the gallery for "${prompt}" is open — ${count} photos. ${link}`,
  }
}

export function confirmEmail({ circle, siteUrl, prompt, name, link, caption, revealWhen, late, replaced }) {
  const body =
    p(`got it, ${esc(name)} ✦`, 'font-family:' + DISPLAY + ';font-size:26px;line-height:32px;color:#fff;') +
    p(
      `${replaced ? 'your new photo replaced the old one' : 'your photo is in'} for <b style="color:#fff;">“${esc(prompt)}”</b>.` +
        (caption ? ` caption: <i>${esc(caption)}</i>` : '')
    ) +
    p(late ? `the gallery is already open — you’re in it now.` : `it stays hidden until ${esc(revealWhen)}. reply again any time to swap it.`) +
    `<div style="padding-top:12px;">${pill(link, late ? 'see the gallery' : 'see who else is in')}</div>`
  return {
    subject: `got it ✦ ${prompt}`,
    html: layout({ siteUrl, label: circle, body }),
    text: `got it, ${name}! your photo is in for "${prompt}". ${link}`,
  }
}

export function welcomeEmail({ circle, siteUrl, name, link, scheduleLine }) {
  const body =
    p(`welcome, ${esc(name)} ✦`, 'font-family:' + DISPLAY + ';font-size:30px;line-height:36px;color:#fff;') +
    p(`you’re in ${esc(circle)}. here’s how it works:`) +
    p(`${esc(scheduleLine)}`) +
    p(`this is your personal link — it’s how the site knows it’s you, so keep it to yourself:`) +
    `<div style="padding:6px 0 4px;">${pill(link, 'my link')}</div>`
  return {
    subject: `you’re in ✦ ${circle}`,
    html: layout({ siteUrl, label: circle, body }),
    text: `welcome to ${circle}, ${name}! ${scheduleLine}\n\nyour personal link: ${link}`,
  }
}

export function noticeEmail({ circle, siteUrl, subject, lines, link, linkText }) {
  const body = lines.map((l) => p(l)).join('') + (link ? `<div style="padding-top:12px;">${pill(link, linkText)}</div>` : '')
  return {
    subject,
    html: layout({ siteUrl, label: circle, body }),
    text: lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n\n') + (link ? `\n\n${link}` : ''),
  }
}
