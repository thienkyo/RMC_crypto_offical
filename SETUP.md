# RMC Crypto — Phase 1 Setup

## Prerequisites
- Node.js 22+
- Docker Desktop (for local Postgres + TimescaleDB)
- A terminal

---

## First-time setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.local.example .env.local
# DATABASE_URL is already set for local Docker — no changes needed for dev
```

### 3. Start the database
```bash
docker-compose up -d
# Wait ~10s for TimescaleDB to initialize, then:
docker-compose ps   # should show "healthy"
```

### 4. Run database migrations
```bash
npm run migrate
# → [migrate] ✓ Schema applied successfully
```

### 5. Start the dev server
```bash
npm run dev
# → Ready on http://localhost:3000
```

Open http://localhost:3000 — you should see:
- Left rail: watchlist loading the top-20 crypto + Mag 7
- Center: BTC/USDT 1h chart loading from Binance
- Live price ticks appearing in the watchlist within a few seconds
- EMA 20 overlay on the chart
- RSI and MACD sub-panes below the chart

---

## Common tasks

### Switch symbol
Click any symbol in the watchlist.

### Switch timeframe
Use the timeframe selector in the top bar (1m → 1W).

### Toggle indicators
Click "Indicators" in the top bar — toggle any indicator on/off, or add Bollinger Bands / SMA.

### Add a new indicator (dev)
1. Create `src/lib/indicators/myindicator.ts` implementing `Indicator<P>`
2. Export it from `src/lib/indicators/index.ts`
3. Add to the `INDICATORS` map
That's it — it appears in the UI automatically.

---

## Architecture notes

| Layer | File(s) | Next.js pattern |
|---|---|---|
| Data fetch | `src/app/api/candles/route.ts` | Route Handler (Server) |
| DB client | `src/lib/db/client.ts` | Server-only singleton |
| Binance REST | `src/lib/exchange/binance.ts` | Called from route handler |
| Binance WS | same file, `subscribeKline()` | Browser-only (client component) |
| State | `src/store/chart.ts` | Zustand (client) |
| Server state | `src/hooks/useCandles.ts` | TanStack Query (client) |
| Chart | `src/components/chart/` | `'use client'` + LWC |
| Page shell | `src/app/page.tsx` | Server Component |

The page.tsx is a **Server Component** — it renders the layout shell with zero JS. ChartLayout is dynamically imported with `ssr: false` so LWC's canvas/WebSocket APIs never run server-side.

---

## Deploying

1. Push to GitHub
2. Create a Neon or Supabase Postgres database
3. Set `DATABASE_URL` in Vercel environment variables (with `?sslmode=require`)
4. Deploy to Vercel — `npm run build` runs automatically
5. Run `npm run migrate` once against the production DB

---

## Phase roadmap
- **Phase 1 ← you are here**: Data + charting + indicators
- **Phase 2**: Strategy builder + backtester + paper-trade engine
- **Phase 3**: AI chart analysis (Claude vision) + numeric prediction
- **Phase 4**: News + social sentiment ingestion
- **Phase 5**: Alerts (Telegram), mobile read-only view, polish
