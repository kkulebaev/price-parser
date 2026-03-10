# price-parser

Cron-friendly price scraper that stores price history in Postgres.

## What it does
- Fetches `PRODUCT_URL`
- Extracts current/old price (best-effort)
- Ensures DB schema on first run
- Writes to Postgres tables:
  - `tracked_products`
  - `price_history`

## Requirements
- Go 1.22+ (for local build)
- Postgres

## Environment variables
- `PRODUCT_URL` (required)
- `DATABASE_URL` (required)

## Run locally
```bash
go run .
```

## Deploy on Render
Recommended: **Render Postgres** + **Cron Job**.

Cron Job settings:
- Build command: `go build -o price-parser .`
- Start command: `./price-parser`

Schedule:
- once a day (e.g. `0 3 * * *`)
