<p align="center">
  <img src="./assets/banner.svg" alt="price-parser banner" />
</p>

<p align="center">
  <img alt="go" src="https://img.shields.io/badge/go-1.22%2B-00ADD8?logo=go&logoColor=white" />
  <img alt="postgres" src="https://img.shields.io/badge/db-PostgreSQL-336791?logo=postgresql&logoColor=white" />
  <img alt="render" src="https://img.shields.io/badge/deploy-Render-46E3B7" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# price-parser

Cron-friendly price scraper that stores price history in Postgres.

## What it does
- Fetches `PRODUCT_URL`
- Extracts current/old price (best-effort)
- Writes to Postgres:
  - `tracked_products`
  - `price_history`

## Requirements
- Postgres database with tables already created (this app **does not** auto-migrate)

## Environment variables
- `PRODUCT_URL` (required)
- `DATABASE_URL` (required)

## Run locally
```bash
go run .
```

## Deploy on Render (recommended)
Use **Render Postgres** + **Render Cron Job**.

Cron Job settings:
- Build command: `go build -o price-parser .`
- Start command: `./price-parser`

Schedule:
- once a day (e.g. `0 3 * * *`)

## DB schema
Create tables manually (once) in your Postgres:

```sql
CREATE TABLE tracked_products (
  url TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL REFERENCES tracked_products(url) ON DELETE CASCADE,
  price_current INTEGER,
  price_old INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_url_checked_at
  ON price_history(url, checked_at DESC);
```
