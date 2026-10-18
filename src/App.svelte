<script lang="ts">
  import { onMount } from 'svelte'
  import { Archive, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ClipboardList, Download, LayoutDashboard, LogOut, Package, Plus, ReceiptText, Search, TrendingDown, Upload, UserRound, Users, X } from 'lucide-svelte'
  import { adjustStock, createProduct, getSession, getSummary, importProducts, listMovements, listProducts, listSales, logout, updateProduct, type Movement, type Product, type ProductInput, type Sale, type Summary, type User } from './api'
  import { parseProductsCsv, productTemplateCsv, productsToCsv } from './csv'
  import { formatMoney } from './money'
  import Sales from './Sales.svelte'
  import Auth from './Auth.svelte'
  import Team from './Team.svelte'
  import Account from './Account.svelte'

  type Page = 'overview' | 'inventory' | 'sales' | 'activity' | 'team' | 'account'
  type Modal = 'product' | 'adjust' | 'import' | null
  let page: Page = 'overview'
  let user: User | null = null
  let needsSetup = false
  let authLoading = true
  let authError = ''
  let modal: Modal = null
  let products: Product[] = []
  let movements: Movement[] = []
  let sales: Sale[] = []
  let summary: Summary = { salesToday: 0, revenueToday: 0 }
  let loading = true
  let saving = false
  let error = ''
  let formError = ''
  let notice = ''
  let search = ''
  let filter: 'all' | 'low' = 'all'
  let editingId: string | null = null
  let selectedProduct: Product | null = null
  let adjustment = 1
  let adjustmentType: 'in' | 'out' = 'in'
  let reason = ''
  let importRows: ProductInput[] = []
  let importFileName = ''
  const emptyProduct = (): ProductInput => ({ name: '', sku: '', category: '', quantity: 0, reorderLevel: 5, unit: 'pcs', price: 0 })
  let form = emptyProduct()

  $: lowStock = products.filter(item => item.quantity <= item.reorderLevel)
  $: filteredProducts = products.filter(item => {
    const matches = `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(search.toLowerCase().trim())
    return matches && (filter === 'all' || item.quantity <= item.reorderLevel)
  })
  $: shownProducts = page === 'overview' ? filteredProducts.slice(0, 6) : filteredProducts

  function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
  async function refresh() {
    try {
      error = ''
      ;[products, movements, sales, summary] = await Promise.all([listProducts(), listMovements(), listSales(), getSummary()])
      products = [...products].sort((a, b) => a.name.localeCompare(b.name))
    } catch (err) { error = message(err) }
    finally { loading = false }
  }
  onMount(() => { loadSession() })

  async function loadSession() {
    authLoading = true
    try {
      const session = await getSession()
      user = session.user
      needsSetup = session.needsSetup
      authError = ''
      if (user) await refresh()
    } catch (err) { authError = message(err) }
    finally { authLoading = false }
  }
  function signedIn(next: User) { user = next; needsSetup = false; page = 'overview'; refresh() }
  async function signOut() {
    try { await logout() } catch { /* Expired sessions are already signed out. */ }
    user = null; modal = null; page = 'overview'; products = []; movements = []; sales = []; summary = { salesToday: 0, revenueToday: 0 }
  }

  function openNew() { editingId = null; form = emptyProduct(); formError = ''; modal = 'product' }
  function openEdit(item: Product) {
    editingId = item.id
    form = { name: item.name, sku: item.sku, category: item.category, quantity: item.quantity, reorderLevel: item.reorderLevel, unit: item.unit, price: item.price }
    formError = ''; modal = 'product'
  }
  function openAdjust(item: Product) { selectedProduct = item; adjustment = 1; adjustmentType = 'in'; reason = ''; formError = ''; modal = 'adjust' }
  function openImport() { importRows = []; importFileName = ''; formError = ''; modal = 'import' }
  function closeModal() { if (!saving) { modal = null; formError = '' } }
  function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') closeModal() }
  async function saveProduct() {
    formError = ''
    const input = { ...form, name: form.name.trim(), sku: form.sku.trim(), category: form.category.trim(), unit: form.unit.trim(), quantity: Number(form.quantity), reorderLevel: Number(form.reorderLevel), price: Number(form.price) }
    if (!input.name || !input.sku || !input.category || !input.unit) { formError = 'Please complete all fields.'; return }
    if (![input.quantity, input.reorderLevel].every(value => Number.isInteger(value) && value >= 0 && value <= 2147483647)) { formError = 'Quantities must be whole numbers between 0 and 2,147,483,647.'; return }
    if (!Number.isSafeInteger(input.price) || input.price < 0 || input.price > 9_000_000_000_000) { formError = 'Enter a valid whole rupiah price.'; return }
    saving = true
    try {
      if (editingId) await updateProduct(editingId, input)
      else await createProduct(input)
      modal = null; notice = editingId ? 'Product updated.' : 'Product added.'; await refresh()
    } catch (err) { formError = message(err) }
    finally { saving = false }
  }
  async function saveAdjustment() {
    formError = ''
    const amount = Number(adjustment)
    if (!selectedProduct || !Number.isInteger(amount) || amount <= 0 || amount > 2147483647) { formError = 'Enter a positive whole number.'; return }
    if (!reason.trim()) { formError = 'Add a reason for this stock movement.'; return }
    saving = true
    try {
      await adjustStock(selectedProduct.id, adjustmentType === 'in' ? amount : -amount, reason.trim())
      modal = null; notice = 'Stock movement recorded.'; await refresh()
    } catch (err) { formError = message(err) }
    finally { saving = false }
  }
  async function chooseImportFile(event: Event) {
    importRows = []
    formError = ''
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    importFileName = file.name
    if (file.size > 1024 * 1024) { formError = 'Choose a CSV file under 1 MB.'; return }
    try { importRows = parseProductsCsv(await file.text(), products) }
    catch (err) { formError = message(err) }
  }
  async function saveImport() {
    if (!importRows.length) return
    saving = true
    formError = ''
    try {
      const count = await importProducts(importRows)
      modal = null
      notice = `${count} ${count === 1 ? 'product' : 'products'} imported.`
      await refresh()
    } catch (err) { formError = message(err) }
    finally { saving = false }
  }
  function downloadCsv(filename: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  function showInventory(low = false) { page = 'inventory'; filter = low ? 'low' : 'all'; search = '' }
  function formatDate(date: string) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)) }
</script>

<svelte:window on:keydown={closeOnEscape} />

{#if authLoading}<div class="auth-screen">Loading Stockroom…</div>
{:else if !user}<Auth {needsSetup} serverError={authError} on:signedIn={event => signedIn(event.detail)} on:retry={loadSession} />
{:else}
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark"><Archive size={19} strokeWidth={1.7} /></div><div><strong>stockroom</strong></div></div>
    <nav aria-label="Main navigation">
      <button class:active={page === 'overview'} on:click={() => { page = 'overview'; filter = 'all'; search = '' }}><LayoutDashboard size={18} /> Overview</button>
      <button class:active={page === 'inventory'} on:click={() => showInventory()}><Package size={18} /> Inventory <span class="nav-count">{products.length}</span></button>
      <button class:active={page === 'sales'} on:click={() => page = 'sales'}><ReceiptText size={18} /> Sales</button>
      <button class:active={page === 'activity'} on:click={() => page = 'activity'}><ClipboardList size={18} /> Stock activity</button>
      {#if user.role === 'owner'}<button class:active={page === 'team'} on:click={() => page = 'team'}><Users size={18} /> Team</button>{/if}
    </nav>
    <div class="sidebar-art" aria-hidden="true">
      <svg viewBox="0 0 180 150" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="96" cy="69" r="61" fill="#D3DFC2" fill-opacity=".13" />
        <circle cx="139" cy="24" r="7" fill="#F2C8A9" fill-opacity=".9" />
        <path d="M17 126H164" stroke="#A9C2A9" stroke-width="2" stroke-linecap="round" />
        <rect x="27" y="79" width="55" height="46" rx="6" fill="#EDC5A7" />
        <path d="M27 92H82M54.5 79V125" stroke="#D69D7B" stroke-width="2" />
        <rect x="89" y="65" width="54" height="60" rx="6" fill="#DAE7D4" />
        <path d="M89 79H143M116 65V125" stroke="#A8C2AD" stroke-width="2" />
        <rect x="46" y="53" width="35" height="26" rx="5" fill="#F4E5C4" />
        <path d="M63.5 53V79" stroke="#D9C49B" stroke-width="2" />
        <path d="M149 119C142 104 144 89 154 79M152 101C161 93 161 85 159 79M149 105C139 102 136 95 137 90" stroke="#A9CBA9" stroke-width="3" stroke-linecap="round" />
      </svg>
    </div>
  </aside>

  <main>
    <div class="topbar"><div class="topbar-right"><span class:error={!!error} class="status-dot"></span>{error ? 'SERVER UNAVAILABLE' : 'CONNECTED'}<button class="topbar-link" on:click={() => page = 'account'}><UserRound size={15} /> {user.username}</button><button class="topbar-link" on:click={signOut}><LogOut size={15} /> Sign out</button></div></div>
    <div class="content">
      {#if notice}<div class="notice"><Check size={16} /> {notice}<button aria-label="Dismiss notification" on:click={() => notice = ''}><X size={15} /></button></div>{/if}
      {#if error}<div class="error-banner"><strong>Unable to load inventory.</strong> {error} <button on:click={refresh}>Try again</button></div>{/if}

       {#if page === 'team' && user.role === 'owner'}
         <Team />
       {:else if page === 'account'}
         <Account {user} on:signedOut={() => signOut()} />
       {:else if page === 'sales'}
         <Sales {products} {sales} {loading} on:recorded={() => { notice = 'Sale recorded and stock updated.'; refresh() }} />
       {:else if page === 'activity'}
        <div class="page-heading"><div><h1>Stock activity</h1><p>Latest 50 stock movements</p></div></div>
        <section class="panel activity-panel"><div class="panel-heading"><h2>Recent movements</h2></div>
          {#if loading}<div class="empty">Loading activity…</div>
          {:else if !movements.length}<div class="empty"><ClipboardList size={26} /><strong>No movements yet</strong><span>Stock changes will appear here.</span></div>
          {:else}<div class="movement-list">{#each movements as movement}<div class="movement"><div class:out={movement.change < 0} class="movement-icon">{#if movement.change < 0}<ArrowUpRight size={17} />{:else}<ArrowDownLeft size={17} />{/if}</div><div class="movement-name"><strong>{movement.productName}</strong><span>{movement.sku} · {movement.reason} · {movement.recordedBy ?? 'Earlier record'}</span></div><span class="movement-date">{formatDate(movement.createdAt)}</span><strong class:negative={movement.change < 0} class="movement-change">{movement.change > 0 ? '+' : ''}{movement.change}</strong></div>{/each}</div>{/if}
        </section>
      {:else}
        <div class="page-heading"><div><h1>{page === 'overview' ? 'Overview' : 'Inventory'}</h1>{#if page === 'inventory'}<p>{products.length} products · {lowStock.length} low stock</p>{/if}</div><div class="heading-actions">{#if page === 'inventory'}{#if user.role === 'owner'}<button class="secondary-button" on:click={openImport}><Upload size={17} /> Import CSV</button>{/if}<button class="secondary-button" on:click={() => downloadCsv('stockroom-products.csv', productsToCsv(products))}><Download size={17} /> Export CSV</button>{/if}{#if user.role === 'owner'}<button class="primary-button" on:click={openNew}><Plus size={18} /> Add product</button>{/if}</div></div>

        {#if page === 'overview'}
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-top"><span>PRODUCTS</span><div class="stat-icon sage"><Package size={18} /></div></div><strong>{products.length.toLocaleString()}</strong></div>
            <div class="stat-card"><div class="stat-top"><span>LOW STOCK</span><div class="stat-icon blush"><TrendingDown size={18} /></div></div><strong>{lowStock.length.toLocaleString()}</strong></div>
            <div class="stat-card"><div class="stat-top"><span>SALES TODAY</span><div class="stat-icon sand"><ReceiptText size={18} /></div></div><strong>{summary.salesToday.toLocaleString()}</strong></div>
            <div class="stat-card"><div class="stat-top"><span>REVENUE TODAY</span><div class="stat-icon lilac"><ReceiptText size={18} /></div></div><strong class="stat-money">{formatMoney(summary.revenueToday)}</strong></div>
          </div>
          {#if products.length}<div class="insight"><div class="insight-symbol"><TrendingDown size={20} /></div><div><strong>{lowStock.length ? `${lowStock.length} ${lowStock.length === 1 ? 'product is' : 'products are'} at or below reorder level` : 'No products need reordering'}</strong></div>{#if lowStock.length}<button on:click={() => showInventory(true)}>Review low stock <ArrowRight size={16} /></button>{/if}</div>{/if}
        {/if}

        <section class="panel inventory-panel">{#if page === 'overview'}<div class="panel-heading"><h2>Products <span class="heading-count">{products.length}</span></h2><button class="text-button" on:click={() => showInventory()}>View all <ArrowRight size={16} /></button></div>{/if}
          <div class:inventory-tools={page === 'inventory'} class="table-tools"><label class="search"><Search size={17} /><input placeholder="Search by name, SKU or category" bind:value={search} aria-label="Search products" /></label><div class="filter-buttons"><button class:selected={filter === 'all'} on:click={() => filter = 'all'}>All products</button><button class:selected={filter === 'low'} on:click={() => filter = 'low'}>Low stock {lowStock.length > 0 ? `(${lowStock.length})` : ''}</button></div></div>
          {#if loading}<div class="empty">Loading products…</div>
          {:else if !shownProducts.length}<div class="empty"><Package size={26} /><strong>{products.length ? 'No products found' : 'No products yet'}</strong><span>{products.length ? 'Try another search or filter.' : 'Add a product or import a CSV to start.'}</span></div>
           {:else}<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>IN STOCK</th><th>REORDER AT</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>{#each shownProducts as item}<tr><td><div class="product-cell"><div class="product-icon"><Package size={17} /></div><div><strong>{item.name}</strong><span>{item.sku}</span></div></div></td><td><span class="category">{item.category}</span></td><td>{item.price ? formatMoney(item.price) : 'Set price'}</td><td><strong class="quantity">{item.quantity}</strong> <span class="muted">{item.unit}</span></td><td class="muted">{item.reorderLevel} {item.unit}</td><td>{#if item.quantity <= item.reorderLevel}<span class="badge low"><span></span>Low stock</span>{:else}<span class="badge healthy"><span></span>In stock</span>{/if}</td><td>{#if user.role === 'owner'}<div class="row-actions"><button on:click={() => openAdjust(item)}>Adjust</button><button on:click={() => openEdit(item)}>Edit</button></div>{/if}</td></tr>{/each}</tbody></table></div>{/if}
          <div class="table-footer"><span>Showing {shownProducts.length} of {filteredProducts.length} products</span></div>
        </section>
      {/if}
    </div>
  </main>
</div>

{#if modal}
  <div class="modal-backdrop" role="presentation" on:click|self={closeModal}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-heading"><div><h2 id="modal-title">{modal === 'product' ? (editingId ? 'Edit product' : 'Add product') : modal === 'import' ? 'Import products' : 'Adjust stock'}</h2>{#if modal === 'adjust'}<p>{selectedProduct?.name}</p>{/if}</div><button class="close-button" aria-label="Close dialog" on:click={closeModal}><X size={20} /></button></div>
      {#if formError}<div class="form-error" role="alert">{formError}</div>{/if}
      {#if modal === 'product'}
        <form on:submit|preventDefault={saveProduct}>
          <label>Product name<input bind:value={form.name} maxlength="120" placeholder="e.g. House blend beans" required /></label>
          <div class="field-row"><label>SKU<input bind:value={form.sku} maxlength="50" placeholder="e.g. CFE-012" required /></label><label>Category<input bind:value={form.category} maxlength="60" placeholder="e.g. Coffee" required /></label></div>
          <div class="field-row"><label>Unit<input bind:value={form.unit} maxlength="30" placeholder="e.g. bags" required /></label><label>Reorder level<input type="number" min="0" max="2147483647" step="1" bind:value={form.reorderLevel} required /></label></div>
           <label>Selling price (Rp)<input type="number" min="0" max="9000000000000" step="1" bind:value={form.price} required /></label>
          {#if !editingId}<label>Opening stock<input type="number" min="0" max="2147483647" step="1" bind:value={form.quantity} required /></label>{:else}<p class="form-hint">To change quantity, use Adjust so a stock movement is recorded.</p>{/if}
          <div class="modal-actions"><button class="secondary-button" type="button" on:click={closeModal}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add product'}</button></div>
        </form>
      {:else if modal === 'adjust'}
        <form on:submit|preventDefault={saveAdjustment}>
          <div class="current-stock">Current stock <strong>{selectedProduct?.quantity} {selectedProduct?.unit}</strong></div>
          <div class="adjust-toggle"><button type="button" class:selected={adjustmentType === 'in'} on:click={() => adjustmentType = 'in'}>Stock in</button><button type="button" class:selected={adjustmentType === 'out'} on:click={() => adjustmentType = 'out'}>Stock out</button></div>
          <label>Quantity<input type="number" min="1" max="2147483647" step="1" bind:value={adjustment} required /></label>
          <label>Reason<input bind:value={reason} maxlength="160" placeholder="e.g. New delivery or damaged stock" required /></label>
          <div class="modal-actions"><button class="secondary-button" type="button" on:click={closeModal}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record movement'}</button></div>
        </form>
      {:else}
        <div class="import-content">
          <p>CSV columns: name, sku, category, quantity, reorder_level, unit, price (Rp). Older files without price also work.</p>
          <button class="text-button" type="button" on:click={() => downloadCsv('stockroom-template.csv', productTemplateCsv())}><Download size={16} /> Download template</button>
          <label>Choose CSV file<input type="file" accept=".csv,text/csv" on:change={chooseImportFile} /></label>
          {#if importRows.length}<div class="import-summary"><strong>{importRows.length} {importRows.length === 1 ? 'product' : 'products'} ready</strong><span>{importFileName}</span></div>{/if}
          <p>Existing or repeated SKUs are rejected. If any row fails, nothing is imported.</p>
          <div class="modal-actions"><button class="secondary-button" type="button" on:click={closeModal}>Cancel</button><button class="primary-button" type="button" disabled={saving || !importRows.length} on:click={saveImport}>{saving ? 'Importing…' : `Import ${importRows.length || ''} products`}</button></div>
        </div>
      {/if}
    </div>
  </div>
{/if}
{/if}
