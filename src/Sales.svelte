<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Plus, Printer, ReceiptText, Trash2 } from 'lucide-svelte'
  import { getSaleReceipt, recordSale, type PaymentMethod, type Product, type Sale, type SaleLineInput, type SaleReceipt } from './api'
  import { formatMoney } from './money'

  export let products: Product[] = []
  export let sales: Sale[] = []
  export let loading = false

  const dispatch = createEventDispatcher<{ recorded: SaleReceipt }>()
  let productId = ''
  let quantity = 1
  let cart: SaleLineInput[] = []
  let paymentMethod: PaymentMethod = 'cash'
  let cashReceived = 0
  let receipt: SaleReceipt | null = null
  let busy = false
  let error = ''
  let checkoutError = ''

  $: sellable = products.filter(product => product.quantity > 0 && product.price > 0)
  $: cartItems = cart.map(line => ({ ...line, product: products.find(product => product.id === line.productId) }))
  $: total = cartItems.reduce((sum, line) => sum + (line.product?.price ?? 0) * line.quantity, 0)

  function addToCart() {
    error = ''
    checkoutError = ''
    const product = products.find(item => item.id === productId)
    const amount = Number(quantity)
    if (!product) { error = 'Choose a product.'; return }
    if (!Number.isInteger(amount) || amount <= 0) { error = 'Enter a positive whole number.'; return }
    const existing = cart.find(line => line.productId === product.id)
    if (amount + (existing?.quantity ?? 0) > product.quantity) { error = `Only ${product.quantity} ${product.unit} available.`; return }
    cart = existing
      ? cart.map(line => line.productId === product.id ? { ...line, quantity: line.quantity + amount } : line)
      : [...cart, { productId: product.id, quantity: amount }]
    quantity = 1
    productId = ''
  }

  function removeFromCart(id: string) { cart = cart.filter(line => line.productId !== id) }

  async function completeSale() {
    if (busy) return
    checkoutError = ''
    if (!cart.length) { checkoutError = 'Click Add to put a product in this sale before recording it.'; return }
    busy = true
    try {
      if (paymentMethod === 'cash' && (!Number.isSafeInteger(Number(cashReceived)) || Number(cashReceived) < total)) throw new Error('Cash received is less than the sale total.')
      receipt = await recordSale(cart, paymentMethod, paymentMethod === 'cash' ? Number(cashReceived) : null)
      cart = []
      productId = ''
      quantity = 1
      cashReceived = 0
      dispatch('recorded', receipt)
    } catch (cause) { checkoutError = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }

  async function showReceipt(id: string) {
    error = ''
    try { receipt = await getSaleReceipt(id) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }
</script>

<div class="page-heading"><div><h1>Sales</h1><p>Record completed sales and review receipts</p></div></div>
{#if error}<div class="form-error" role="alert">{error}</div>{/if}
<div class="sales-grid">
  <section class="panel sale-builder">
    <div class="panel-heading"><h2>New sale</h2></div>
    <form class="sale-form" on:submit|preventDefault={addToCart}>
      <label>Product
        <select bind:value={productId} required>
          <option value="">Choose a product</option>
          {#each sellable as product}<option value={product.id}>{product.name} · {product.sku} · {formatMoney(product.price)} · {product.quantity} left</option>{/each}
        </select>
      </label>
      <label>Quantity<input type="number" min="1" step="1" bind:value={quantity} required /></label>
      <button class="secondary-button" type="submit"><Plus size={16} /> Add</button>
    </form>
    {#if !sellable.length}<p class="sale-hint">Add stock and a selling price to a product to start a sale.</p>{/if}
    <div class="sale-cart">
      {#if !cartItems.length}<div class="empty"><ReceiptText size={25} /><strong>No items added</strong><span>Choose a product and quantity, then click Add.</span></div>
      {:else}
        {#each cartItems as line (line.productId)}
          <div class="sale-cart-row"><div><strong>{line.product?.name ?? 'Product unavailable'}</strong><span>{line.quantity} × {formatMoney(line.product?.price ?? 0)}</span></div><strong>{formatMoney((line.product?.price ?? 0) * line.quantity)}</strong><button type="button" aria-label={`Remove ${line.product?.name ?? 'product'}`} on:click={() => removeFromCart(line.productId)}><Trash2 size={16} /></button></div>
        {/each}
      {/if}
    </div>
    <div class="sale-total"><span>Total</span><strong>{formatMoney(total)}</strong></div>
    <div class="sale-payment"><label>Payment method<select bind:value={paymentMethod}><option value="cash">Cash</option><option value="card">Card (paid externally)</option><option value="transfer">Transfer (paid externally)</option></select></label>{#if paymentMethod === 'cash'}<label>Cash received (Rp)<input type="number" min={total} step="1" bind:value={cashReceived} /></label><div class="sale-change">Change <strong>{formatMoney(Math.max(0, Number(cashReceived) - total))}</strong></div>{/if}</div>
    <div class="sale-complete">{#if checkoutError}<span class="sale-inline-error" role="alert">{checkoutError}</span>{/if}<button class="primary-button" type="button" disabled={busy} aria-busy={busy} on:click={completeSale}>{busy ? 'Recording…' : 'Record sale'}</button></div>
  </section>

  <section class="panel sale-history">
    <div class="panel-heading"><h2>Recent sales</h2><span class="muted">Latest 100</span></div>
    {#if loading}<div class="empty">Loading sales…</div>
    {:else if !sales.length}<div class="empty"><ReceiptText size={25} /><strong>No sales yet</strong><span>Recorded sales will appear here.</span></div>
    {:else}<div class="sale-list">{#each sales as sale}<button type="button" class:selected={receipt?.sale.id === sale.id} on:click={() => showReceipt(sale.id)}><span><strong>{sale.reference}</strong><small>{formatDate(sale.createdAt)} · {sale.recordedBy ?? 'Earlier record'}</small></span><strong>{formatMoney(sale.total)}</strong></button>{/each}</div>{/if}
  </section>
</div>

{#if receipt}
  <section class="panel receipt-panel" aria-label="Sale receipt">
    <div class="panel-heading"><div><h2>Receipt {receipt.sale.reference}</h2><p>{formatDate(receipt.sale.createdAt)} · Recorded by {receipt.sale.recordedBy ?? 'earlier staff'}</p></div><button class="secondary-button print-button" on:click={() => window.print()}><Printer size={16} /> Print</button></div>
    <div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>QTY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead><tbody>{#each receipt.items as item}<tr><td><strong>{item.productName}</strong><br /><span class="muted">{item.sku}</span></td><td>{item.quantity}</td><td>{formatMoney(item.unitPrice)}</td><td><strong>{formatMoney(item.lineTotal)}</strong></td></tr>{/each}</tbody></table></div>
    <div class="sale-total receipt-total"><span>Total</span><strong>{formatMoney(receipt.sale.total)}</strong></div>
    <div class="receipt-payment"><span>Payment: {receipt.sale.paymentMethod === 'cash' ? 'Cash' : receipt.sale.paymentMethod === 'card' ? 'Card' : 'Transfer'}</span>{#if receipt.sale.cashReceived !== null}<span>Received: {formatMoney(receipt.sale.cashReceived)}</span><strong>Change: {formatMoney(receipt.sale.changeDue ?? 0)}</strong>{/if}</div>
  </section>
{/if}
