// Timezone helpers without a date library. Days are 0 = sunday ... 6 = saturday.
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return {
    year: +get('year'),
    month: +get('month'),
    day: +get('day'),
    hour: +get('hour'),
    minute: +get('minute'),
    weekday: WEEKDAYS[get('weekday')],
  }
}

// local wall-clock time in `timeZone` -> real Date
export function zonedToUtc(y, m, d, h, min, timeZone) {
  const target = Date.UTC(y, m - 1, d, h, min)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone)
    const diff = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - target
    if (!diff) break
    guess -= diff
  }
  return new Date(guess)
}

// first `weekday` at `hour`:00 local time that is strictly after `after`
export function nextOccurrence(after, weekday, hour, timeZone) {
  const p = zonedParts(after, timeZone)
  for (let i = 0; i <= 8; i++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + i))
    if (base.getUTCDay() !== weekday) continue
    const t = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, 0, timeZone)
    if (t > after) return t
  }
  return null
}

export function localDateId(date, timeZone) {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function formatWhen(date, timeZone) {
  const d = new Date(date)
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(d).toLowerCase()
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(d)
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase()
  return `${day} at ${time}`
}
