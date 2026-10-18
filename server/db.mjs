import pg from 'pg'

export const databaseUrl = process.env.STOCKROOM_DATABASE_URL ?? 'postgres://stockroom:stockroom_local@127.0.0.1:55432/stockroom'
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL, category TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 0), reorder_level INTEGER NOT NULL CHECK (reorder_level >= 0),
      unit TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price BIGINT NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON products (LOWER(sku));
    CREATE TABLE IF NOT EXISTS stock_movements (
      id UUID PRIMARY KEY, product_id UUID NOT NULL REFERENCES products(id),
      change INTEGER NOT NULL CHECK (change <> 0), reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS movements_created_at ON stock_movements (created_at DESC);
    CREATE TABLE IF NOT EXISTS sales (
      id UUID PRIMARY KEY, reference TEXT NOT NULL UNIQUE, total BIGINT NOT NULL CHECK (total >= 0),
      payment_method TEXT NOT NULL DEFAULT 'cash', cash_received BIGINT, change_due BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_received BIGINT;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_due BIGINT;
    CREATE TABLE IF NOT EXISTS sale_items (
      id UUID PRIMARY KEY, sale_id UUID NOT NULL REFERENCES sales(id), product_id UUID NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0), line_total BIGINT NOT NULL CHECK (line_total >= 0)
    );
    CREATE INDEX IF NOT EXISTS sales_created_at ON sales (created_at DESC);
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'employee')),
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON app_users (LOWER(username));
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_users(id);
    ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_users(id);
    CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON app_sessions (expires_at);
  `)
}

export async function transaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
