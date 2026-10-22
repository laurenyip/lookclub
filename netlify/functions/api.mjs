import { handle } from '../../lib/api.mjs'

export default (req) => handle(req)

export const config = { path: '/api/*' }
