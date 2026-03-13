const { Client } = require('pg')

function mustEnv(key) {
  const v = (process.env[key] || '').trim()
  if (!v) throw new Error(`${key} is required`)
  return v
}

function decodeHTMLEntities(s) {
  // Достаточно для заголовка на BigGeek
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
}

const reStripTags = /<[^>]+>/g
const reSpaces = /\s+/g

function normalizeText(s) {
  return decodeHTMLEntities(s)
    .replace(reStripTags, '')
    .replace(reSpaces, ' ')
    .trim()
}

function parsePriceToInt(text) {
  const digits = (text.match(/[0-9]/g) || []).join('')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  if (!Number.isFinite(n)) return null
  return n
}

function pickPricesFromCandidates(values) {
  if (!values.length) return { current: null, old: null }

  const uniq = [...new Set(values)].sort((a, b) => b - a)
  if (uniq.length === 1) return { current: uniq[0], old: null }

  const top2 = uniq.slice(0, 2)
  let max = top2[0]
  let min = top2[1]
  if (min > max) {
    const t = min
    min = max
    max = t
  }

  return { current: min, old: max }
}

async function fetchHTML(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!res.ok) throw new Error(`http ${res.status}`)
  return await res.text()
}

const reH1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i
const reRubPrice = /(\d[\d\s]{2,})\s*₽/g
const reJSONPrice = /"price"\s*:\s*(\d{4,})/g

async function scrape(url) {
  const html = await fetchHTML(url)

  let title = ''
  const h1 = html.match(reH1)
  if (h1 && h1[1]) title = normalizeText(h1[1])

  const candidates = []
  for (const m of html.matchAll(reRubPrice)) {
    const raw = m[0]
    const n = parsePriceToInt(raw)
    if (n != null && n > 50000) candidates.push(n)
  }

  let { current, old } = pickPricesFromCandidates(candidates)

  if (current == null) {
    const jsonPrices = []
    for (const m of html.matchAll(reJSONPrice)) {
      const n = Number.parseInt(m[1], 10)
      if (Number.isFinite(n) && n > 50000) jsonPrices.push(n)
    }

    ;({ current, old } = pickPricesFromCandidates(jsonPrices))

    if (current == null) throw new Error('could not parse price')
  }

  return { title, priceCurrent: current, priceOld: old }
}

async function getLastCheck(client, url) {
  const r = await client.query(
    `
    SELECT price, checked_at
    FROM price_history
    WHERE url = $1
    ORDER BY checked_at DESC
    LIMIT 1
  `,
    [url]
  )
  if (!r.rows.length) return null
  return r.rows[0]
}

async function ensureProduct(client, url, title) {
  await client.query(
    `
    INSERT INTO tracked_products(url, title)
    VALUES ($1, $2)
    ON CONFLICT (url) DO UPDATE
    SET title = COALESCE(EXCLUDED.title, tracked_products.title)
  `,
    [url, title && title.trim() ? title : null]
  )
}

async function insertHistory(client, url, price) {
  await client.query(
    `
    INSERT INTO price_history(url, price)
    VALUES ($1, $2)
  `,
    [url, price ?? null]
  )
}

function fmtRub(v) {
  const s = String(v)
  const parts = []
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i))
  }
  return parts.join(' ')
}

async function listEnabledLinks(client) {
  const r = await client.query(
    `
    SELECT url
    FROM product_links
    WHERE enabled = true
    ORDER BY id ASC
  `
  )
  return r.rows.map((x) => x.url).filter(Boolean)
}

function formatOneResult({ url, scraped, last, changed, error }) {
  if (error) {
    return [`ERROR: ${url}`, String(error)].join('\n')
  }

  const s = scraped

  const lines = []
  if (s.title) lines.push(`BigGeek: ${s.title}`)
  else lines.push('BigGeek: товар')

  if (s.priceCurrent != null) lines.push(`Цена: ${fmtRub(s.priceCurrent)} ₽`)

  if (last && last.price != null && last.checked_at) {
    const ts = new Date(last.checked_at).toISOString().slice(0, 16).replace('T', ' ')
    lines.push(`Было: ${fmtRub(Number(last.price))} ₽ (${ts} UTC)`)
  } else {
    lines.push('Это первая запись в историю')
  }

  lines.push(changed ? 'Изменилась с прошлого раза' : 'Без изменений')
  lines.push(url)

  return lines.join('\n')
}

exports.handler = async () => {
  const dsn = mustEnv('DATABASE_URL')

  const client = new Client({ connectionString: dsn })

  try {
    await client.connect()

    const urls = await listEnabledLinks(client)
    if (urls.length === 0) {
      return {
        statusCode: 200,
        body: 'SKIP: no enabled links in product_links',
      }
    }

    const results = []

    for (const url of urls) {
      try {
        const last = await getLastCheck(client, url)
        const s = await scrape(url)

        await ensureProduct(client, url, s.title)
        await insertHistory(client, url, s.priceCurrent)

        let changed = false
        if (!last) {
          changed = true
        } else {
          const lastPrice = last.price
          if (lastPrice == null || s.priceCurrent == null || Number(lastPrice) !== s.priceCurrent) changed = true
        }

        results.push(formatOneResult({ url, scraped: s, last, changed }))
      } catch (e) {
        results.push(formatOneResult({ url, error: e }))
      }
    }

    return {
      statusCode: 200,
      body: results.join('\n\n---\n\n'),
    }
  } catch (e) {
    return {
      statusCode: 500,
      body: `ERROR: ${e && e.message ? e.message : String(e)}`,
    }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore
    }
  }
}
