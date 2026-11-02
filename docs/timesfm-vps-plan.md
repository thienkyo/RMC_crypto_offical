# Google TimesFM Integration Plan (Post-Cloud VPS Migration)

> **Status:** Deferred / Planned  
> **Target Trigger:** To be implemented after migrating RMC Crypto from local laptop to Cloud VPS.  
> **Primary Purpose:** Time-series foundation model forecasting for predictive chart corridors and signal confluence scoring.

---

## 1. Executive Assessment: Is It Worth It?

| Dimension | Rating | Verdict & Analysis |
| :--- | :---: | :--- |
| **Trend & Momentum Forecast** | 8.5/10 | Excellent at predicting multi-step continuous trajectories (12–24 bars) on 1H and 4H charts without curve-fitting. |
| **Quantile Volatility Bands** | 9.0/10 | Outstanding for probabilistic TP/SL targets (10th, 50th, 90th percentiles) rather than static % boundaries. |
| **Signal Confluence Filter** | 8.0/10 | High value as an additional gatekeeper: discard or flag signals when the projected trajectory conflicts with the trigger. |
| **Crypto Flash Wicks / Liquidations** | 4.0/10 | TimesFM is purely statistical/time-series. It does not know about sudden whale liquidations, funding squeezes, or macro news. |
| **Standalone Trading Bot** | 3.0/10 | **Not recommended** as a standalone decision maker; must be combined with technical strategy rules and risk controls. |

### Bottom Line
**Yes, it is worth it as an AI Confirmation Filter and Chart Overlay**, but **not** on a battery-powered Intel laptop. It belongs on a dedicated Cloud VPS or serverless container where inference is fast and doesn't generate heat or fan noise.

---

## 2. Target Architecture on Cloud VPS

```
┌──────────────────────────────────────────────────────────┐
│                      Cloud VPS                           │
│                                                          │
│  ┌──────────────────────┐        ┌────────────────────┐  │
│  │   Next.js Daemon     │  HTTP  │   TimesFM Sidecar  │  │
│  │   (PM2 / Port 7070)  │───────>│  (FastAPI: 8008)   │  │
│  │                      │<───────│                    │  │
│  └──────────┬───────────┘ JSON   └────────────────────┘  │
│             │                                            │
└─────────────┼────────────────────────────────────────────┘
              │
      ┌───────┴────────┐
      ▼                ▼
[ Interactive Chart ] [ Telegram Alert Image ]
(Forecast corridor)    (Predicted trajectory)
```

---

## 3. VPS Specifications & Recommendations

When choosing your Cloud VPS:

* **Budget Option (CPU-only):** 4 vCPUs, 8 GB–16 GB RAM (e.g. Hetzner, DigitalOcean, or Linode ~$15–$25/mo).
  * Inference latency: ~400ms – 700ms per forecast (good enough for 5m–4h cron alerts and on-demand chart viewing).
* **High-Performance Option (GPU-accelerated):** VPS with NVIDIA T4 or small Cloud Run / Modal serverless endpoint.
  * Inference latency: ~60ms – 120ms.

---

## 4. Implementation Steps (When Ready on VPS)

### Phase 1: Python TimesFM Microservice
Create `services/timesfm_service/`:
1. `main.py` using FastAPI:
   - Route `POST /forecast`:
     - Accepts: `{ symbol: string, timeframe: string, closes: number[], horizon: number }`
     - Runs `timesfm.forecast()` with context length 128–512 bars.
     - Returns: `{ mean: number[], q10: number[], q90: number[] }`
2. Managed by systemd or PM2 (`pm2 start uvicorn ... --name rmc-timesfm`).

### Phase 2: Next.js API Client
Add `src/lib/ai/timesfm.ts`:
- Reusable TypeScript helper `fetchTimesFmForecast(symbol, timeframe, candles, horizon)`.
- Route `/api/forecast`: returns JSON trajectory to chart or cron poller.

### Phase 3: Web Chart Integration
In `src/components/chart/ChartLayout.tsx`:
- Add a toolbar toggle: **"TimesFM Forecast Corridor"**.
- Renders lightweight-charts `LineSeries` or `AreaSeries` forward into the future:
  - Middle dashed line: Expected trajectory (mean).
  - Shaded envelope: 10th to 90th percentile bounds.

### Phase 4: Strategy Confluence Gatekeeper
In `src/lib/alerts/evaluate.ts` & `src/lib/alerts/signalChart.ts`:
- Check if forecast trajectory delta aligns with signal (`direction === 'long' && forecastSlope > 0`).
- Add TimesFM prediction score to the alert card and Telegram chart image.

---

## 5. Quick Reminder Checklist for VPS Migration

When migrating to your VPS, check off:
- [ ] Deploy PostgreSQL & Next.js onto VPS.
- [ ] Confirm Telegram alerts & PM2 service are running cleanly.
- [ ] Revisit this document (`docs/timesfm-vps-plan.md`) to spin up the TimesFM sidecar.
