<p align="center">
  <img src="./assets/banner.svg" alt="price-parser banner" />
</p>

<p align="center">
  <img alt="node" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white" />
  <img alt="postgres" src="https://img.shields.io/badge/db-PostgreSQL-336791?logo=postgresql&logoColor=white" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# price-parser

Cron-friendly price scraper that stores price history in Postgres.

## What it does
- Loads URLs from `product_links`
- Fetches each product page
- Extracts current price (best-effort)
- Writes to Postgres:
  - `tracked_products`
  - `price_history`

## Requirements
- Postgres database with tables already created (this app **does not** auto-migrate)

## Environment variables
- `DATABASE_URL` (required)

## Run
```bash
npm i
npm start
```

## DB schema
Create tables manually (once) in your Postgres:

```sql
CREATE TABLE product_links (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tracked_products (
  url TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL REFERENCES tracked_products(url) ON DELETE CASCADE,
  price INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_url_checked_at
  ON price_history(url, checked_at DESC);

-- Add links to parse:
-- INSERT INTO product_links(url) VALUES ('https://...');
```
