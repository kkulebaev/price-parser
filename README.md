<p align="center">
  <img src="./assets/banner.svg" alt="price-parser banner" />
</p>

<p align="center">
  <img alt="node" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white" />
  <img alt="turso" src="https://img.shields.io/badge/db-Turso-4FF8D2?logo=turso&logoColor=black" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# price-parser

Cron-friendly price scraper that stores price history in Turso (libSQL).

## What it does
- Loads URLs from `product_links`
- Fetches each product page
- Extracts current price (best-effort)
- Writes to Turso:
  - `tracked_products`
  - `price_history`

## Requirements
- Turso database with tables already created (this app **does not** auto-migrate)

## Environment variables
- `TURSO_DATABASE_URL` (required) — `libsql://<db>-<org>.turso.io`
- `TURSO_AUTH_TOKEN` (required)

## Run
```bash
npm i
npm start
```

## DB schema
Create tables manually (once) in your Turso database (e.g. via `turso db shell`):

```sql
CREATE TABLE product_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tracked_products (
  url TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL REFERENCES tracked_products(url) ON DELETE CASCADE,
  price INTEGER,
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_price_history_url_checked_at
  ON price_history(url, checked_at DESC);

-- Add links to parse:
-- INSERT INTO product_links(url) VALUES ('https://...');
```
