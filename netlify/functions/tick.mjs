// Hourly: sends the prompt, the reminder and the reveal when their time comes.
import { tick } from '../../lib/game.mjs'

export default async () => {
  console.log('tick', await tick(new Date()))
}

export const config = { schedule: '@hourly' }
