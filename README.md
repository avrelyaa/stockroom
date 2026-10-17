# Stockroom

A small desktop inventory workspace for independent shops. Stockroom keeps product quantities, reorder levels and a history of stock movements in one place.

An independent project by Kelly Aurelya Tiona ([@avrelyaa](https://github.com/avrelyaa)).

This is a new portfolio project in development, not a deployed or production-ready system.

## What it does

- Add and edit products with a unique SKU, category, unit and reorder level.
- Record stock coming in or going out, with a reason for each movement.
- Prevent stock from dropping below zero and show products that need attention.
- Search inventory and browse the most recent 50 stock movements.
- Store desktop data in PostgreSQL. Redis provides a short-lived product-list cache; the app continues using PostgreSQL if Redis is unavailable.

## Stack

Svelte 4 and TypeScript, Tauri 2 and Rust, PostgreSQL and Redis. Docker Compose provides optional local development services.

## Browser preview

Requires Node.js. In a terminal opened in this folder:

```powershell
npm install
npm run dev
```

Open the URL printed by Vite. The browser preview is deliberately separate from the desktop application: it starts with sample products and keeps edits in that browser's local storage. It does not connect to PostgreSQL or Redis.

## Run the desktop app

Requires Node.js, a working Rust toolchain, the Windows prerequisites for Tauri (including Microsoft C++ build tools and WebView2), and PostgreSQL. Docker Desktop is the easiest way to start PostgreSQL and Redis locally:

```powershell
docker compose up -d
npm install
npm run tauri dev
```

The app creates its tables on the first successful connection. This configuration starts with an **empty** database, separate from the browser preview. PostgreSQL binds only to `127.0.0.1:55432`, Redis to `127.0.0.1:56379`, and the database uses a named Docker volume so data persists across restarts. The credentials in `compose.yaml` are for local development only; do not expose this setup to a network or use them for production.

You can point the desktop app at your own services using environment variables before starting it:

```powershell
$env:STOCKROOM_DATABASE_URL = 'postgres://USER:PASSWORD@127.0.0.1:5432/stockroom'
$env:STOCKROOM_REDIS_URL = 'redis://127.0.0.1:6379'
npm run tauri dev
```

Redis is optional; if it cannot be reached the app reads PostgreSQL directly. It is used only for a short-lived cache, not as the source of truth. The default local PostgreSQL URL is `postgres://stockroom:stockroom_local@127.0.0.1:55432/stockroom`.

To stop the local services without deleting their data, run `docker compose stop`. Avoid `docker compose down -v` unless you intentionally want to permanently remove the database volume.

## Scope and limitations

This first version targets a single local workspace: there are no accounts, synchronization, supplier management, prices, or automatic backups. Editing product details does not change the stock count; use **Adjust** to preserve the movement history. The data is only as safe as your database volume, so arrange backups before using real business data.
