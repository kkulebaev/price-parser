<p align="center">
  <img src="./assets/banner.svg" alt="price-parser banner" />
</p>

<p align="center">
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white" /></a>
  <a href="https://turso.tech"><img alt="turso" src="https://img.shields.io/badge/db-Turso-4FF8D2?logo=turso&logoColor=black" /></a>
  <a href="https://railway.com"><img alt="railway" src="https://img.shields.io/badge/deploy-Railway-0B0D0E?logo=railway&logoColor=white" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# price-parser

**Watch product prices over time — without checking the page every day yourself.**

Add a product link, run the script on a schedule, and it keeps a tidy history of every price change so you can answer questions like *“is it actually cheaper than last month?”* or *“how often does it go on sale?”*.

## Why you might want this

- 🛒 Track items you’re considering buying
- 📉 Spot real discounts vs. fake “–50%” banners
- 🕒 Build a price history without copy-pasting into a spreadsheet
- 💸 Get a personal price-watch service for the cost of a free database

## What you get

After each run you’ll see a short, human-readable report — one block per product:

```
Ноутбук Apple MacBook Pro 14" …
Цена: 194 990 ₽
Было: 194 990 ₽ (2026-05-05 07:03 UTC)
Без изменений
https://example.com/products/...
```

Every check is also saved in your database, so you can build charts, dashboards, or notifications on top of it whenever you’re ready.

## How to set it up

It takes about 5 minutes.

### 1. Create a free database

Sign up at [turso.tech](https://turso.tech), create a database, and grab two values from the dashboard:

- the database URL (looks like `libsql://your-db.turso.io`)
- an auth token

### 2. Create the tables

Open your database in the Turso web console (or the `turso` CLI) and paste in [the schema below](#tables). This is a one-time step.

### 3. Run it

```bash
git clone git@github.com:kkulebaev/price-parser.git
cd price-parser
npm install

export TURSO_DATABASE_URL='libsql://<your-db>.turso.io'
export TURSO_AUTH_TOKEN='<your-token>'

npm start
```

That’s it — you should see a price report in your terminal.

### 4. Make it run on a schedule

You don’t want to launch this by hand every day. Two easy options:

- **[Railway](https://railway.com)** (recommended): connect this repo, paste the two `TURSO_*` variables under **Variables**, and pick a cron schedule under **Settings → Cron Schedule** (e.g. `0 7 * * *` runs daily at 07:00 UTC). Done.
- **Your own machine**: add a `cron`/Task Scheduler entry that runs `npm start` from the project folder.

## Adding products to track

Add any product URL into the `product_links` table:

```sql
INSERT INTO product_links(url) VALUES ('https://example.com/products/your-item');
```

To stop tracking something without losing its history, mark it disabled:

```sql
UPDATE product_links SET enabled = 0 WHERE url = 'https://...';
```

## Looking at the data

A couple of handy queries you can run from the Turso console:

**Latest price per product**

```sql
SELECT p.url, p.title, h.price, h.checked_at
FROM tracked_products p
JOIN price_history h ON h.url = p.url
WHERE h.id = (SELECT id FROM price_history WHERE url = p.url ORDER BY checked_at DESC LIMIT 1);
```

**Only the moments the price actually changed**

```sql
SELECT url, price, checked_at
FROM (
  SELECT url, price, checked_at,
         LAG(price) OVER (PARTITION BY url ORDER BY checked_at) AS prev
  FROM price_history
)
WHERE prev IS NULL OR prev <> price
ORDER BY checked_at DESC;
```

## Good to know

- Some shops actively block automated traffic. The script does its best to look like a normal browser, but it won’t work on every site out of the box.
- It captures whatever price the page is showing publicly — no logins, no personal data, no carts.
- Be polite: don’t hammer a shop with checks every minute. Once a day is plenty.

<a id="tables"></a>

<details>
<summary><strong>Tables to create (one-time setup)</strong></summary>

```sql
CREATE TABLE product_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT    NOT NULL UNIQUE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tracked_products (
  url        TEXT PRIMARY KEY,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE price_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT    NOT NULL REFERENCES tracked_products(url) ON DELETE CASCADE,
  price      INTEGER,
  checked_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_price_history_url_checked_at
  ON price_history(url, checked_at DESC);
```

</details>

<details>
<summary><strong>Configuration reference</strong></summary>

| Variable             | Required | Description                                 |
| -------------------- | :------: | ------------------------------------------- |
| `TURSO_DATABASE_URL` |    ✓     | `libsql://<db>-<org>.turso.io`              |
| `TURSO_AUTH_TOKEN`   |    ✓     | Generated via `turso db tokens create <db>` |

Requires Node.js 18 or newer.

</details>

## License

MIT
