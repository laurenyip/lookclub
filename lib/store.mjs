// Key/value + file storage. On Netlify this is Netlify Blobs; locally (npm run dev) it's a folder.
import fs from 'node:fs/promises'
import path from 'node:path'

const LOCAL = process.env.LOOKCLUB_LOCAL === '1'
const LOCAL_DIR = process.env.LOOKCLUB_DATA || path.resolve('.data')

const cache = new Map()

async function netlifyStore(name) {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name, consistency: 'strong' })
}

function localStore(name) {
  const dir = path.join(LOCAL_DIR, name)
  const file = (key) => path.join(dir, encodeURIComponent(key))
  return {
    async get(key, { type } = {}) {
      try {
        const buf = await fs.readFile(file(key))
        if (type === 'json') return JSON.parse(buf.toString('utf8'))
        if (type === 'arrayBuffer') return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        return buf.toString('utf8')
      } catch (e) {
        if (e.code === 'ENOENT') return null
        throw e
      }
    },
    async getWithMetadata(key, opts) {
      const data = await this.get(key, opts)
      if (data === null) return null
      let metadata = {}
      try { metadata = JSON.parse(await fs.readFile(file(key) + '.meta', 'utf8')) } catch {}
      return { data, metadata }
    },
    async set(key, data, { metadata } = {}) {
      await fs.mkdir(dir, { recursive: true })
      const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.isBuffer(data) ? data : Buffer.from(String(data))
      await fs.writeFile(file(key), buf)
      if (metadata) await fs.writeFile(file(key) + '.meta', JSON.stringify(metadata))
    },
    async setJSON(key, value) {
      await this.set(key, JSON.stringify(value))
    },
    async delete(key) {
      await fs.rm(file(key), { force: true })
      await fs.rm(file(key) + '.meta', { force: true })
    },
    async list({ prefix = '' } = {}) {
      let names = []
      try { names = await fs.readdir(dir) } catch {}
      const blobs = names
        .filter((n) => !n.endsWith('.meta'))
        .map((n) => ({ key: decodeURIComponent(n) }))
        .filter((b) => b.key.startsWith(prefix))
      return { blobs }
    },
  }
}

async function store(name) {
  if (!cache.has(name)) cache.set(name, LOCAL ? localStore(name) : await netlifyStore(name))
  return cache.get(name)
}

// game data (small JSON docs)
export async function getJSON(key, fallback = null) {
  const s = await store('sky')
  const v = await s.get(key, { type: 'json' })
  return v ?? fallback
}

export async function setJSON(key, value) {
  const s = await store('sky')
  await s.setJSON(key, value)
}

export async function del(key) {
  const s = await store('sky')
  await s.delete(key)
}

export async function listKeys(prefix) {
  const s = await store('sky')
  const { blobs } = await s.list({ prefix })
  return blobs.map((b) => b.key)
}

// photos
export async function putPhoto(key, buffer, contentType) {
  const s = await store('photos')
  await s.set(key, buffer, { metadata: { contentType } })
}

export async function getPhoto(key) {
  const s = await store('photos')
  const res = await s.getWithMetadata(key, { type: 'arrayBuffer' })
  if (!res) return null
  return { data: res.data, contentType: res.metadata?.contentType || 'image/jpeg' }
}

export async function deletePhoto(key) {
  const s = await store('photos')
  await s.delete(key)
}
