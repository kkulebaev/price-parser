<p align="center">
  <img src="./assets/banner.svg" alt="price-parser banner" />
</p>

<p align="center">
  <img alt="node" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white" />
  <img alt="postgres" src="https://img.shields.io/badge/db-PostgreSQL-336791?logo=postgresql&logoColor=white" />
  <img alt="netlify" src="https://img.shields.io/badge/deploy-Netlify-00C7B7?logo=netlify&logoColor=white" />
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
- `product_links` table filled with URLs to scrape

## Environment variables
- `DATABASE_URL` (required)

## Local development
Install dependencies:

```bash
npm i
```

Run Netlify dev server:

```bash
npm run dev
```

## Deploy on Netlify
1) Connect this repo to Netlify
2) Add environment variables in Netlify:
   - `DATABASE_URL`
     - for Prisma Postgres рекомендовано: `...?sslmode=require&uselibpqcompat=true`
3) Deploy

Scheduled runs are configured in `netlify.toml` via Netlify Scheduled Functions.

Current schedule:
- **10:00 MSK (UTC+3)** → `07:00 UTC` (`0 7 * * *`)

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
  price_current INTEGER,
  price_old INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_url_checked_at
  ON price_history(url, checked_at DESC);

-- Add links to parse:
-- INSERT INTO product_links(url) VALUES ('https://...');
```
