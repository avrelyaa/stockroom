<script lang="ts">
  import { onMount } from 'svelte'
  import { Archive, ArrowDownLeft, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ClipboardList, LayoutDashboard, Leaf, Package, Plus, Search, SlidersHorizontal, Sparkles, TrendingDown, X } from 'lucide-svelte'
  import { adjustStock, createProduct, listMovements, listProducts, previewMode, updateProduct, type Movement, type Product, type ProductInput } from './api'

  type Page = 'overview' | 'inventory' | 'activity'
  type Modal = 'product' | 'adjust' | null
  let page: Page = 'overview'
  let modal: Modal = null
  let products: Product[] = []
  let movements: Movement[] = []
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
  const emptyProduct = (): ProductInput => ({ name: '', sku: '', category: '', quantity: 0, reorderLevel: 5, unit: 'pcs' })
  let form = emptyProduct()

  $: lowStock = products.filter(item => item.quantity <= item.reorderLevel)
  $: totalUnits = products.reduce((sum, item) => sum + item.quantity, 0)
  $: categories = new Set(products.map(item => item.category.toLowerCase())).size
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
      ;[products, movements] = await Promise.all([listProducts(), listMovements()])
      products = [...products].sort((a, b) => a.name.localeCompare(b.name))
    } catch (err) { error = message(err) }
    finally { loading = false }
  }
  onMount(refresh)

  function openNew() { editingId = null; form = emptyProduct(); formError = ''; modal = 'product' }
  function openEdit(item: Product) {
    editingId = item.id
    form = { name: item.name, sku: item.sku, category: item.category, quantity: item.quantity, reorderLevel: item.reorderLevel, unit: item.unit }
    formError = ''; modal = 'product'
  }
  function openAdjust(item: Product) { selectedProduct = item; adjustment = 1; adjustmentType = 'in'; reason = ''; formError = ''; modal = 'adjust' }
  function closeModal() { if (!saving) { modal = null; formError = '' } }
  function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') closeModal() }
  async function saveProduct() {
    formError = ''
    const input = { ...form, name: form.name.trim(), sku: form.sku.trim(), category: form.category.trim(), unit: form.unit.trim(), quantity: Number(form.quantity), reorderLevel: Number(form.reorderLevel) }
    if (!input.name || !input.sku || !input.category || !input.unit) { formError = 'Please complete all fields.'; return }
    if (![input.quantity, input.reorderLevel].every(value => Number.isInteger(value) && value >= 0 && value <= 2147483647)) { formError = 'Quantities must be whole numbers between 0 and 2,147,483,647.'; return }
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
  function showInventory(low = false) { page = 'inventory'; filter = low ? 'low' : 'all'; search = '' }
  function formatDate(date: string) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)) }
</script>

<svelte:window on:keydown={closeOnEscape} />

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark"><Archive size={19} strokeWidth={1.7} /></div><div><strong>stockroom</strong><span>INVENTORY WORKSPACE</span></div></div>
    <div class="nav-label">WORKSPACE</div>
    <nav aria-label="Main navigation">
      <button class:active={page === 'overview'} on:click={() => { page = 'overview'; filter = 'all'; search = '' }}><LayoutDashboard size={18} /> Overview</button>
      <button class:active={page === 'inventory'} on:click={() => showInventory()}><Box size={18} /> Inventory <span class="nav-count">{products.length}</span></button>
      <button class:active={page === 'activity'} on:click={() => page = 'activity'}><ClipboardList size={18} /> Stock activity</button>
    </nav>
    <div class="sidebar-bottom"><div class="sidebar-icon"><Leaf size={19} /></div><p>A little more clarity<br /><strong>for your everyday.</strong></p><span>STOCKROOM / 01</span></div>
  </aside>

  <main>
    <div class="topbar"><div class="breadcrumbs">WORKSPACE <span>/</span> {page.toUpperCase()}</div><div class="topbar-right"><span class="status-dot"></span>{previewMode ? 'PREVIEW MODE' : 'DESKTOP WORKSPACE'}<div class="avatar">S</div></div></div>
    <div class="content">
      {#if previewMode}<div class="preview-banner"><Sparkles size={15} /> Browser preview uses sample data stored in this browser. The desktop app uses PostgreSQL.</div>{/if}
      {#if notice}<div class="notice"><Check size={16} /> {notice}<button aria-label="Dismiss notification" on:click={() => notice = ''}><X size={15} /></button></div>{/if}
      {#if error}<div class="error-banner"><strong>Unable to load inventory.</strong> {error} <button on:click={refresh}>Try again</button></div>{/if}

      {#if page === 'activity'}
        <div class="page-heading"><div><div class="eyebrow">YOUR INVENTORY, IN MOTION</div><h1>Stock activity<span>.</span></h1><p>A record of what came in, what went out, and why.</p></div><button class="secondary-button" on:click={() => showInventory()}><ArrowRight size={17} /> View inventory</button></div>
        <section class="panel activity-panel"><div class="panel-heading"><div><h2>Recent movements</h2><p>The latest 50 stock changes</p></div><span class="small-label">ACTIVITY LOG</span></div>
          {#if loading}<div class="empty">Loading activity…</div>
          {:else if !movements.length}<div class="empty"><ClipboardList size={26} /><strong>No movements yet</strong><span>Stock changes will appear here when you adjust a product.</span></div>
          {:else}<div class="movement-list">{#each movements as movement}<div class="movement"><div class:out={movement.change < 0} class="movement-icon">{#if movement.change < 0}<ArrowUpRight size={17} />{:else}<ArrowDownLeft size={17} />{/if}</div><div class="movement-name"><strong>{movement.productName}</strong><span>{movement.sku} · {movement.reason}</span></div><span class="movement-date">{formatDate(movement.createdAt)}</span><strong class:negative={movement.change < 0} class="movement-change">{movement.change > 0 ? '+' : ''}{movement.change}</strong></div>{/each}</div>{/if}
        </section>
      {:else}
        <div class="page-heading"><div><div class="eyebrow">{page === 'overview' ? 'A BETTER VIEW OF YOUR STOCK' : 'EVERYTHING IN ITS PLACE'}</div><h1>{page === 'overview' ? 'The overview' : 'Your inventory'}<span>.</span></h1><p>{page === 'overview' ? 'A little clarity for everything you keep in stock.' : 'Keep track of your products, quantities, and reorder levels.'}</p></div><button class="primary-button" on:click={openNew}><Plus size={18} /> Add product</button></div>

        {#if page === 'overview'}
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-top"><span>PRODUCTS</span><div class="stat-icon sage"><Box size={18} /></div></div><strong>{products.length.toString().padStart(2, '0')}</strong><p>Products in your inventory</p></div>
            <div class="stat-card"><div class="stat-top"><span>TOTAL UNITS</span><div class="stat-icon sand"><Package size={18} /></div></div><strong>{totalUnits.toLocaleString()}</strong><p>Items across all products</p></div>
            <div class="stat-card"><div class="stat-top"><span>LOW STOCK</span><div class="stat-icon blush"><TrendingDown size={18} /></div></div><strong>{lowStock.length.toString().padStart(2, '0')}</strong><p>Products to keep an eye on</p></div>
            <div class="stat-card"><div class="stat-top"><span>CATEGORIES</span><div class="stat-icon lilac"><SlidersHorizontal size={18} /></div></div><strong>{categories.toString().padStart(2, '0')}</strong><p>Ways you've organised stock</p></div>
          </div>
          <div class="insight"><div class="insight-symbol"><Sparkles size={20} /></div><div><span>YOUR STOCK AT A GLANCE</span><strong>{lowStock.length ? `${lowStock.length} ${lowStock.length === 1 ? 'product needs' : 'products need'} your attention.` : 'Everything is looking good.'}</strong><p>{lowStock.length ? 'A few items are running low. A little restock goes a long way.' : 'No products are at or below their reorder level.'}</p></div><button on:click={() => showInventory(true)}>View low stock <ArrowRight size={16} /></button></div>
        {/if}

        <section class="panel inventory-panel"><div class="panel-heading"><div><h2>{page === 'overview' ? 'Your products' : 'All products'} <span class="heading-count">{products.length}</span></h2><p>{page === 'overview' ? 'A closer look at what’s on your shelves.' : 'Search and manage your inventory.'}</p></div>{#if page === 'overview'}<button class="text-button" on:click={() => showInventory()}>View all products <ArrowRight size={16} /></button>{/if}</div>
          <div class="table-tools"><label class="search"><Search size={17} /><input placeholder="Search by name, SKU or category" bind:value={search} aria-label="Search products" /></label><div class="filter-buttons"><button class:selected={filter === 'all'} on:click={() => filter = 'all'}>All products</button><button class:selected={filter === 'low'} on:click={() => filter = 'low'}>Low stock {lowStock.length > 0 ? `(${lowStock.length})` : ''}</button></div></div>
          {#if loading}<div class="empty">Loading products…</div>
          {:else if !shownProducts.length}<div class="empty"><Box size={26} /><strong>No products found</strong><span>{products.length ? 'Try another search or filter.' : 'Add your first product to get started.'}</span></div>
          {:else}<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>IN STOCK</th><th>REORDER AT</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>{#each shownProducts as item}<tr><td><div class="product-cell"><div class="product-icon"><Package size={17} /></div><div><strong>{item.name}</strong><span>{item.sku}</span></div></div></td><td><span class="category">{item.category}</span></td><td><strong class="quantity">{item.quantity}</strong> <span class="muted">{item.unit}</span></td><td class="muted">{item.reorderLevel} {item.unit}</td><td>{#if item.quantity <= item.reorderLevel}<span class="badge low"><span></span>Low stock</span>{:else}<span class="badge healthy"><span></span>In stock</span>{/if}</td><td><div class="row-actions"><button on:click={() => openAdjust(item)}>Adjust</button><button on:click={() => openEdit(item)}>Edit</button></div></td></tr>{/each}</tbody></table></div>{/if}
          <div class="table-footer"><span>Showing {shownProducts.length} of {filteredProducts.length} products</span><span>STOCKROOM INVENTORY</span></div>
        </section>
      {/if}
      <footer><span>Made for the little things that add up.</span><span>STOCKROOM &nbsp; · &nbsp; YOUR INVENTORY, SIMPLIFIED</span></footer>
    </div>
  </main>
</div>

{#if modal}
  <div class="modal-backdrop" role="presentation" on:click|self={closeModal}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-heading"><div><div class="eyebrow">{modal === 'product' ? 'YOUR INVENTORY' : 'STOCK MOVEMENT'}</div><h2 id="modal-title">{modal === 'product' ? (editingId ? 'Edit product' : 'Add a product') : 'Adjust stock'}</h2><p>{modal === 'product' ? 'Keep the essentials in one place.' : `Update the quantity for ${selectedProduct?.name}.`}</p></div><button class="close-button" aria-label="Close dialog" on:click={closeModal}><X size={20} /></button></div>
      {#if formError}<div class="form-error" role="alert">{formError}</div>{/if}
      {#if modal === 'product'}
        <form on:submit|preventDefault={saveProduct}>
          <label>Product name<input bind:value={form.name} maxlength="120" placeholder="e.g. House blend beans" required /></label>
          <div class="field-row"><label>SKU<input bind:value={form.sku} maxlength="50" placeholder="e.g. CFE-012" required /></label><label>Category<input bind:value={form.category} maxlength="60" placeholder="e.g. Coffee" required /></label></div>
          <div class="field-row"><label>Unit<input bind:value={form.unit} maxlength="30" placeholder="e.g. bags" required /></label><label>Reorder level<input type="number" min="0" max="2147483647" step="1" bind:value={form.reorderLevel} required /></label></div>
          {#if !editingId}<label>Opening stock<input type="number" min="0" max="2147483647" step="1" bind:value={form.quantity} required /></label>{:else}<p class="form-hint">To change quantity, use Adjust so a stock movement is recorded.</p>{/if}
          <div class="modal-actions"><button class="secondary-button" type="button" on:click={closeModal}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add product'}</button></div>
        </form>
      {:else}
        <form on:submit|preventDefault={saveAdjustment}>
          <div class="current-stock">Current stock <strong>{selectedProduct?.quantity} {selectedProduct?.unit}</strong></div>
          <div class="adjust-toggle"><button type="button" class:selected={adjustmentType === 'in'} on:click={() => adjustmentType = 'in'}>Stock in</button><button type="button" class:selected={adjustmentType === 'out'} on:click={() => adjustmentType = 'out'}>Stock out</button></div>
          <label>Quantity<input type="number" min="1" max="2147483647" step="1" bind:value={adjustment} required /></label>
          <label>Reason<input bind:value={reason} maxlength="160" placeholder="e.g. New delivery or sale" required /></label>
          <div class="modal-actions"><button class="secondary-button" type="button" on:click={closeModal}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record movement'}</button></div>
        </form>
      {/if}
    </div>
  </div>
{/if}
