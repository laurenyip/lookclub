// npm run dev — the whole app on http://localhost:8888 with data in .data/ and emails in .data/outbox/
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

// .env (optional)
try {
  for (const line of (await fs.readFile('.env', 'utf8')).split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

process.env.LOOKCLUB_LOCAL = '1'
const PORT = Number(process.env.PORT || 8888)
process.env.SITE_URL ||= `http://localhost:${PORT}`
const { handle } = await import('./lib/api.mjs')

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' }
const REWRITES = { '/join': '/join.html', '/admin': '/admin.html', '/': '/index.html' }

async function outbox(res) {
  const dir = path.resolve('.data/outbox')
  let files = []
  try { files = (await fs.readdir(dir)).sort().reverse() } catch {}
  const mails = await Promise.all(files.slice(0, 40).map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))))
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><title>outbox</title><body style="font-family:Arial;background:#eee;margin:24px">
<h2>dev outbox (${files.length})</h2>${mails
    .map((m) => `<details style="background:#fff;margin:8px 0;padding:10px;border-radius:8px"><summary><b>${esc(m.to)}</b> — ${esc(m.subject)} <small>${esc(m.sentAt)}</small></summary><iframe style="width:100%;height:640px;border:0" srcdoc="${esc(m.html)}"></iframe></details>`)
    .join('')}</body>`)
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    try {
      if (url.pathname.startsWith('/api/')) {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        })
        const response = await handle(request)
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
        return
      }
      if (url.pathname === '/dev/outbox') return outbox(res)
      const p = REWRITES[url.pathname] || url.pathname
      const file = path.join(path.resolve('public'), path.normalize(p).replace(/^([/\\])+/, ''))
      if (!file.startsWith(path.resolve('public'))) throw Object.assign(new Error(), { code: 'ENOENT' })
      const data = await fs.readFile(file)
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' })
      res.end(e.code === 'ENOENT' ? 'not found' : String(e.stack))
    }
  })
  .listen(PORT, () => console.log(`look club → http://localhost:${PORT}  (admin: /admin, key "${process.env.ADMIN_KEY || 'dev'}"; emails: /dev/outbox)`))
