import { invoke, isTauri } from '@tauri-apps/api/core'

export type Product = {
  id: string
  name: string
  sku: string
  category: string
  quantity: number
  reorderLevel: number
  unit: string
  createdAt: string
}

export type ProductInput = Omit<Product, 'id' | 'createdAt'>
export type Movement = {
  id: string
  productName: string
  sku: string
  change: number
  reason: string
  createdAt: string
}

export const previewMode = !isTauri()
const demoKey = 'stockroom-preview-v1'

type PreviewData = { products: Product[]; movements: Movement[] }

function previewData(): PreviewData {
  const stored = localStorage.getItem(demoKey)
  if (stored) {
    try { return JSON.parse(stored) as PreviewData } catch { /* Recreate invalid preview data. */ }
  }
  const now = new Date().toISOString()
  const samples: ProductInput[] = [
    { name: 'Ceramic pour-over', sku: 'BRW-001', category: 'Brewing', quantity: 24, reorderLevel: 8, unit: 'pcs' },
    { name: 'House blend beans', sku: 'CFE-012', category: 'Coffee', quantity: 6, reorderLevel: 10, unit: 'bags' },
    { name: 'Amber glass tumbler', sku: 'DRK-004', category: 'Drinkware', quantity: 18, reorderLevel: 6, unit: 'pcs' },
    { name: 'Paper coffee filters', sku: 'BRW-009', category: 'Brewing', quantity: 3, reorderLevel: 12, unit: 'boxes' },
    { name: 'Linen tea towel', sku: 'HOM-008', category: 'Homeware', quantity: 32, reorderLevel: 8, unit: 'pcs' },
    { name: 'Matcha powder', sku: 'TEA-003', category: 'Tea', quantity: 11, reorderLevel: 5, unit: 'tins' },
  ]
  const data = { products: samples.map(item => ({ ...item, id: crypto.randomUUID(), createdAt: now })), movements: [] }
  savePreview(data)
  return data
}

function savePreview(data: PreviewData) { localStorage.setItem(demoKey, JSON.stringify(data)) }

export async function listProducts(): Promise<Product[]> {
  return previewMode ? previewData().products : invoke('list_products')
}

export async function listMovements(): Promise<Movement[]> {
  return previewMode ? previewData().movements : invoke('list_movements')
}

export async function createProduct(input: ProductInput): Promise<void> {
  if (!previewMode) return invoke('create_product', { input })
  const data = previewData()
  if (data.products.some(product => product.sku.toLowerCase() === input.sku.trim().toLowerCase())) throw new Error('That SKU already exists. Please use a unique SKU.')
  const item = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  data.products.push(item)
  if (item.quantity > 0) data.movements.unshift({ id: crypto.randomUUID(), productName: item.name, sku: item.sku, change: item.quantity, reason: 'Opening stock', createdAt: item.createdAt })
  savePreview(data)
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  if (!previewMode) return invoke('update_product', { id, input })
  const data = previewData()
  const product = data.products.find(item => item.id === id)
  if (!product) throw new Error('Product not found.')
  if (data.products.some(item => item.id !== id && item.sku.toLowerCase() === input.sku.trim().toLowerCase())) throw new Error('That SKU already exists. Please use a unique SKU.')
  Object.assign(product, { ...input, quantity: product.quantity })
  savePreview(data)
}

export async function adjustStock(id: string, change: number, reason: string): Promise<void> {
  if (!previewMode) return invoke('adjust_stock', { id, change, reason })
  const data = previewData()
  const product = data.products.find(item => item.id === id)
  if (!product) throw new Error('Product not found.')
  if (product.quantity + change < 0) throw new Error('Stock cannot go below zero.')
  product.quantity += change
  data.movements.unshift({ id: crypto.randomUUID(), productName: product.name, sku: product.sku, change, reason, createdAt: new Date().toISOString() })
  savePreview(data)
}
