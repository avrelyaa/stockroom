# Stockroom

A shared sales and inventory workspace for one store. Stockroom records completed sales, updates stock, and lets the owner control who can change inventory.

An independent project by Kelly Aurelya Tiona ([@avrelyaa](https://github.com/avrelyaa)).

This is a portfolio project in development. It can run as a local web app or a server-hosted web app, but it is not yet a production-ready retail system.

## What it does

- Add and edit products with a unique SKU, category, unit, selling price in Indonesian rupiah, and reorder level.
- Build a sale with multiple products, record cash, card or transfer payments, and print a receipt. Cash sales show the change due; card and transfer payments are recorded after they are completed outside Stockroom.
- Deduct stock and save the sale, its item prices, and stock movements together. If stock is insufficient, none of the sale is saved.
- Record stock coming in or going out, with a reason for each movement.
- Prevent stock from dropping below zero and show products that need attention.
- Search inventory and browse the most recent 50 stock movements.
- Import up to 1,000 products from CSV and export the product list. Imports reject duplicate SKUs and save all rows together.
- Create an owner account and employee accounts. Employees can record sales and view inventory; only the owner can manage users, products, imports, and stock corrections. Sales and stock movements show who recorded them. Disabling an employee revokes their sessions.
- See today's sale count and recorded revenue on the overview; the owner can see today's sales by employee on **Team**. Set `STOCKROOM_TIMEZONE` on the server if the store is outside `Asia/Jakarta`.
- Keep store data in PostgreSQL behind a server. The browser and Tauri development window use the same API and database.

## Stack

Svelte 4 and TypeScript, a Node.js HTTP API, PostgreSQL, and a Tauri 2 development shell. Docker Compose starts local PostgreSQL.

## Run locally in a browser

Requires Node.js and Docker Desktop. In this folder:

```powershell
npm install
docker compose up -d
npm run dev
```

Open `http://localhost:1420/`. The API starts on `127.0.0.1:3001` and Vite proxies `/api` to it. On the first visit, create the owner account with a username and a password of at least 12 characters. Products and sales previously saved in PostgreSQL remain there. Data from the old browser-only preview is separate and is not automatically imported.

## Record a sale

1. In **Inventory**, set a selling price for each product you plan to sell.
2. Open **Sales**, add products and quantities, then select how the customer paid. For cash, enter the amount received.
3. Choose **Record sale**. Stock is deducted and a receipt appears. Use **Print** for a paper or PDF copy; select a sale under **Recent sales** to view it again.

The current sale list shows the latest 100 sales. **Stock activity** shows the latest 50 movements, including sales.

## Run the desktop app

Requires Node.js, a working Rust toolchain, the Windows prerequisites for Tauri (including Microsoft C++ build tools, a Windows SDK and WebView2), and Docker Desktop. On Windows, run this from the project folder:

```powershell
npm install
npm run desktop:dev
```

After the first install, `npm run desktop:dev` is the only command needed. It loads the Visual Studio developer environment, starts PostgreSQL, the API and Vite, then opens the Tauri window. The browser and desktop development window use the same store accounts and data. Keep the terminal open while using the app; press Ctrl+C to stop the development server.

The server creates or updates its tables at startup. PostgreSQL binds only to `127.0.0.1:55432` and uses a named Docker volume so data persists across restarts. The credentials in `compose.yaml` are for local development only.

You can point the server at another PostgreSQL database before starting it:

```powershell
$env:STOCKROOM_DATABASE_URL = 'postgres://USER:PASSWORD@127.0.0.1:5432/stockroom'
npm run server:start
```

The default local PostgreSQL URL is `postgres://stockroom:stockroom_local@127.0.0.1:55432/stockroom`.

## Host the web app

Use a managed PostgreSQL database and an HTTPS reverse proxy. Set `STOCKROOM_DATABASE_URL` to the server-side database connection string, `STOCKROOM_PUBLIC_URL` to the public HTTPS origin, and `STOCKROOM_HOST` to the interface where the reverse proxy can reach the Node server. Run `npm run build`, then `npm run owner:create -- YOUR_USERNAME` in an interactive terminal on the server to create the first owner account, then `npm run server:start`. The server serves the built web app and `/api` from one origin. Keep PostgreSQL private; do not put database credentials in the browser or desktop package. Configure backups and TLS before real use.

The bundled Tauri window is a local development shell. A production desktop release connected to a hosted server needs a separate remote-client configuration; the hosted web app is the deployable path in this version.

To stop the local services without deleting their data, run `docker compose stop`. Avoid `docker compose down -v` unless you intentionally want to permanently remove the database volume.

## Scope and limitations

This version supports one store per server and database. It does not yet include supplier orders, returns, tax rules, discounts, a payment gateway, or automatic backups. Existing products from the previous version receive a price of Rp0 and must be given a selling price before they can be sold. Editing product details does not change the stock count; use **Adjust** to preserve the movement history.

For CSV import, use **Inventory → Import CSV → Download template**. The columns are `name,sku,category,quantity,reorder_level,unit,price`, where price is a whole rupiah amount. Older six-column files are accepted with price set to Rp0. Existing SKUs are rejected; no rows are saved when an import fails. **Export CSV** downloads the full current product list. The CSV export is for moving product data and is not a PostgreSQL backup.
