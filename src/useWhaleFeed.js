import { useState, useEffect, useRef, useCallback } from "react";

// ── Hyperliquid public websocket (no key, no auth) ──
const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

// The tape watches the most liquid markets so whale prints actually show up.
// (Subscribing to all 232 coins would flood the socket; these carry the flow.)
const WATCHED_COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "SUI",
  "kPEPE", "WLD", "LINK", "AAVE", "ENA", "PUMP", "FARTCOIN", "kBONK",
];

// Keep the tape bounded so memory stays flat over a long-open tab.
const MAX_PRINTS = 300;
// Default notional threshold for what counts as a "whale" print (USD).
// $25k keeps the tape alive during quiet hours; users can raise it.
export const DEFAULT_MIN_NOTIONAL = 25_000;

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Live whale-print tape from Hyperliquid's public `trades` WS channel.
 * Each trade carries users:[maker, taker] — real addresses, no auth — so a
 * print can drill through to that wallet's positions via clearinghouseState.
 *
 * Returns a rolling, notional-filtered feed plus per-address cumulative totals
 * for an in-session "top whales since you opened this tab" board.
 */
export function useWhaleFeed(minNotional = DEFAULT_MIN_NOTIONAL) {
  const [prints, setPrints] = useState([]);
  const [status, setStatus] = useState("connecting"); // connecting | live | reconnecting
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const seenTids = useRef(new Set());
  const minRef = useRef(minNotional);
  minRef.current = minNotional;

  const pushPrints = useCallback((incoming) => {
    if (incoming.length === 0) return;
    setPrints((prev) => {
      const merged = [...incoming, ...prev];
      // de-dupe defensively by tid and cap length
      const out = [];
      const seen = new Set();
      for (const p of merged) {
        if (seen.has(p.tid)) continue;
        seen.add(p.tid);
        out.push(p);
        if (out.length >= MAX_PRINTS) break;
      }
      return out;
    });
  }, []);

  const handleTrades = useCallback(
    (trades) => {
      const min = minRef.current;
      const whales = [];
      for (const t of trades) {
        const px = num(t.px);
        const sz = num(t.sz);
        const notional = px * sz;
        if (notional < min) continue;
        if (seenTids.current.has(t.tid)) continue;
        seenTids.current.add(t.tid);
        // taker (users[1]) is the aggressor — the wallet that lifted/hit.
        const taker = Array.isArray(t.users) ? t.users[1] : null;
        const maker = Array.isArray(t.users) ? t.users[0] : null;
        whales.push({
          tid: t.tid,
          coin: t.coin,
          side: t.side, // "B" = buy aggressor, "A" = sell aggressor
          px,
          sz,
          notional,
          time: t.time,
          taker,
          maker,
        });
      }
      // keep the seenTids set from growing unbounded
      if (seenTids.current.size > 5000) seenTids.current = new Set();
      pushPrints(whales);
    },
    [pushPrints]
  );

  // Seed the tape immediately from recentTrades so a fresh tab isn't blank
  // while the WS warms up. recentTrades returns each coin's last ~10 fills.
  const backfill = useCallback(async () => {
    const min = minRef.current;
    const results = await Promise.allSettled(
      WATCHED_COINS.map((coin) =>
        fetch(HL_INFO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "recentTrades", coin }),
        }).then((r) => (r.ok ? r.json() : []))
      )
    );
    const seed = [];
    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
      for (const t of r.value) {
        const px = num(t.px);
        const sz = num(t.sz);
        const notional = px * sz;
        if (notional < min) continue;
        if (seenTids.current.has(t.tid)) continue;
        seenTids.current.add(t.tid);
        seed.push({
          tid: t.tid,
          coin: t.coin,
          side: t.side,
          px,
          sz,
          notional,
          time: t.time,
          taker: Array.isArray(t.users) ? t.users[1] : null,
          maker: Array.isArray(t.users) ? t.users[0] : null,
        });
      }
    }
    seed.sort((a, b) => b.time - a.time);
    pushPrints(seed);
  }, [pushPrints]);

  const connect = useCallback(() => {
    let ws;
    try {
      ws = new WebSocket(HL_WS_URL);
    } catch {
      setStatus("reconnecting");
      reconnectRef.current = setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("live");
      for (const coin of WATCHED_COINS) {
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type: "trades", coin },
          })
        );
      }
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.channel === "trades" && Array.isArray(msg.data)) {
        handleTrades(msg.data);
      }
    };

    ws.onclose = () => {
      setStatus("reconnecting");
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // let onclose drive the reconnect
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, [handleTrades]);

  useEffect(() => {
    backfill();
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // don't reconnect on intentional teardown
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    };
  }, [connect, backfill]);

  return { prints, status };
}

/**
 * Fetch a wallet's open positions from the public clearinghouseState endpoint.
 * Keyless — the address comes straight from the trade tape. Returns a compact
 * shape the drill-down panel renders.
 */
export async function fetchWhalePositions(address, signal) {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
    signal,
  });
  if (!res.ok) throw new Error(`clearinghouseState ${res.status}`);
  const data = await res.json();

  const accountValue = num(data?.marginSummary?.accountValue);
  const positions = (data?.assetPositions ?? [])
    .map((ap) => {
      const p = ap.position ?? {};
      const szi = num(p.szi);
      return {
        coin: p.coin,
        szi,
        dir: szi >= 0 ? "long" : "short",
        entryPx: num(p.entryPx),
        positionValue: num(p.positionValue),
        unrealizedPnl: num(p.unrealizedPnl),
        roe: num(p.returnOnEquity),
        leverage: p.leverage?.value ?? null,
        liquidationPx: num(p.liquidationPx),
      };
    })
    .sort((a, b) => b.positionValue - a.positionValue);

  return { accountValue, positions };
}
