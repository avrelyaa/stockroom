use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use tauri::State;
use tokio::sync::OnceCell;
use uuid::Uuid;

const PRODUCT_CACHE_KEY: &str = "stockroom:products:v1";

struct AppState {
    database: PgPool,
    redis: Option<redis::Client>,
    schema: OnceCell<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Product {
    id: Uuid,
    name: String,
    sku: String,
    category: String,
    quantity: i32,
    reorder_level: i32,
    unit: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Movement {
    id: Uuid,
    product_name: String,
    sku: String,
    change: i32,
    reason: String,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductInput {
    name: String,
    sku: String,
    category: String,
    quantity: i32,
    reorder_level: i32,
    unit: String,
}

impl AppState {
    async fn ensure_schema(&self) -> Result<(), String> {
        self.schema.get_or_try_init(|| async {
            sqlx::raw_sql(
                "CREATE TABLE IF NOT EXISTS products (
                    id UUID PRIMARY KEY,
                    name TEXT NOT NULL,
                    sku TEXT NOT NULL,
                    category TEXT NOT NULL,
                    quantity INTEGER NOT NULL CHECK (quantity >= 0),
                    reorder_level INTEGER NOT NULL CHECK (reorder_level >= 0),
                    unit TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON products (LOWER(sku));
                CREATE TABLE IF NOT EXISTS stock_movements (
                    id UUID PRIMARY KEY,
                    product_id UUID NOT NULL REFERENCES products(id),
                    change INTEGER NOT NULL CHECK (change <> 0),
                    reason TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS movements_created_at ON stock_movements (created_at DESC);"
            ).execute(&self.database).await.map_err(database_error)?;
            Ok(())
        }).await.map(|_| ())
    }

    async fn cached_products(&self) -> Option<Vec<Product>> {
        let client = self.redis.as_ref()?;
        tokio::time::timeout(Duration::from_millis(250), async {
            let mut connection = client.get_multiplexed_async_connection().await.ok()?;
            let value: String = connection.get(PRODUCT_CACHE_KEY).await.ok()?;
            serde_json::from_str(&value).ok()
        }).await.ok().flatten()
    }

    async fn cache_products(&self, products: &[Product]) {
        if let (Some(client), Ok(value)) = (&self.redis, serde_json::to_string(products)) {
            let _ = tokio::time::timeout(Duration::from_millis(250), async {
                if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                    let _: redis::RedisResult<()> = connection.set_ex(PRODUCT_CACHE_KEY, value, 10).await;
                }
            }).await;
        }
    }

    async fn invalidate_products(&self) {
        if let Some(client) = &self.redis {
            let _ = tokio::time::timeout(Duration::from_millis(250), async {
                if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                    let _: redis::RedisResult<()> = connection.del(PRODUCT_CACHE_KEY).await;
                }
            }).await;
        }
    }
}

fn database_error(error: sqlx::Error) -> String {
    if let sqlx::Error::Database(ref db_error) = error {
        if db_error.code().as_deref() == Some("23505") {
            return "That SKU already exists. Please use a unique SKU.".into();
        }
    }
    eprintln!("Stockroom database error: {error}");
    "Could not access the database. Check that PostgreSQL is running and try again.".into()
}

fn validate_input(input: &ProductInput) -> Result<(), String> {
    if input.name.trim().is_empty() || input.sku.trim().is_empty() || input.category.trim().is_empty() || input.unit.trim().is_empty() {
        return Err("Complete the name, SKU, category, and unit fields.".into());
    }
    if input.name.trim().len() > 120 || input.sku.trim().len() > 50 || input.category.trim().len() > 60 || input.unit.trim().len() > 30 {
        return Err("One or more fields are too long.".into());
    }
    if input.quantity < 0 || input.reorder_level < 0 {
        return Err("Quantities and reorder levels cannot be negative.".into());
    }
    Ok(())
}

#[tauri::command]
async fn list_products(state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    state.ensure_schema().await?;
    if let Some(products) = state.cached_products().await {
        return Ok(products);
    }
    let products = sqlx::query_as::<_, Product>("SELECT * FROM products ORDER BY LOWER(name), id")
        .fetch_all(&state.database).await.map_err(database_error)?;
    state.cache_products(&products).await;
    Ok(products)
}

#[tauri::command]
async fn list_movements(state: State<'_, AppState>) -> Result<Vec<Movement>, String> {
    state.ensure_schema().await?;
    sqlx::query_as::<_, Movement>(
        "SELECT m.id, p.name AS product_name, p.sku, m.change, m.reason, m.created_at
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         ORDER BY m.created_at DESC, m.id DESC LIMIT 50"
    ).fetch_all(&state.database).await.map_err(database_error)
}

#[tauri::command]
async fn create_product(state: State<'_, AppState>, input: ProductInput) -> Result<(), String> {
    validate_input(&input)?;
    state.ensure_schema().await?;
    let mut tx = state.database.begin().await.map_err(database_error)?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO products (id, name, sku, category, quantity, reorder_level, unit) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(id).bind(input.name.trim()).bind(input.sku.trim()).bind(input.category.trim())
        .bind(input.quantity).bind(input.reorder_level).bind(input.unit.trim())
        .execute(&mut *tx).await.map_err(database_error)?;
    if input.quantity > 0 {
        sqlx::query("INSERT INTO stock_movements (id, product_id, change, reason) VALUES ($1,$2,$3,$4)")
            .bind(Uuid::new_v4()).bind(id).bind(input.quantity).bind("Opening stock")
            .execute(&mut *tx).await.map_err(database_error)?;
    }
    tx.commit().await.map_err(database_error)?;
    state.invalidate_products().await;
    Ok(())
}

#[tauri::command]
async fn update_product(state: State<'_, AppState>, id: Uuid, input: ProductInput) -> Result<(), String> {
    validate_input(&input)?;
    state.ensure_schema().await?;
    let result = sqlx::query("UPDATE products SET name=$1, sku=$2, category=$3, reorder_level=$4, unit=$5 WHERE id=$6")
        .bind(input.name.trim()).bind(input.sku.trim()).bind(input.category.trim())
        .bind(input.reorder_level).bind(input.unit.trim()).bind(id)
        .execute(&state.database).await.map_err(database_error)?;
    if result.rows_affected() == 0 { return Err("Product not found.".into()); }
    state.invalidate_products().await;
    Ok(())
}

#[tauri::command]
async fn adjust_stock(state: State<'_, AppState>, id: Uuid, change: i32, reason: String) -> Result<(), String> {
    if change == 0 { return Err("Enter a non-zero stock adjustment.".into()); }
    if reason.trim().is_empty() || reason.trim().len() > 160 { return Err("Enter a reason of 1 to 160 characters.".into()); }
    state.ensure_schema().await?;
    let mut tx = state.database.begin().await.map_err(database_error)?;
    let quantity: i32 = sqlx::query_scalar("SELECT quantity FROM products WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await.map_err(database_error)?
        .ok_or("Product not found.")?;
    let next = quantity.checked_add(change).ok_or("The resulting quantity is too large.")?;
    if next < 0 { return Err("Stock cannot go below zero.".into()); }
    sqlx::query("UPDATE products SET quantity=$1 WHERE id=$2")
        .bind(next).bind(id).execute(&mut *tx).await.map_err(database_error)?;
    sqlx::query("INSERT INTO stock_movements (id, product_id, change, reason) VALUES ($1,$2,$3,$4)")
        .bind(Uuid::new_v4()).bind(id).bind(change).bind(reason.trim())
        .execute(&mut *tx).await.map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    state.invalidate_products().await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database_url = std::env::var("STOCKROOM_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://stockroom:stockroom_local@127.0.0.1:55432/stockroom".into());
    let redis_url = std::env::var("STOCKROOM_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:56379".into());
    let database = PgPoolOptions::new().max_connections(5).acquire_timeout(Duration::from_secs(4))
        .connect_lazy(&database_url).expect("Invalid STOCKROOM_DATABASE_URL");
    let state = AppState { database, redis: redis::Client::open(redis_url).ok(), schema: OnceCell::new() };
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![list_products, list_movements, create_product, update_product, adjust_stock])
        .run(tauri::generate_context!())
        .expect("Failed to start Stockroom");
}
