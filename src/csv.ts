import type { Product, ProductInput } from './api'

const headers = ['name', 'sku', 'category', 'quantity', 'reorder_level', 'unit', 'price'] as const
const oldHeaders = headers.slice(0, -1)
const maxRows = 1000

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closedQuote = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') { quoted = false; closedQuote = true }
      else { cell += char }
      continue
    }
    if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell)
      cell = ''
      closedQuote = false
      if (char !== ',') {
        if (row.some(value => value.trim())) rows.push(row)
        row = []
        if (char === '\r' && text[index + 1] === '\n') index += 1
      }
    } else if (char === '"' && !cell && !closedQuote) {
      quoted = true
    } else if (closedQuote && char !== ' ' && char !== '\t') {
      throw new Error(`Invalid CSV near row ${rows.length + 1}.`)
    } else if (char !== '"' || !closedQuote) {
      cell += char
    }
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted value.')
  row.push(cell)
  if (row.some(value => value.trim())) rows.push(row)
  return rows
}

function wholeNumber(value: string, row: number, field: string, max = 2147483647): number {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) throw new Error(`Row ${row}: ${field} must be a whole number.`)
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error(`Row ${row}: ${field} is too large.`)
  return parsed
}

export function parseProductsCsv(text: string, existing: Product[]): ProductInput[] {
  const rows = parseRows(text.replace(/^\uFEFF/, ''))
  if (!rows.length) throw new Error('The CSV file is empty.')
  const first = rows[0].map(value => value.trim().toLowerCase())
  const legacy = first.length === oldHeaders.length && oldHeaders.every((header, index) => first[index] === header)
  if (!legacy && (first.length !== headers.length || headers.some((header, index) => first[index] !== header))) {
    throw new Error(`Use these columns in order: ${headers.join(', ')}.`)
  }
  if (rows.length === 1) throw new Error('The CSV file has no products.')
  if (rows.length - 1 > maxRows) throw new Error(`Import up to ${maxRows} products at a time.`)

  const seen = new Set(existing.map(product => product.sku.trim().toLowerCase()))
  return rows.slice(1).map((values, index) => {
    const row = index + 2
    if (values.length !== (legacy ? oldHeaders.length : headers.length)) throw new Error(`Row ${row}: expected ${legacy ? oldHeaders.length : headers.length} columns.`)
    const [name, sku, category, quantity, reorderLevel, unit, price] = values.map(value => value.trim())
    if (!name || !sku || !category || !unit) throw new Error(`Row ${row}: name, SKU, category and unit are required.`)
    if (name.length > 120 || sku.length > 50 || category.length > 60 || unit.length > 30) throw new Error(`Row ${row}: a text field is too long.`)
    const key = sku.toLowerCase()
    if (seen.has(key)) throw new Error(`Row ${row}: SKU ${sku} already exists or appears twice in the file.`)
    seen.add(key)
    return {
      name, sku, category, quantity: wholeNumber(quantity, row, 'quantity'),
      reorderLevel: wholeNumber(reorderLevel, row, 'reorder_level'), unit,
      price: legacy ? 0 : wholeNumber(price, row, 'price', 9_000_000_000_000),
    }
  })
}

function csvCell(value: string | number): string {
  let safe = String(value)
  if (/^[\s]*[=+@\-]/.test(safe)) safe = `'${safe}`
  return `"${safe.replace(/"/g, '""')}"`
}

export function productsToCsv(products: Product[]): string {
  const rows = products.map(product => [product.name, product.sku, product.category, product.quantity, product.reorderLevel, product.unit, product.price])
  return `\uFEFF${headers.join(',')}\r\n${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}${rows.length ? '\r\n' : ''}`
}

export function productTemplateCsv(): string {
  return `\uFEFF${headers.join(',')}\r\n`
}
