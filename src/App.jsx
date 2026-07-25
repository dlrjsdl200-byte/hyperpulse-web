import { useState, useMemo } from "react";
import { useHyperliquid } from "./useHyperliquid";

// ── formatters ──
function fmtUsd(v) {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}
function fmtPx(v) {
  if (!Number.isFinite(v) || v === 0) return "—";
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}
function fmtPct(v, digits = 2) {
  if (!Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return `${v > 0 ? "+" : ""}${s}%`;
}
// Hourly funding is a small number (e.g. 0.0013%/hr); show enough precision.
function fmtHourly(v) {
  if (!Number.isFinite(v)) return "—";
  const digits = Math.abs(v) >= 0.1 ? 3 : 4;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

const SORTS = {
  oi: { label: "Open Interest", key: (m) => m.notionalOi },
  volume: { label: "24h Volume", key: (m) => m.volUsd },
  funding: { label: "Funding", key: (m) => m.fundingHourlyPct },
  change: { label: "24h Change", key: (m) => m.change24h },
};

export default function App() {
  const { data, error, loading, lastUpdate } = useHyperliquid();
  const [sortKey, setSortKey] = useState("oi");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    let list = data.markets;
    if (q) list = list.filter((m) => m.coin.includes(q));
    const keyFn = SORTS[sortKey].key;
    return [...list].sort((a, b) => Math.abs(keyFn(b)) - Math.abs(keyFn(a)));
  }, [data, sortKey, query]);

  return (
    <div className="dashboard">
      <header className="header">
        <div className="header__left">
          <h1 className="header__title">
            Hyper<span className="header__title-accent">Pulse</span>
          </h1>
          <p className="header__subtitle">
            Real-time Hyperliquid perp intelligence — open interest, funding
            anomalies &amp; market flow across 200+ markets
          </p>
        </div>
        <div className="header__right">
          <span className="status-dot" />
          <span className="status-label">LIVE</span>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          {error} — retrying automatically…
        </div>
      )}

      {loading && !data && <LoadingState />}

      {data && (
        <>
          {/* ── Market summary ── */}
          <div className="summary">
            <SummaryStat
              label="Total Open Interest"
              value={fmtUsd(data.aggregates.totalNotionalOi)}
              sub={`${data.aggregates.marketCount} markets`}
            />
            <SummaryStat
              label="24h Volume"
              value={fmtUsd(data.aggregates.totalVol24h)}
              sub="all perps"
            />
            <SummaryStat
              label="Funding Anomalies"
              value={String(data.anomalies.length)}
              sub="|Z| ≥ 2 · liquid mkts"
              accent={data.anomalies.length > 0 ? "warn" : "neutral"}
            />
            <SummaryStat
              label="Avg Funding"
              value={fmtHourly(data.aggregates.fundingMean * 100)}
              sub="per hour · settles hourly"
              accent={data.aggregates.fundingMean >= 0 ? "long" : "short"}
            />
          </div>

          {/* ── Funding anomaly feed ── */}
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Funding Anomalies</h2>
              <span className="panel__hint">
                Statistically extreme funding — long/short crowding signal
              </span>
            </div>
            {data.anomalies.length === 0 ? (
              <div className="empty">
                No funding anomalies right now. Markets are balanced.
              </div>
            ) : (
              <div className="anomaly-grid">
                {data.anomalies.slice(0, 8).map((m) => (
                  <AnomalyCard key={m.coin} m={m} />
                ))}
              </div>
            )}
          </section>

          {/* ── Market heatmap table ── */}
          <section className="panel">
            <div className="panel__head panel__head--table">
              <div>
                <h2 className="panel__title">Market Heatmap</h2>
                <span className="panel__hint">
                  {rows.length} markets · sorted by {SORTS[sortKey].label}
                </span>
              </div>
              <div className="controls">
                <input
                  className="search"
                  placeholder="Search coin…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  spellCheck={false}
                />
                <div className="sort-tabs">
                  {Object.entries(SORTS).map(([k, s]) => (
                    <button
                      key={k}
                      className={`sort-tab${sortKey === k ? " sort-tab--active" : ""}`}
                      onClick={() => setSortKey(k)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table className="market-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-coin">Market</th>
                    <th className="col-num">Price</th>
                    <th className="col-num">24h</th>
                    <th className="col-num">Open Interest</th>
                    <th className="col-num">24h Volume</th>
                    <th className="col-num">Funding /hr</th>
                    <th className="col-num col-hide-sm">Oracle Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 60).map((m, i) => (
                    <MarketRow key={m.coin} m={m} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="status-bar">
            <span>
              Data · Hyperliquid public API · no key, no login
            </span>
            <span className="status-bar__time">
              Updated {lastUpdate?.toLocaleTimeString()} · refreshes every 15s
            </span>
          </div>

          <footer className="footer">
            <span className="footer__brand">chain-ops</span>
            <span className="footer__sep">·</span>
            <span>HyperPulse is informational only, not financial advice.</span>
          </footer>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, sub, accent = "neutral" }) {
  return (
    <div className={`summary-stat summary-stat--${accent}`}>
      <span className="summary-stat__label">{label}</span>
      <span className="summary-stat__value">{value}</span>
      <span className="summary-stat__sub">{sub}</span>
    </div>
  );
}

function AnomalyCard({ m }) {
  const dir = m.fundingDir; // long | short
  return (
    <div className={`anomaly-card anomaly-card--${dir}`}>
      <div className="anomaly-card__top">
        <span className="anomaly-card__coin">{m.coin}</span>
        <span className={`sev sev--${m.fundingSeverity}`}>
          {m.fundingSeverity === "extreme" ? "EXTREME" : "HIGH"}
        </span>
      </div>
      <div className="anomaly-card__dir">
        {dir === "long" ? "Longs overpaying" : "Shorts overpaying"}
      </div>
      <div className="anomaly-card__stats">
        <div className="mini">
          <span className="mini__label">Funding /hr</span>
          <span className={`mini__value ${dir === "long" ? "pos" : "neg"}`}>
            {fmtHourly(m.fundingHourlyPct)}
          </span>
          <span className="mini__apr">{fmtPct(m.annualizedFunding, 0)} APR</span>
        </div>
        <div className="mini">
          <span className="mini__label">Z-score</span>
          <span className="mini__value">{m.fundingZ.toFixed(1)}σ</span>
        </div>
        <div className="mini">
          <span className="mini__label">OI</span>
          <span className="mini__value">{fmtUsd(m.notionalOi)}</span>
        </div>
      </div>
    </div>
  );
}

function MarketRow({ m, rank }) {
  const up = m.change24h >= 0;
  const fundPos = m.fundingHourlyPct >= 0;
  // heat: normalize OI to a subtle bar (log scale so mega-caps don't wash out)
  return (
    <tr className="market-row">
      <td className="col-rank">{rank}</td>
      <td className="col-coin">
        <span className="market-row__coin">{m.coin}</span>
        {m.maxLeverage ? (
          <span className="market-row__lev">{m.maxLeverage}×</span>
        ) : null}
      </td>
      <td className="col-num mono">${fmtPx(m.mark)}</td>
      <td className={`col-num mono ${up ? "pos" : "neg"}`}>
        {fmtPct(m.change24h)}
      </td>
      <td className="col-num mono">{fmtUsd(m.notionalOi)}</td>
      <td className="col-num mono">{fmtUsd(m.volUsd)}</td>
      <td className={`col-num mono ${fundPos ? "pos" : "neg"}`}>
        {fmtHourly(m.fundingHourlyPct)}
        {m.fundingSeverity !== "none" && (
          <span className={`dot-flag dot-flag--${m.fundingDir}`} />
        )}
      </td>
      <td className="col-num mono col-hide-sm">{fmtPct(m.oracleGap, 3)}</td>
    </tr>
  );
}

function LoadingState() {
  return (
    <>
      <div className="summary">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="summary-stat summary-stat--neutral">
            <div className="skeleton skeleton--sm" />
            <div className="skeleton skeleton--lg" />
            <div className="skeleton skeleton--sm" />
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="skeleton skeleton--table" />
      </div>
    </>
  );
}
