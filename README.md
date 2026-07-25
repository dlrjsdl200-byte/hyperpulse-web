# HyperPulse

> Real-time Hyperliquid perp intelligence — open interest, funding anomalies & market flow across 200+ markets. Free, no login.

Live dashboard for Hyperliquid perpetuals traders. Surfaces open interest,
hourly funding rates, statistical funding anomalies (long/short crowding),
and 24h flow — pulling directly from the Hyperliquid public API. No key,
no account, no backend.

## Features

- **Market summary** — total OI, 24h volume, funding anomaly count
- **Funding anomalies** — Z-score detection of statistically extreme funding
  across liquid markets (hourly rate, the figure that actually settles)
- **Market heatmap** — all 200+ markets ranked by OI, volume, funding, or
  24h change, with live search

## Stack

React + Vite. Data from `api.hyperliquid.xyz/info` (public, keyless).
Refreshes every 15s. Static site — deploys anywhere.

## Develop

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # → dist/
```

## Disclaimer

Informational only, not financial advice.

Built by [chain-ops](https://chain-ops.xyz).
