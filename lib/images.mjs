// Turns any uploaded image into a display jpeg + a small thumbnail.
// If sharp can't read it (rare formats), the original is kept as-is.
export async function processImage(buffer) {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    return null
  }
  try {
    const base = () => sharp(buffer, { failOn: 'none' }).rotate()
    const full = await base()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    const thumb = await base()
      .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer()
    return { full: full.data, thumb, width: full.info.width, height: full.info.height }
  } catch (e) {
    console.warn('image processing failed', e.message)
    return null
  }
}

export function looksLikeImage(filename = '', contentType = '') {
  return /^image\//i.test(contentType) || /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?)$/i.test(filename)
}
