import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/api.mjs'
import { initSchema, pool } from '../server/db.mjs'

const enabled = process.env.STOCKROOM_DATABASE_URL?.includes('/stockroom_auth_test_')
let server
let base
let ownerCookie = ''
let employeeCookie = ''
let productId = ''

before(async () => {
  if (!enabled) return
  await initSchema()
  await pool.query('TRUNCATE app_sessions, app_users, sale_items, sales, stock_movements, products CASCADE')
  server = createApp()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
})

async function api(path, method = 'GET', input, cookie = '') {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(method === 'GET' ? {} : { Origin: 'http://localhost:1420', 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
  })
  const data = await response.json()
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' }
}

test('owner setup and employee permissions', { skip: !enabled }, async () => {
  let result = await api('/bootstrap', 'POST', { username: 'owner_test', password: 'owner-test-password-123' })
  assert.equal(result.status, 201)
  ownerCookie = result.cookie
  assert.match(result.cookie, /stockroom_local_session=/)
  assert.equal((await api('/session', 'GET', undefined, ownerCookie)).data.user.role, 'owner')
  assert.equal((await api('/products')).status, 401)
  const crossOrigin = await fetch(`${base}/api/products`, { method: 'POST', headers: { Origin: 'https://other.example', Cookie: ownerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
  assert.equal(crossOrigin.status, 403)

  const input = { name: 'Test coffee', sku: 'TEST-COF-1', category: 'Coffee', quantity: 5, reorderLevel: 2, unit: 'bags', price: 15000 }
  assert.equal((await api('/products', 'POST', input, ownerCookie)).status, 201)
  productId = (await api('/products', 'GET', undefined, ownerCookie)).data.find(item => item.sku === input.sku).id
  assert.ok(productId)

  result = await api('/users', 'POST', { username: 'employee_test', password: 'employee-test-password-123' }, ownerCookie)
  assert.equal(result.status, 201)
  assert.equal(result.data.role, 'employee')
  result = await api('/login', 'POST', { username: 'employee_test', password: 'employee-test-password-123' })
  assert.equal(result.status, 200)
  employeeCookie = result.cookie
  assert.equal((await api('/users', 'GET', undefined, employeeCookie)).status, 403)
  assert.equal((await api('/products', 'POST', input, employeeCookie)).status, 403)
  assert.equal((await api('/adjust', 'POST', { id: productId, change: 1, reason: 'Unauthorized' }, employeeCookie)).status, 403)
})

test('employee sale updates stock atomically and deactivation revokes access', { skip: !enabled }, async () => {
  const bad = await api('/sales', 'POST', { lines: [{ productId, quantity: 6 }], paymentMethod: 'card', cashReceived: null }, employeeCookie)
  assert.equal(bad.status, 409)
  assert.equal((await api('/products', 'GET', undefined, employeeCookie)).data.find(item => item.id === productId).quantity, 5)

  const result = await api('/sales', 'POST', { lines: [{ productId, quantity: 2 }], paymentMethod: 'cash', cashReceived: 40000 }, employeeCookie)
  assert.equal(result.status, 201)
  assert.equal(result.data.sale.total, 30000)
  assert.equal(result.data.sale.changeDue, 10000)
  assert.equal(result.data.sale.recordedBy, 'employee_test')
  assert.equal((await api('/products', 'GET', undefined, employeeCookie)).data.find(item => item.id === productId).quantity, 3)
  assert.equal((await api(`/sales/${result.data.sale.id}`, 'GET', undefined, employeeCookie)).data.items[0].unitPrice, 15000)
  assert.equal((await api('/movements', 'GET', undefined, employeeCookie)).data.find(item => item.reason === `Sale ${result.data.sale.reference}`).recordedBy, 'employee_test')
  assert.deepEqual((await api('/summary', 'GET', undefined, employeeCookie)).data, { salesToday: 1, revenueToday: 30000 })
  assert.equal((await api('/team-sales-today', 'GET', undefined, employeeCookie)).status, 403)
  assert.deepEqual((await api('/team-sales-today', 'GET', undefined, ownerCookie)).data, [{ username: 'employee_test', count: 1, total: 30000 }])

  const users = (await api('/users', 'GET', undefined, ownerCookie)).data
  const employee = users.find(item => item.username === 'employee_test')
  assert.equal((await api(`/users/${employee.id}/active`, 'PATCH', { active: false }, ownerCookie)).status, 200)
  assert.equal((await api('/products', 'GET', undefined, employeeCookie)).status, 401)
})
