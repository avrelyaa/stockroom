import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { pool, transaction } from './db.mjs'
import { HttpError, bootstrapOwner, createSession, currentUser, destroySession, hashPassword, requireOwner, requireUser, validatePassword, validateUsername, verifyPassword } from './auth.mjs'

const maxSafe = Number.MAX_SAFE_INTEGER
const maxPrice = 9_000_000_000_000
const storeTimeZone = process.env.STOCKROOM_TIMEZONE ?? 'Asia/Jakarta'
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: storeTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const attempts = new Map()
const dummyHash = hashPassword('unused-login-password')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function localRequest(request) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) }
function expectedOrigins() {
  return process.env.STOCKROOM_PUBLIC_URL
    ? new Set([new URL(process.env.STOCKROOM_PUBLIC_URL).origin])
    : new Set(['http://localhost:1420', 'http://127.0.0.1:1420'])
}
function checkOrigin(request) {
  const origin = request.headers.origin
  if (origin && !expectedOrigins().has(origin)) throw new HttpError(403, 'Request origin is not allowed.')
  if (!origin && (process.env.STOCKROOM_PUBLIC_URL || !localRequest(request))) throw new HttpError(403, 'Request origin is required.')
}

async function body(request) {
  let content = ''
  for await (const chunk of request) {
    content += chunk
    if (content.length > 1_000_000) throw new HttpError(413, 'Request is too large.')
  }
  try { return JSON.parse(content || '{}') }
  catch { throw new HttpError(400, 'Invalid JSON.') }
}

function whole(value, field, max = 2_147_483_647) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new HttpError(400, `${field} must be a nonnegative whole number.`)
  return value
}
function textField(value, field, max, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) throw new HttpError(400, `Enter a valid ${field}.`)
  return value.trim()
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'Invalid ID.')
  return value
}
function productInput(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Enter product details.')
  return {
    name: textField(input.name, 'name', 120), sku: textField(input.sku, 'SKU', 50),
    category: textField(input.category, 'category', 60), unit: textField(input.unit, 'unit', 30),
    quantity: whole(input.quantity, 'Quantity'), reorderLevel: whole(input.reorderLevel, 'Reorder level'),
    price: whole(input.price, 'Price', maxPrice),
  }
}
function product(row) { return { id: row.id, name: row.name, sku: row.sku, category: row.category, quantity: row.quantity, reorderLevel: row.reorder_level, unit: row.unit, price: Number(row.price), createdAt: row.created_at } }
function sale(row) { return { id: row.id, reference: row.reference, total: Number(row.total), paymentMethod: row.payment_method, cashReceived: row.cash_received === null ? null : Number(row.cash_received), changeDue: row.change_due === null ? null : Number(row.change_due), recordedBy: row.recorded_by ?? null, createdAt: row.created_at } }
function saleItem(row) { return { productId: row.product_id, productName: row.product_name, sku: row.sku, quantity: row.quantity, unitPrice: Number(row.unit_price), lineTotal: Number(row.line_total) } }
function userInfo(row) { return { id: row.id, username: row.username, role: row.role, active: row.active, createdAt: row.created_at } }

async function addProduct(client, input, userId) {
  const id = randomUUID()
  await client.query('INSERT INTO products(id,name,sku,category,quantity,reorder_level,unit,price) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, input.name, input.sku, input.category, input.quantity, input.reorderLevel, input.unit, input.price])
  if (input.quantity) await client.query('INSERT INTO stock_movements(id,product_id,change,reason,created_by) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, input.quantity, 'Opening stock', userId])
}

async function recordSale(input, user) {
  const lines = input.lines
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new HttpError(400, 'Add 1 to 100 products to a sale.')
  if (!['cash', 'card', 'transfer'].includes(input.paymentMethod)) throw new HttpError(400, 'Choose cash, card, or transfer.')
  const seen = new Set()
  for (const line of lines) {
    uuid(line.productId)
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2_147_483_647) throw new HttpError(400, 'Sale quantities must be positive whole numbers.')
    if (seen.has(line.productId)) throw new HttpError(400, 'A product appears more than once in the sale.')
    seen.add(line.productId)
  }
  return transaction(async client => {
    const items = []
    let total = 0
    for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const { rows } = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [line.productId])
      const item = rows[0]
      if (!item) throw new HttpError(404, 'A product in the sale no longer exists.')
      if (Number(item.price) <= 0) throw new HttpError(400, `Set a selling price for ${item.name} before recording a sale.`)
      if (item.quantity < line.quantity) throw new HttpError(409, `Only ${item.quantity} ${item.unit} of ${item.name} available.`)
      const lineTotal = Number(item.price) * line.quantity
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) throw new HttpError(400, 'Sale total is too large.')
      total += lineTotal
      items.push({ productId: item.id, productName: item.name, sku: item.sku, quantity: line.quantity, unitPrice: Number(item.price), lineTotal })
    }
    let received = null
    let change = null
    if (input.paymentMethod === 'cash') {
      received = whole(input.cashReceived, 'Cash received', maxSafe)
      if (received < total) throw new HttpError(400, 'Cash received is less than the sale total.')
      change = received - total
    }
    const id = randomUUID()
    const reference = `S-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`
    const saved = await client.query('INSERT INTO sales(id,reference,total,payment_method,cash_received,change_due,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id, reference, total, input.paymentMethod, received, change, user.id])
    for (const item of items) {
      await client.query('INSERT INTO sale_items(id,sale_id,product_id,product_name,sku,quantity,unit_price,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, item.productId, item.productName, item.sku, item.quantity, item.unitPrice, item.lineTotal])
      await client.query('UPDATE products SET quantity=quantity-$1 WHERE id=$2', [item.quantity, item.productId])
      await client.query('INSERT INTO stock_movements(id,product_id,change,reason,created_by) VALUES($1,$2,$3,$4,$5)', [randomUUID(), item.productId, -item.quantity, `Sale ${reference}`, user.id])
    }
    return { sale: sale({ ...saved.rows[0], recorded_by: user.username }), items }
  })
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET') throw new HttpError(404, 'Not found.')
  const path = pathname === '/' ? '/index.html' : pathname
  const relative = normalize(path).replace(/^[/\\]+/, '')
  if (relative.startsWith('..') || relative.includes(':')) throw new HttpError(404, 'Not found.')
  let file = join(distRoot, relative)
  try { if (!(await stat(file)).isFile()) throw new Error('Not a file') }
  catch { file = join(distRoot, 'index.html') }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" })
  response.end(await readFile(file))
}

export function createApp() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (!pathname.startsWith('/api/')) return await serveStatic(request, response, pathname)
      if (!['GET', 'POST', 'PUT', 'PATCH'].includes(request.method)) throw new HttpError(405, 'Method not allowed.')
      if (request.method !== 'GET') checkOrigin(request)
      if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true })
      if (pathname === '/api/session' && request.method === 'GET') {
        const user = await currentUser(request)
        const needsSetup = !process.env.STOCKROOM_PUBLIC_URL && localRequest(request) && (await pool.query('SELECT COUNT(*)::int AS count FROM app_users')).rows[0].count === 0
        return json(response, 200, { user, needsSetup })
      }
      if (pathname === '/api/bootstrap' && request.method === 'POST') {
        if (process.env.STOCKROOM_PUBLIC_URL || !localRequest(request) || !['127.0.0.1', '::1'].includes(process.env.STOCKROOM_HOST ?? '127.0.0.1')) throw new HttpError(403, 'Create the owner account on the server.')
        const input = await body(request)
        const user = await bootstrapOwner(input.username, input.password)
        await createSession(response, user.id)
        return json(response, 201, { user })
      }
      if (pathname === '/api/login' && request.method === 'POST') {
        const input = await body(request)
        const username = validateUsername(input.username)
        const password = typeof input.password === 'string' ? input.password : ''
        const key = `${request.socket.remoteAddress}:${username.toLowerCase()}`
        const state = attempts.get(key) ?? { count: 0, until: Date.now() + 15 * 60_000 }
        if (state.until < Date.now()) { state.count = 0; state.until = Date.now() + 15 * 60_000 }
        if (state.count >= 5) throw new HttpError(429, 'Too many sign-in attempts. Try again later.')
        const { rows } = await pool.query('SELECT * FROM app_users WHERE LOWER(username)=LOWER($1) AND active=TRUE', [username])
        const matches = await verifyPassword(password, rows[0]?.password_hash ?? await dummyHash)
        const valid = rows[0] && matches
        if (!valid) { state.count += 1; attempts.set(key, state); throw new HttpError(401, 'Incorrect username or password.') }
        attempts.delete(key)
        await createSession(response, rows[0].id)
        return json(response, 200, { user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } })
      }
      if (pathname === '/api/logout' && request.method === 'POST') {
        await destroySession(request, response)
        return json(response, 200, { ok: true })
      }
      const user = requireUser(await currentUser(request))
      if (pathname === '/api/users' && request.method === 'GET') {
        requireOwner(user)
        const { rows } = await pool.query('SELECT id,username,role,active,created_at FROM app_users ORDER BY created_at')
        return json(response, 200, rows.map(userInfo))
      }
      if (pathname === '/api/team-sales-today' && request.method === 'GET') {
        requireOwner(user)
        const { rows } = await pool.query(`SELECT COALESCE(u.username,'Earlier staff') AS username, COUNT(*)::int AS count, COALESCE(SUM(s.total),0) AS total
          FROM sales s LEFT JOIN app_users u ON u.id=s.created_by
          WHERE (s.created_at AT TIME ZONE $1)::date=$2::date
          GROUP BY COALESCE(u.username,'Earlier staff') ORDER BY total DESC`, [storeTimeZone, today()])
        return json(response, 200, rows.map(row => ({ username: row.username, count: row.count, total: Number(row.total) })))
      }
      if (pathname === '/api/users' && request.method === 'POST') {
        requireOwner(user)
        const input = await body(request)
        const username = validateUsername(input.username)
        const passwordHash = await hashPassword(validatePassword(input.password))
        const { rows } = await pool.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,role,active,created_at', [randomUUID(), username, passwordHash, 'employee'])
        return json(response, 201, userInfo(rows[0]))
      }
      const activeMatch = pathname.match(/^\/api\/users\/([0-9a-f-]+)\/active$/)
      if (activeMatch && request.method === 'PATCH') {
        requireOwner(user)
        const id = uuid(activeMatch[1])
        if (id === user.id) throw new HttpError(400, 'You cannot disable your own account.')
        const input = await body(request)
        if (typeof input.active !== 'boolean') throw new HttpError(400, 'Choose active or inactive.')
        const { rows } = await pool.query('UPDATE app_users SET active=$1 WHERE id=$2 AND role=$3 RETURNING id,username,role,active,created_at', [input.active, id, 'employee'])
        if (!rows[0]) throw new HttpError(404, 'Employee not found.')
        if (!input.active) await pool.query('DELETE FROM app_sessions WHERE user_id=$1', [id])
        return json(response, 200, userInfo(rows[0]))
      }
      const resetMatch = pathname.match(/^\/api\/users\/([0-9a-f-]+)\/password$/)
      if (resetMatch && request.method === 'POST') {
        requireOwner(user)
        const id = uuid(resetMatch[1])
        const input = await body(request)
        const passwordHash = await hashPassword(validatePassword(input.password))
        const result = await pool.query('UPDATE app_users SET password_hash=$1 WHERE id=$2 AND role=$3', [passwordHash, id, 'employee'])
        if (!result.rowCount) throw new HttpError(404, 'Employee not found.')
        await pool.query('DELETE FROM app_sessions WHERE user_id=$1', [id])
        return json(response, 200, { ok: true })
      }
      if (pathname === '/api/change-password' && request.method === 'POST') {
        const input = await body(request)
        const password = validatePassword(input.password)
        if (typeof input.currentPassword !== 'string') throw new HttpError(400, 'Enter your current password.')
        const { rows } = await pool.query('SELECT password_hash FROM app_users WHERE id=$1', [user.id])
        if (!await verifyPassword(input.currentPassword ?? '', rows[0].password_hash)) throw new HttpError(401, 'Current password is incorrect.')
        await transaction(async client => {
          await client.query('UPDATE app_users SET password_hash=$1 WHERE id=$2', [await hashPassword(password), user.id])
          await client.query('DELETE FROM app_sessions WHERE user_id=$1', [user.id])
        })
        return json(response, 200, { ok: true })
      }
      if (pathname === '/api/products' && request.method === 'GET') {
        const { rows } = await pool.query('SELECT * FROM products ORDER BY LOWER(name), id')
        return json(response, 200, rows.map(product))
      }
      if (pathname === '/api/summary' && request.method === 'GET') {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total FROM sales WHERE (created_at AT TIME ZONE $1)::date=$2::date', [storeTimeZone, today()])
        return json(response, 200, { salesToday: rows[0].count, revenueToday: Number(rows[0].total) })
      }
      if (pathname === '/api/products' && request.method === 'POST') {
        requireOwner(user)
        const input = productInput(await body(request))
        await transaction(client => addProduct(client, input, user.id))
        return json(response, 201, { ok: true })
      }
      const productMatch = pathname.match(/^\/api\/products\/([0-9a-f-]+)$/)
      if (productMatch && request.method === 'PUT') {
        requireOwner(user)
        const id = uuid(productMatch[1])
        const input = productInput(await body(request))
        const result = await pool.query('UPDATE products SET name=$1,sku=$2,category=$3,reorder_level=$4,unit=$5,price=$6 WHERE id=$7', [input.name, input.sku, input.category, input.reorderLevel, input.unit, input.price, id])
        if (!result.rowCount) throw new HttpError(404, 'Product not found.')
        return json(response, 200, { ok: true })
      }
      if (pathname === '/api/import' && request.method === 'POST') {
        requireOwner(user)
        const inputs = (await body(request)).inputs
        if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) throw new HttpError(400, 'Import between 1 and 1,000 products.')
        const products = inputs.map(productInput)
        const skus = new Set(products.map(item => item.sku.toLowerCase()))
        if (skus.size !== products.length) throw new HttpError(400, 'A SKU appears more than once in the file.')
        await transaction(async client => { for (const item of products) await addProduct(client, item, user.id) })
        return json(response, 200, products.length)
      }
      if (pathname === '/api/adjust' && request.method === 'POST') {
        requireOwner(user)
        const input = await body(request)
        const id = uuid(input.id)
        if (!Number.isInteger(input.change) || input.change === 0 || Math.abs(input.change) > 2_147_483_647) throw new HttpError(400, 'Enter a nonzero whole quantity.')
        const reason = textField(input.reason, 'reason', 160)
        await transaction(async client => {
          const { rows } = await client.query('SELECT quantity FROM products WHERE id=$1 FOR UPDATE', [id])
          if (!rows[0]) throw new HttpError(404, 'Product not found.')
          const next = rows[0].quantity + input.change
          if (next < 0 || next > 2_147_483_647) throw new HttpError(400, 'Resulting stock is outside the allowed range.')
          await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [next, id])
          await client.query('INSERT INTO stock_movements(id,product_id,change,reason,created_by) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, input.change, reason, user.id])
        })
        return json(response, 200, { ok: true })
      }
      if (pathname === '/api/movements' && request.method === 'GET') {
        const { rows } = await pool.query('SELECT m.id,p.name AS product_name,p.sku,m.change,m.reason,m.created_at,u.username AS recorded_by FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN app_users u ON u.id=m.created_by ORDER BY m.created_at DESC,m.id DESC LIMIT 50')
        return json(response, 200, rows.map(row => ({ id: row.id, productName: row.product_name, sku: row.sku, change: row.change, reason: row.reason, recordedBy: row.recorded_by, createdAt: row.created_at })))
      }
      if (pathname === '/api/sales' && request.method === 'GET') {
        const { rows } = await pool.query('SELECT s.*,u.username AS recorded_by FROM sales s LEFT JOIN app_users u ON u.id=s.created_by ORDER BY s.created_at DESC,s.id DESC LIMIT 100')
        return json(response, 200, rows.map(sale))
      }
      if (pathname === '/api/sales' && request.method === 'POST') return json(response, 201, await recordSale(await body(request), user))
      const saleMatch = pathname.match(/^\/api\/sales\/([0-9a-f-]+)$/)
      if (saleMatch && request.method === 'GET') {
        const id = uuid(saleMatch[1])
        const { rows } = await pool.query('SELECT s.*,u.username AS recorded_by FROM sales s LEFT JOIN app_users u ON u.id=s.created_by WHERE s.id=$1', [id])
        if (!rows[0]) throw new HttpError(404, 'Sale not found.')
        const items = await pool.query('SELECT product_id,product_name,sku,quantity,unit_price,line_total FROM sale_items WHERE sale_id=$1 ORDER BY sku', [id])
        return json(response, 200, { sale: sale(rows[0]), items: items.rows.map(saleItem) })
      }
      throw new HttpError(404, 'Not found.')
    } catch (error) {
      if (error.code === '23505') return json(response, 409, 'That username or SKU already exists.')
      if (error instanceof HttpError) return json(response, error.status, error.message)
      console.error('Stockroom server error:', error)
      return json(response, 500, 'Server error. Try again.')
    }
  })
}
