import { initSchema, pool } from './db.mjs'
import { createApp } from './api.mjs'

const host = process.env.STOCKROOM_HOST ?? '127.0.0.1'
const port = Number(process.env.STOCKROOM_PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid STOCKROOM_PORT.')
if (!['127.0.0.1', '::1'].includes(host) && !process.env.STOCKROOM_PUBLIC_URL?.startsWith('https://')) {
  throw new Error('A non-local server requires STOCKROOM_PUBLIC_URL with an HTTPS URL.')
}
if (process.env.STOCKROOM_PUBLIC_URL && new URL(process.env.STOCKROOM_PUBLIC_URL).protocol !== 'https:') throw new Error('STOCKROOM_PUBLIC_URL must use HTTPS.')
if (process.env.STOCKROOM_PUBLIC_URL && !process.env.STOCKROOM_DATABASE_URL) throw new Error('Hosted Stockroom requires STOCKROOM_DATABASE_URL.')

await initSchema()
const server = createApp()
server.listen(port, host, () => console.log(`Stockroom server listening on ${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))))
