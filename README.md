# price-parser

Simple cron-friendly price scraper that stores price history in Postgres.

## What it does
- Fetches `PRODUCT_URL`
- Extracts current/old price (best-effort)
- Writes to Postgres tables:
  - `tracked_products`
  - `price_history`

## Requirements
- Node.js 22
- Postgres database

## Environment variables
- `PRODUCT_URL` (required)
- `DATABASE_URL` (required)
- `MIN_INTERVAL_HOURS` (optional, default `72`)

## Run locally
```bash
npm ci
cp .env.example .env
# fill env vars
npm run run
```

## Deploy on Render
Recommended: **Render Postgres** + **Cron Job**.

Cron command:
- `npm ci && node index.js`

Schedule:
- once a day (e.g. `0 3 * * *`)
