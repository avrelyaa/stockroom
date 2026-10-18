export type Role = 'owner' | 'employee'
export type User = { id: string; username: string; role: Role }
export type TeamUser = User & { active: boolean; createdAt: string }
export type Session = { user: User | null; needsSetup: boolean }
export type Product = { id: string; name: string; sku: string; category: string; quantity: number; reorderLevel: number; unit: string; price: number; createdAt: string }
export type ProductInput = Omit<Product, 'id' | 'createdAt'>
export type Movement = { id: string; productName: string; sku: string; change: number; reason: string; recordedBy: string | null; createdAt: string }
export type SaleLineInput = { productId: string; quantity: number }
export type PaymentMethod = 'cash' | 'card' | 'transfer'
export type Sale = { id: string; reference: string; total: number; paymentMethod: PaymentMethod; cashReceived: number | null; changeDue: number | null; recordedBy: string | null; createdAt: string }
export type SaleItem = { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; lineTotal: number }
export type SaleReceipt = { sale: Sale; items: SaleItem[] }
export type Summary = { salesToday: number; revenueToday: number }
export type TeamSaleSummary = { username: string; count: number; total: number }

async function request<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: input === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  })
  let result: unknown
  try { result = await response.json() }
  catch { throw new Error('The Stockroom server is unavailable.') }
  if (!response.ok) throw new Error(typeof result === 'string' ? result : 'Request failed.')
  return result as T
}

export const getSession = () => request<Session>('/session')
export const bootstrapOwner = (username: string, password: string) => request<{ user: User }>('/bootstrap', 'POST', { username, password })
export const login = (username: string, password: string) => request<{ user: User }>('/login', 'POST', { username, password })
export const logout = () => request<{ ok: true }>('/logout', 'POST', {})
export const changePassword = (currentPassword: string, password: string) => request<{ ok: true }>('/change-password', 'POST', { currentPassword, password })
export const listUsers = () => request<TeamUser[]>('/users')
export const teamSalesToday = () => request<TeamSaleSummary[]>('/team-sales-today')
export const createEmployee = (username: string, password: string) => request<TeamUser>('/users', 'POST', { username, password })
export const setEmployeeActive = (id: string, active: boolean) => request<TeamUser>(`/users/${id}/active`, 'PATCH', { active })
export const resetEmployeePassword = (id: string, password: string) => request<{ ok: true }>(`/users/${id}/password`, 'POST', { password })

export const listProducts = () => request<Product[]>('/products')
export const getSummary = () => request<Summary>('/summary')
export const listMovements = () => request<Movement[]>('/movements')
export const listSales = () => request<Sale[]>('/sales')
export const getSaleReceipt = (id: string) => request<SaleReceipt>(`/sales/${id}`)
export const recordSale = (lines: SaleLineInput[], paymentMethod: PaymentMethod, cashReceived: number | null) => request<SaleReceipt>('/sales', 'POST', { lines, paymentMethod, cashReceived })
export const createProduct = (input: ProductInput) => request<{ ok: true }>('/products', 'POST', input)
export const updateProduct = (id: string, input: ProductInput) => request<{ ok: true }>(`/products/${id}`, 'PUT', input)
export const importProducts = (inputs: ProductInput[]) => request<number>('/import', 'POST', { inputs })
export const adjustStock = (id: string, change: number, reason: string) => request<{ ok: true }>('/adjust', 'POST', { id, change, reason })
