import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductsCsv, productsToCsv } from '../src/csv.ts'

const header = 'name,sku,category,quantity,reorder_level,unit\r\n'

test('imports quoted commas and line breaks', () => {
  const products = parseProductsCsv(`${header}"Beans, house\nblend",COF-1,Coffee,12,4,bags\r\n`, [])
  assert.deepEqual(products, [{ name: 'Beans, house\nblend', sku: 'COF-1', category: 'Coffee', quantity: 12, reorderLevel: 4, unit: 'bags', price: 0 }])
})

test('rejects an existing SKU before import', () => {
  const existing = [{ sku: 'COF-1' }]
  assert.throws(() => parseProductsCsv(`${header}Coffee,cof-1,Coffee,12,4,bags\n`, existing), /already exists/)
})

test('rejects invalid quantities and malformed rows', () => {
  assert.throws(() => parseProductsCsv(`${header}Coffee,COF-1,Coffee,-2,4,bags\n`, []), /whole number/)
  assert.throws(() => parseProductsCsv(`${header}Coffee,COF-1,Coffee,2,4\n`, []), /expected 6 columns/)
})

test('export can be imported again', () => {
  const csv = productsToCsv([{ name: 'House "special", beans', sku: 'COF-1', category: 'Coffee', quantity: 12, reorderLevel: 4, unit: 'bags', price: 98000 }])
  assert.equal(parseProductsCsv(csv, [])[0].name, 'House "special", beans')
  assert.equal(parseProductsCsv(csv, [])[0].price, 98000)
})

test('export neutralizes spreadsheet formulas in text fields', () => {
  const csv = productsToCsv([{ name: '=HYPERLINK("example")', sku: 'COF-1', category: 'Coffee', quantity: 12, reorderLevel: 4, unit: 'bags', price: 0 }])
  assert.match(csv, /"'=HYPERLINK\(""example""\)"/)
})

test('rejects an invalid price', () => {
  assert.throws(() => parseProductsCsv('name,sku,category,quantity,reorder_level,unit,price\nCoffee,COF-1,Coffee,2,4,bags,-1\n', []), /price must be a whole number/)
})
