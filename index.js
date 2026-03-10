import pg from "pg";

const { Client } = pg;

const PRODUCT_URL = process.env.PRODUCT_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const MIN_INTERVAL_HOURS = Number(process.env.MIN_INTERVAL_HOURS ?? 72);

if (!PRODUCT_URL) throw new Error("PRODUCT_URL is required");
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

function decodeHtmlEntities(s) {
  // Достаточно для заголовка на BigGeek
  return String(s)
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

function parsePriceToInt(text) {
  const digits = String(text).replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

async function getLastCheck(client) {
  const r = await client.query(
    `SELECT price_current, price_old, checked_at
     FROM price_history
     WHERE url = $1
     ORDER BY checked_at DESC
     LIMIT 1`,
    [PRODUCT_URL]
  );
  return r.rows[0] ?? null;
}

async function ensureProduct(client, title) {
  await client.query(
    `INSERT INTO tracked_products(url, title)
     VALUES ($1, $2)
     ON CONFLICT (url) DO UPDATE SET title = COALESCE(EXCLUDED.title, tracked_products.title)`,
    [PRODUCT_URL, title]
  );
}

async function insertHistory(client, { priceCurrent, priceOld, raw }) {
  await client.query(
    `INSERT INTO price_history(url, price_current, price_old, raw)
     VALUES ($1, $2, $3, $4)`,
    [PRODUCT_URL, priceCurrent, priceOld, raw]
  );
}

function pickPricesFromCandidates(values) {
  const unique = [...new Set(values)].filter((v) => Number.isFinite(v));
  unique.sort((a, b) => b - a);

  if (unique.length === 0) return { priceCurrent: null, priceOld: null };
  if (unique.length === 1) return { priceCurrent: unique[0], priceOld: null };

  const top2 = unique.slice(0, 2);
  return {
    priceOld: Math.max(...top2),
    priceCurrent: Math.min(...top2),
  };
}

async function scrape() {
  const res = await fetch(PRODUCT_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();

  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1])
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : null;

  // Цена часто присутствует прямо в HTML как "210 990 ₽".
  const re = /(\d[\d\s]{2,})\s*₽/g;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const v = parsePriceToInt(m[0]);
    if (v && v > 50000) candidates.push(v);
  }

  const { priceCurrent, priceOld } = pickPricesFromCandidates(candidates);

  if (!priceCurrent) {
    // запасной вариант: иногда цена встречается как "price":210990
    const jsonPrices = [];
    const re2 = /"price"\s*:\s*(\d{4,})/g;
    while ((m = re2.exec(html))) {
      const v = Number(m[1]);
      if (v > 50000) jsonPrices.push(v);
    }
    const picked = pickPricesFromCandidates(jsonPrices);
    if (!picked.priceCurrent) {
      throw new Error(
        `Could not parse price. candidates=${candidates
          .slice(0, 20)
          .join(",")} jsonPrices=${jsonPrices.slice(0, 20).join(",")}`
      );
    }
    return {
      title,
      priceCurrent: picked.priceCurrent,
      priceOld: picked.priceOld,
      debug: {
        candidatesCount: candidates.length,
        jsonPricesCount: jsonPrices.length,
      },
    };
  }

  return {
    title,
    priceCurrent,
    priceOld,
    debug: { candidatesCount: candidates.length },
  };
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const last = await getLastCheck(client);
    if (last) {
      const hoursSince =
        (Date.now() - new Date(last.checked_at).getTime()) / (1000 * 60 * 60);
      if (hoursSince < MIN_INTERVAL_HOURS) {
        console.log(
          `SKIP: last check ${hoursSince.toFixed(1)}h ago (<${MIN_INTERVAL_HOURS}h)`
        );
        return;
      }
    }

    const s = await scrape();

    await ensureProduct(client, s.title);
    await insertHistory(client, {
      priceCurrent: s.priceCurrent,
      priceOld: s.priceOld,
      raw: s,
    });

    const changed =
      !last ||
      Number(last.price_current) !== Number(s.priceCurrent) ||
      Number(last.price_old ?? null) !== Number(s.priceOld ?? null);

    const parts = [];
    parts.push(`BigGeek: ${s.title ?? "товар"}`);
    parts.push(`Цена: ${s.priceCurrent.toLocaleString("ru-RU")} ₽`);
    if (s.priceOld)
      parts.push(`Старая: ${s.priceOld.toLocaleString("ru-RU")} ₽`);

    if (last) {
      parts.push(
        `Было: ${Number(last.price_current).toLocaleString("ru-RU")} ₽ (${new Date(
          last.checked_at
        )
          .toISOString()
          .replace("T", " ")
          .slice(0, 16)} UTC)`
      );
    } else {
      parts.push("Это первая запись в историю");
    }

    parts.push(changed ? "Изменилась с прошлого раза" : "Без изменений");
    parts.push(PRODUCT_URL);

    console.log(parts.join("\n"));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`ERROR: ${e?.message ?? e}`);
  process.exit(1);
});