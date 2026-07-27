import { useState, useEffect, useRef, useCallback } from "react";

// ── Hyperliquid public info API (no key, no auth) ──
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const REFRESH_MS = 15_000;

// Coins we never want to surface as signals from thin markets.
// dayNtlVlm below this (USD) is treated as illiquid noise. Hyperliquid
// funding is very stable, so a loose filter here just surfaces micro-cap
// noise (e.g. a $0.4M market whose funding twitches). $2M keeps it real.
const MIN_VOLUME_USD = 2_000_000;
// Funding Z-score for the anomaly stat (kept over the liquid set).
const FUNDING_Z_THRESHOLD = 2;
// A "big move" is a 24h price change past this (abs %).
const BIG_MOVE_PCT = 8;
// Turnover = 24h volume / open interest. High turnover = crowd day-trading
// a market rather than holding — a fresh-attention signal funding misses.
const HIGH_TURNOVER = 4;

async function fetchMetaAndCtxs(signal) {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid API ${res.status}`);
  return res.json();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtHourlyPct(v) {
  if (!Number.isFinite(v)) return "—";
  const digits = Math.abs(v) >= 0.1 ? 3 : 4;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

// Mean + sample standard deviation.
function meanStd(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, std: 0 };
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Transform raw [meta, ctxs] into a ranked, enriched market list plus
 * market-wide aggregates and anomaly detections.
 */
function transform(raw) {
  const meta = raw?.[0] ?? {};
  const ctxs = raw?.[1] ?? [];
  const universe = meta.universe ?? [];

  const markets = [];
  for (let i = 0; i < universe.length; i++) {
    const u = universe[i];
    const c = ctxs[i];
    if (!u || !c) continue;

    const mark = num(c.markPx);
    const oracle = num(c.oraclePx);
    const prevDay = num(c.prevDayPx);
    const oi = num(c.openInterest); // in base units (coins)
    const funding = num(c.funding); // hourly rate
    const volUsd = num(c.dayNtlVlm);

    const notionalOi = oi * mark; // USD
    // Hyperliquid funding settles hourly. Show the native hourly rate as the
    // primary figure (what a trader actually pays each hour); keep 8h and APR
    // as secondary context.
    const fundingHourlyPct = funding * 100; // % / hr
    const funding8hPct = funding * 8 * 100; // % / 8h
    const annualizedFunding = funding * 24 * 365 * 100; // % / yr (context only)
    const change24h = prevDay > 0 ? ((mark - prevDay) / prevDay) * 100 : 0;
    // premium = (mark - oracle) / oracle roughly; HL provides `premium` directly
    const oracleGap = num(c.premium) * 100; // %
    // Turnover: how many times the open position base is traded in a day.
    const turnover = notionalOi > 0 ? volUsd / notionalOi : 0;

    markets.push({
      coin: u.name,
      maxLeverage: u.maxLeverage ?? null,
      mark,
      oracle,
      prevDay,
      change24h,
      oi,
      notionalOi,
      funding,
      fundingHourlyPct,
      funding8hPct,
      annualizedFunding,
      volUsd,
      oracleGap,
      turnover,
      // filled in below
      fundingZ: 0,
      fundingDir: "neutral",
      fundingSeverity: "none",
    });
  }

  // ── Funding anomaly: Z-score over liquid markets only ──
  const liquid = markets.filter((m) => m.volUsd >= MIN_VOLUME_USD);
  const { mean: fMean, std: fStd } = meanStd(
    liquid.map((m) => m.funding)
  );

  for (const m of markets) {
    if (fStd > 0 && m.volUsd >= MIN_VOLUME_USD) {
      m.fundingZ = (m.funding - fMean) / fStd;
    } else {
      m.fundingZ = 0;
    }
    const az = Math.abs(m.fundingZ);
    m.fundingSeverity =
      az >= 3 ? "extreme" : az >= FUNDING_Z_THRESHOLD ? "high" : "none";
    m.fundingDir =
      m.fundingSeverity === "none"
        ? "neutral"
        : m.funding > 0
        ? "long"
        : "short";
  }

  // ── Aggregates ──
  const totalNotionalOi = markets.reduce((a, m) => a + m.notionalOi, 0);
  const totalVol24h = markets.reduce((a, m) => a + m.volUsd, 0);

  const fundingAnomalies = markets
    .filter((m) => m.fundingSeverity !== "none")
    .sort((a, b) => Math.abs(b.fundingZ) - Math.abs(a.fundingZ));

  // ── Signals: diversify beyond funding, which is very stable on HL ──
  // Each signal is { coin, type, dir, label, detail, valuePct, oi }.
  const signals = [];
  const seen = new Set();
  const add = (m, sig) => {
    if (seen.has(`${m.coin}:${sig.type}`)) return;
    seen.add(`${m.coin}:${sig.type}`);
    signals.push({ coin: m.coin, oi: m.notionalOi, ...sig });
  };

  // 1) Funding anomalies (long/short crowding)
  for (const m of fundingAnomalies) {
    add(m, {
      type: "funding",
      dir: m.fundingDir,
      severity: m.fundingSeverity,
      label: m.fundingDir === "long" ? "Longs overpaying" : "Shorts overpaying",
      primary: fmtHourlyPct(m.fundingHourlyPct),
      primaryLabel: "Funding /hr",
      secondary: `${m.fundingZ.toFixed(1)}σ`,
      accent: m.fundingDir,
    });
  }

  // 2) Big 24h moves
  const movers = markets
    .filter((m) => m.volUsd >= MIN_VOLUME_USD && Math.abs(m.change24h) >= BIG_MOVE_PCT)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  for (const m of movers) {
    const up = m.change24h >= 0;
    add(m, {
      type: "move",
      dir: up ? "long" : "short",
      severity: Math.abs(m.change24h) >= 15 ? "extreme" : "high",
      label: up ? "Ripping higher" : "Selling off",
      primary: `${up ? "+" : ""}${m.change24h.toFixed(1)}%`,
      primaryLabel: "24h move",
      secondary: `$${(m.volUsd / 1e6).toFixed(0)}M vol`,
      accent: up ? "long" : "short",
    });
  }

  // 3) Turnover spikes (crowd rotating into a market)
  const churn = markets
    .filter((m) => m.volUsd >= 3_000_000 && m.turnover >= HIGH_TURNOVER)
    .sort((a, b) => b.turnover - a.turnover);
  for (const m of churn) {
    add(m, {
      type: "turnover",
      dir: "neutral",
      severity: m.turnover >= 8 ? "extreme" : "high",
      label: "Attention spike",
      primary: `${m.turnover.toFixed(1)}×`,
      primaryLabel: "Vol / OI",
      secondary: `$${(m.volUsd / 1e6).toFixed(0)}M vol`,
      accent: "neutral",
    });
  }

  const topByOi = [...markets].sort((a, b) => b.notionalOi - a.notionalOi);

  return {
    markets,
    topByOi,
    signals,
    fundingAnomalies,
    aggregates: {
      totalNotionalOi,
      totalVol24h,
      marketCount: markets.length,
      liquidCount: liquid.length,
      fundingMean: fMean,
      fundingStd: fStd,
      fundingAnomalyCount: fundingAnomalies.length,
    },
  };
}

export function useHyperliquid() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const raw = await fetchMetaAndCtxs(controller.signal);
      const transformed = transform(raw);
      setData(transformed);
      setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(e.message || "Failed to load Hyperliquid data");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  return { data, error, loading, lastUpdate, refresh: load };
}
