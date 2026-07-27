import { useState, useMemo, useEffect, useRef } from "react";
import {
  useWhaleFeed,
  fetchWhalePositions,
  DEFAULT_MIN_NOTIONAL,
} from "./useWhaleFeed";

// ── formatters (kept local so the panel is self-contained) ──
function fmtUsd(v) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPx(v) {
  if (!Number.isFinite(v) || v === 0) return "—";
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}
function shortAddr(a) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function ago(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const THRESHOLDS = [
  { label: "$10K", value: 10_000 },
  { label: "$25K", value: DEFAULT_MIN_NOTIONAL },
  { label: "$100K", value: 100_000 },
  { label: "$1M", value: 1_000_000 },
];

const STATUS_LABEL = {
  connecting: "CONNECTING",
  live: "LIVE",
  reconnecting: "RECONNECTING",
};

export default function WhalePanel() {
  const [minNotional, setMinNotional] = useState(() => {
    const saved = Number(localStorage.getItem("hp_whale_min"));
    return THRESHOLDS.some((t) => t.value === saved)
      ? saved
      : DEFAULT_MIN_NOTIONAL;
  });
  const { prints, status } = useWhaleFeed(minNotional);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    localStorage.setItem("hp_whale_min", String(minNotional));
  }, [minNotional]);

  // In-session leaderboard: cumulative aggressor notional per address since page open.
  const leaders = useMemo(() => {
    const byAddr = new Map();
    for (const p of prints) {
      if (!p.taker) continue;
      const cur = byAddr.get(p.taker) ?? { addr: p.taker, notional: 0, count: 0 };
      cur.notional += p.notional;
      cur.count += 1;
      byAddr.set(p.taker, cur);
    }
    return [...byAddr.values()]
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 5);
  }, [prints]);

  return (
    <section className="panel">
      <div className="panel__head panel__head--table">
        <div>
          <h2 className="panel__title">Whale Tape</h2>
          <span className="panel__hint">
            Live large prints from Hyperliquid — click an address for its book
          </span>
        </div>
        <div className="controls">
          <div className={`whale-status whale-status--${status}`}>
            <span className="whale-status__dot" />
            <span className="whale-status__label">{STATUS_LABEL[status]}</span>
          </div>
          <div className="sort-tabs">
            {THRESHOLDS.map((t) => (
              <button
                key={t.value}
                className={`sort-tab${minNotional === t.value ? " sort-tab--active" : ""}`}
                onClick={() => setMinNotional(t.value)}
              >
                {t.label}+
              </button>
            ))}
          </div>
        </div>
      </div>

      {leaders.length > 0 && (
        <div className="whale-leaders">
          <span className="whale-leaders__label">
            Top whales since you opened this tab
          </span>
          <div className="whale-leaders__row">
            {leaders.map((l) => (
              <button
                key={l.addr}
                className="whale-chip"
                onClick={() => setSelected(l.addr)}
                title={l.addr}
              >
                <span className="whale-chip__addr">{shortAddr(l.addr)}</span>
                <span className="whale-chip__ntl">{fmtUsd(l.notional)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="whale-tape">
        {prints.length === 0 ? (
          <div className="empty">
            {status === "live"
              ? `Live — no prints over ${THRESHOLDS.find((t) => t.value === minNotional)?.label ?? ""} yet. Quiet market? Lower the threshold or leave the tab open.`
              : "Connecting to Hyperliquid live feed…"}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="market-table whale-table">
              <thead>
                <tr>
                  <th className="col-coin">Market</th>
                  <th className="col-num">Side</th>
                  <th className="col-num">Price</th>
                  <th className="col-num">Size</th>
                  <th className="col-num">Notional</th>
                  <th className="col-num">Taker</th>
                  <th className="col-num col-hide-sm">Age</th>
                </tr>
              </thead>
              <tbody>
                {prints.slice(0, 40).map((p) => {
                  const buy = p.side === "B";
                  return (
                    <tr key={p.tid} className="market-row">
                      <td className="col-coin">
                        <span className="market-row__coin">{p.coin}</span>
                      </td>
                      <td className={`col-num mono ${buy ? "pos" : "neg"}`}>
                        {buy ? "BUY" : "SELL"}
                      </td>
                      <td className="col-num mono">${fmtPx(p.px)}</td>
                      <td className="col-num mono">{p.sz}</td>
                      <td className={`col-num mono ${buy ? "pos" : "neg"}`}>
                        {fmtUsd(p.notional)}
                      </td>
                      <td className="col-num">
                        {p.taker ? (
                          <button
                            className="addr-link"
                            onClick={() => setSelected(p.taker)}
                            title={p.taker}
                          >
                            {shortAddr(p.taker)}
                          </button>
                        ) : (
                          <span className="mono">—</span>
                        )}
                      </td>
                      <td className="col-num mono col-hide-sm">{ago(p.time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <WhaleDrilldown
          address={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function WhaleDrilldown({ address, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const abortRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ loading: true, error: null, data: null });
    fetchWhalePositions(address, controller.signal)
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((e) => {
        if (e.name !== "AbortError") {
          setState({ loading: false, error: e.message, data: null });
        }
      });
    return () => controller.abort();
  }, [address]);

  // close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { loading, error, data } = state;

  return (
    <div className="drill-overlay" onClick={onClose}>
      <div className="drill" onClick={(e) => e.stopPropagation()}>
        <div className="drill__head">
          <div>
            <span className="drill__label">WALLET</span>
            <span className="drill__addr mono">{address}</span>
          </div>
          <button className="drill__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loading && <div className="empty">Loading positions…</div>}
        {error && <div className="error-banner">{error}</div>}

        {data && (
          <>
            <div className="drill__summary">
              <div className="mini">
                <span className="mini__label">Account Value</span>
                <span className="mini__value">{fmtUsd(data.accountValue)}</span>
              </div>
              <div className="mini">
                <span className="mini__label">Open Positions</span>
                <span className="mini__value">{data.positions.length}</span>
              </div>
            </div>

            {data.positions.length === 0 ? (
              <div className="empty">No open positions right now.</div>
            ) : (
              <div className="table-wrap">
                <table className="market-table">
                  <thead>
                    <tr>
                      <th className="col-coin">Market</th>
                      <th className="col-num">Side</th>
                      <th className="col-num">Notional</th>
                      <th className="col-num">Entry</th>
                      <th className="col-num">uPnL</th>
                      <th className="col-num col-hide-sm">Liq. Px</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => {
                      const long = p.dir === "long";
                      const win = p.unrealizedPnl >= 0;
                      return (
                        <tr key={p.coin} className="market-row">
                          <td className="col-coin">
                            <span className="market-row__coin">{p.coin}</span>
                            {p.leverage ? (
                              <span className="market-row__lev">
                                {p.leverage}×
                              </span>
                            ) : null}
                          </td>
                          <td className={`col-num mono ${long ? "pos" : "neg"}`}>
                            {long ? "LONG" : "SHORT"}
                          </td>
                          <td className="col-num mono">
                            {fmtUsd(p.positionValue)}
                          </td>
                          <td className="col-num mono">${fmtPx(p.entryPx)}</td>
                          <td className={`col-num mono ${win ? "pos" : "neg"}`}>
                            {fmtUsd(p.unrealizedPnl)}
                          </td>
                          <td className="col-num mono col-hide-sm">
                            ${fmtPx(p.liquidationPx)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="drill__foot">
              Positions via Hyperliquid public clearinghouseState · live snapshot
            </p>
          </>
        )}
      </div>
    </div>
  );
}
