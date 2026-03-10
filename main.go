package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type scrapeResult struct {
	Title        string
	PriceCurrent *int
	PriceOld     *int
	Raw          string
}

func mustEnv(key string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		panic(fmt.Sprintf("%s is required", key))
	}
	return v
}

func decodeHTMLEntities(s string) string {
	// Достаточно для заголовка на BigGeek
	r := strings.NewReplacer(
		"&quot;", "\"",
		"&#34;", "\"",
		"&#39;", "'",
		"&amp;", "&",
		"&lt;", "<",
		"&gt;", ">",
		"&nbsp;", " ",
	)
	return r.Replace(s)
}

var reStripTags = regexp.MustCompile(`<[^>]+>`)
var reSpaces = regexp.MustCompile(`\s+`)

func normalizeText(s string) string {
	s = decodeHTMLEntities(s)
	s = reStripTags.ReplaceAllString(s, "")
	s = reSpaces.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func parsePriceToInt(text string) *int {
	digits := make([]rune, 0, len(text))
	for _, ch := range text {
		if ch >= '0' && ch <= '9' {
			digits = append(digits, ch)
		}
	}
	if len(digits) == 0 {
		return nil
	}
	n, err := strconv.Atoi(string(digits))
	if err != nil {
		return nil
	}
	return &n
}

func pickPricesFromCandidates(values []int) (current *int, old *int) {
	if len(values) == 0 {
		return nil, nil
	}
	m := map[int]struct{}{}
	uniq := make([]int, 0, len(values))
	for _, v := range values {
		if _, ok := m[v]; ok {
			continue
		}
		m[v] = struct{}{}
		uniq = append(uniq, v)
	}
	sort.Slice(uniq, func(i, j int) bool { return uniq[i] > uniq[j] })

	if len(uniq) == 1 {
		c := uniq[0]
		return &c, nil
	}
	top2 := uniq[:2]
	max := top2[0]
	min := top2[1]
	if min > max {
		min, max = max, min
	}
	return &min, &max
}

func fetchHTML(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("http %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

var reH1 = regexp.MustCompile(`(?is)<h1[^>]*>([\s\S]*?)</h1>`)
var reRubPrice = regexp.MustCompile(`(\d[\d\s]{2,})\s*₽`)
var reJSONPrice = regexp.MustCompile(`"price"\s*:\s*(\d{4,})`)

func scrape(ctx context.Context, url string) (*scrapeResult, error) {
	html, err := fetchHTML(ctx, url)
	if err != nil {
		return nil, err
	}

	var title string
	if m := reH1.FindStringSubmatch(html); len(m) == 2 {
		title = normalizeText(m[1])
	}

	candidates := []int{}
	for _, m := range reRubPrice.FindAllStringSubmatch(html, -1) {
		if len(m) == 0 {
			continue
		}
		if v := parsePriceToInt(m[0]); v != nil && *v > 50000 {
			candidates = append(candidates, *v)
		}
	}
	pc, po := pickPricesFromCandidates(candidates)
	if pc == nil {
		jsonPrices := []int{}
		for _, m := range reJSONPrice.FindAllStringSubmatch(html, -1) {
			if len(m) < 2 {
				continue
			}
			n, _ := strconv.Atoi(m[1])
			if n > 50000 {
				jsonPrices = append(jsonPrices, n)
			}
		}
		pc, po = pickPricesFromCandidates(jsonPrices)
		if pc == nil {
			return nil, errors.New("could not parse price")
		}
	}

	return &scrapeResult{Title: title, PriceCurrent: pc, PriceOld: po, Raw: ""}, nil
}

type lastCheck struct {
	PriceCurrent sql.NullInt64
	PriceOld     sql.NullInt64
	CheckedAt    time.Time
}

func getLastCheck(ctx context.Context, db *sql.DB, url string) (*lastCheck, error) {
	row := db.QueryRowContext(ctx, `
		SELECT price_current, price_old, checked_at
		FROM price_history
		WHERE url = $1
		ORDER BY checked_at DESC
		LIMIT 1
	`, url)
	var lc lastCheck
	err := row.Scan(&lc.PriceCurrent, &lc.PriceOld, &lc.CheckedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &lc, nil
}

func ensureProduct(ctx context.Context, db *sql.DB, url string, title string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO tracked_products(url, title)
		VALUES ($1, $2)
		ON CONFLICT (url) DO UPDATE
		SET title = COALESCE(EXCLUDED.title, tracked_products.title)
	`, url, nullIfEmpty(title))
	return err
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func insertHistory(ctx context.Context, db *sql.DB, url string, pc *int, po *int) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO price_history(url, price_current, price_old)
		VALUES ($1, $2, $3)
	`, url, pc, po)
	return err
}

func fmtRub(v int) string {
	// "210 990" в ru-RU
	s := strconv.Itoa(v)
	parts := []string{}
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	return strings.Join(parts, " ")
}

func main() {
	productURL := mustEnv("PRODUCT_URL")
	dsn := mustEnv("DATABASE_URL")

	ctx := context.Background()

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: db ping: %v\n", err)
		os.Exit(1)
	}

	last, err := getLastCheck(ctx, db, productURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: get last: %v\n", err)
		os.Exit(1)
	}

	s, err := scrape(ctx, productURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(1)
	}

	if err := ensureProduct(ctx, db, productURL, s.Title); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: ensure product: %v\n", err)
		os.Exit(1)
	}

	if err := insertHistory(ctx, db, productURL, s.PriceCurrent, s.PriceOld); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: insert history: %v\n", err)
		os.Exit(1)
	}

	changed := false
	if last == nil {
		changed = true
	} else {
		if !last.PriceCurrent.Valid || s.PriceCurrent == nil || int(last.PriceCurrent.Int64) != *s.PriceCurrent {
			changed = true
		}
		if (last.PriceOld.Valid) != (s.PriceOld != nil) {
			changed = true
		} else if last.PriceOld.Valid && s.PriceOld != nil && int(last.PriceOld.Int64) != *s.PriceOld {
			changed = true
		}
	}

	parts := []string{}
	if s.Title != "" {
		parts = append(parts, fmt.Sprintf("BigGeek: %s", s.Title))
	} else {
		parts = append(parts, "BigGeek: товар")
	}
	if s.PriceCurrent != nil {
		parts = append(parts, fmt.Sprintf("Цена: %s ₽", fmtRub(*s.PriceCurrent)))
	}
	if s.PriceOld != nil {
		parts = append(parts, fmt.Sprintf("Старая: %s ₽", fmtRub(*s.PriceOld)))
	}
	if last != nil {
		parts = append(parts, fmt.Sprintf("Было: %s ₽ (%s UTC)", fmtRub(int(last.PriceCurrent.Int64)), last.CheckedAt.UTC().Format("2006-01-02 15:04")))
	} else {
		parts = append(parts, "Это первая запись в историю")
	}
	if changed {
		parts = append(parts, "Изменилась с прошлого раза")
	} else {
		parts = append(parts, "Без изменений")
	}
	parts = append(parts, productURL)

	fmt.Println(strings.Join(parts, "\n"))
}
