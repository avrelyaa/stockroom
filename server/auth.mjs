import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from './db.mjs'

const derive = promisify(scrypt)
const ttlSeconds = 12 * 60 * 60
const cookieName = process.env.STOCKROOM_PUBLIC_URL ? '__Host-stockroom' : 'stockroom_local_session'

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username must be 3–40 letters, numbers, dots, dashes, or underscores.')
  return username.trim()
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new HttpError(400, 'Password must be 12–128 characters.')
  return password
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const hash = Buffer.from(hashHex, 'hex')
  const candidate = await derive(password, Buffer.from(saltHex, 'hex'), hash.length)
  return hash.length === candidate.length && timingSafeEqual(hash, candidate)
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex') }

export function readToken(request) {
  const cookies = (request.headers.cookie ?? '').split(';')
  const pair = cookies.map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))
  return pair?.slice(cookieName.length + 1) ?? null
}

export async function currentUser(request) {
  const token = readToken(request)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const { rows } = await pool.query(`SELECT u.id, u.username, u.role
    FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE`, [tokenHash(token)])
  return rows[0] ?? null
}

export async function createSession(response, userId) {
  const token = randomBytes(32).toString('hex')
  await pool.query('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'12 hours\')', [tokenHash(token), userId])
  response.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlSeconds}${process.env.STOCKROOM_PUBLIC_URL ? '; Secure' : ''}`)
}

export async function destroySession(request, response) {
  const token = readToken(request)
  if (token) await pool.query('DELETE FROM app_sessions WHERE token_hash=$1', [tokenHash(token)])
  response.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.STOCKROOM_PUBLIC_URL ? '; Secure' : ''}`)
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, 'Sign in to continue.')
  return user
}

export function requireOwner(user) {
  requireUser(user)
  if (user.role !== 'owner') throw new HttpError(403, 'Owner access required.')
  return user
}

export async function bootstrapOwner(username, password) {
  username = validateUsername(username)
  validatePassword(password)
  const passwordHash = await hashPassword(password)
  return transaction(async client => {
    await client.query('LOCK TABLE app_users IN EXCLUSIVE MODE')
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM app_users')
    if (rows[0].count) throw new HttpError(409, 'An owner account already exists.')
    const id = randomUUID()
    await client.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [id, username, passwordHash, 'owner'])
    return { id, username, role: 'owner' }
  })
}
