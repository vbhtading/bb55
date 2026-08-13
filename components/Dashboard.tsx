"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Briefcase, Radar, LogOut } from "lucide-react";
import { SYMBOLS } from "@/lib/symbols";
import { DEFAULTS, type EntryHit, type ExitHit, type PositionLevels } from "@/lib/strategy";
import {
  loadPortfolio,
  savePortfolio,
  uid,
  pnlAbs,
  pnlPct,
  type MockPosition,
} from "@/lib/portfolio";
import { formatInr, formatNumber, formatPct, cn } from "@/lib/format";

type Tab = "entry" | "exit" | "portfolio";

type ScanPayload<T> = {
  scanned: number;
  found: number;
  universe: number;
  done: boolean;
  nextOffset: number;
  hits: T[];
  errors?: Array<{ symbol: string; error: string }>;
  error?: string;
};

function qs(params: Record<string, string | number | boolean>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  return sp.toString();
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("entry");
  const [bbLen, setBbLen] = useState(DEFAULTS.bbLength);
  const [bbStd, setBbStd] = useState(DEFAULTS.bbStd);
  const [bbOff, setBbOff] = useState(DEFAULTS.bbOffset);
  const [atrLen, setAtrLen] = useState(DEFAULTS.atrLength);
  const [atrMult, setAtrMult] = useState(DEFAULTS.atrMult);
  const [emaLen, setEmaLen] = useState(DEFAULTS.emaLength);
  const [freshOnly, setFreshOnly] = useState(true);

  const [entryHits, setEntryHits] = useState<EntryHit[]>([]);
  const [exitHits, setExitHits] = useState<ExitHit[]>([]);
  const [progress, setProgress] = useState({ scanned: 0, universe: SYMBOLS.length, running: false });
  const [scanError, setScanError] = useState<string | null>(null);

  const [positions, setPositions] = useState<MockPosition[]>([]);
  const [levels, setLevels] = useState<Record<string, PositionLevels>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [bookQty, setBookQty] = useState<Record<string, string>>({});

  useEffect(() => {
    setPositions(loadPortfolio());
  }, []);

  const persist = (next: MockPosition[]) => {
    setPositions(next);
    savePortfolio(next);
  };

  const paramQuery = useMemo(
    () => ({
      bbLen,
      bbStd,
      bbOff,
      atrLen,
      atrMult,
      emaLen,
    }),
    [bbLen, bbStd, bbOff, atrLen, atrMult, emaLen]
  );

  const runScan = useCallback(
    async (mode: "entry" | "exit") => {
      setScanError(null);
      setProgress({ scanned: 0, universe: SYMBOLS.length, running: true });
      if (mode === "entry") setEntryHits([]);
      else setExitHits([]);

      let offset = 0;
      const merged: Array<EntryHit | ExitHit> = [];
      try {
        while (true) {
          const res = await fetch(
            `/api/scan?${qs({
              mode,
              offset,
              limit: 40,
              fresh: mode === "entry" && freshOnly ? 1 : 0,
              ...paramQuery,
            })}`
          );
          const json = (await res.json()) as ScanPayload<EntryHit | ExitHit>;
          if (!res.ok) throw new Error(json.error || "Scan failed");
          merged.push(...json.hits);
          offset = json.nextOffset;
          setProgress({ scanned: Math.min(offset, json.universe), universe: json.universe, running: true });
          if (mode === "entry") setEntryHits(merged as EntryHit[]);
          else setExitHits(merged as ExitHit[]);
          if (json.done) break;
        }
      } catch (e) {
        setScanError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setProgress((p) => ({ ...p, running: false }));
      }
    },
    [freshOnly, paramQuery]
  );

  const refreshLevels = useCallback(async () => {
    const open = positions.filter((p) => p.status === "open");
    if (!open.length) {
      setLevels({});
      return;
    }
    const res = await fetch(`/api/levels?${qs(paramQuery)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: open.map((p) => ({ symbol: p.symbol, entryDate: p.entryDate })),
      }),
    });
    const json = (await res.json()) as { levels?: PositionLevels[] };
    const map: Record<string, PositionLevels> = {};
    for (const row of json.levels ?? []) map[row.symbol] = row;
    setLevels(map);
  }, [paramQuery, positions]);

  useEffect(() => {
    if (tab === "portfolio") void refreshLevels();
  }, [tab, refreshLevels]);

  const addFromScan = (hit: EntryHit) => {
    const qty = Number(qtyDraft[hit.symbol] || 1);
    const next: MockPosition = {
      id: uid(),
      symbol: hit.symbol,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      entryDate: hit.weekDate,
      entryPrice: hit.weekClose,
      weekClose: hit.weekClose,
      bbUpper: hit.bbUpper,
      status: "open",
      openedAt: new Date().toISOString(),
    };
    persist([next, ...positions]);
    setTab("portfolio");
  };

  const book = (pos: MockPosition, reason: MockPosition["exitReason"] = "MANUAL") => {
    const lv = levels[pos.symbol];
    const px = Number(bookQty[pos.id] || lv?.lastClose || pos.entryPrice);
    persist(
      positions.map((p) =>
        p.id === pos.id
          ? {
              ...p,
              status: "closed",
              closedAt: new Date().toISOString(),
              exitDate: lv?.dailyDate,
              exitPrice: px,
              exitReason: lv?.exitReason ?? reason,
            }
          : p
      )
    );
  };

  const removePos = (id: string) => persist(positions.filter((p) => p.id !== id));

  const openRows = positions.filter((p) => p.status === "open");
  const closedRows = positions.filter((p) => p.status === "closed");

  const openPnl = openRows.reduce((sum, p) => {
    const last = levels[p.symbol]?.lastClose ?? p.entryPrice;
    return sum + pnlAbs(p.entryPrice, last, p.qty);
  }, 0);
  const bookedPnl = closedRows.reduce((sum, p) => sum + pnlAbs(p.entryPrice, p.exitPrice ?? p.entryPrice, p.qty), 0);

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 20px 64px" }}>
      <header className="rise-in" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
              NSE · weekly close
            </div>
            <h1 className="font-display" style={{ margin: 0, fontSize: "clamp(1.9rem, 4vw, 2.8rem)", letterSpacing: "-0.03em" }}>
              BB 55 / 3 / 4 scanner
            </h1>
            <p className="muted" style={{ margin: "12px 0 0", maxWidth: 640, lineHeight: 1.55 }}>
              Entry: weekly close above upper Bollinger ({bbLen}, {bbStd}) with band offset {bbOff}.
              Exit: daily close below ATR({atrLen}) × {atrMult} chandelier, or below EMA {emaLen}.
            </p>
          </div>
          <div className="panel" style={{ padding: "14px 18px", minWidth: 200 }}>
            <div className="muted" style={{ fontSize: 12 }}>Universe</div>
            <div className="metric-value" style={{ fontSize: 28, marginTop: 4 }}>{SYMBOLS.length}</div>
            <div className="muted" style={{ fontSize: 12 }}>Nifty 500 · Yahoo .NS</div>
          </div>
        </div>
      </header>

      <section className="panel rise-in" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <Field label="BB length" value={bbLen} onChange={setBbLen} />
          <Field label="BB std" value={bbStd} onChange={setBbStd} step={0.1} />
          <Field label="BB offset" value={bbOff} onChange={setBbOff} />
          <Field label="ATR length" value={atrLen} onChange={setAtrLen} />
          <Field label="ATR mult" value={atrMult} onChange={setAtrMult} step={0.1} />
          <Field label="EMA" value={emaLen} onChange={setEmaLen} />
        </div>
        <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={freshOnly} onChange={(e) => setFreshOnly(e.target.checked)} />
          Entry scan: only fresh breakouts (prior week was not above the band)
        </label>
      </section>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(
          [
            ["entry", "Entry scan", Radar],
            ["exit", "Exit scan", LogOut],
            ["portfolio", "Mock portfolio", Briefcase],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={cn("btn", tab === id ? "btn-primary" : "btn-ghost")}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
        {tab !== "portfolio" && (
          <button className="btn btn-primary" disabled={progress.running} onClick={() => void runScan(tab)}>
            {progress.running ? `Scanning ${progress.scanned}/${progress.universe}` : `Run ${tab} scan`}
          </button>
        )}
        {tab === "portfolio" && (
          <button className="btn btn-ghost" onClick={() => void refreshLevels()}>
            Refresh marks
          </button>
        )}
      </div>

      {progress.running && (
        <div className="panel" style={{ padding: 10, marginBottom: 14 }}>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
            <div
              style={{
                width: `${(progress.scanned / Math.max(progress.universe, 1)) * 100}%`,
                height: "100%",
                borderRadius: 99,
                background: "linear-gradient(90deg, #1fa7a0, #5fd98f)",
              }}
            />
          </div>
        </div>
      )}

      {scanError && <p className="loss">{scanError}</p>}

      {tab === "entry" && (
        <div className="panel" style={{ padding: 8 }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Week</th>
                  <th>Wk close</th>
                  <th>Upper BB</th>
                  <th>Vs band</th>
                  <th>Daily</th>
                  <th>EMA {emaLen}</th>
                  <th>ATR stop</th>
                  <th>Qty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entryHits.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      Run the weekly scan. Hits are names whose last weekly close is above BB({bbLen}, {bbStd}) offset {bbOff}.
                    </td>
                  </tr>
                )}
                {entryHits.map((hit) => (
                  <tr key={hit.symbol}>
                    <td>
                      <strong>{hit.symbol}</strong>{" "}
                      {hit.freshBreakout && <span className="badge badge-buy">fresh</span>}
                    </td>
                    <td>{hit.weekDate}</td>
                    <td>{formatNumber(hit.weekClose)}</td>
                    <td>{formatNumber(hit.bbUpper)}</td>
                    <td className="gain">{formatPct(hit.closeVsUpperPct)}</td>
                    <td>{formatNumber(hit.dailyClose)}</td>
                    <td>{formatNumber(hit.ema100)}</td>
                    <td>{formatNumber(hit.atrStop)}</td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 72 }}
                        value={qtyDraft[hit.symbol] ?? "1"}
                        onChange={(e) => setQtyDraft((s) => ({ ...s, [hit.symbol]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button className="btn btn-ghost" onClick={() => addFromScan(hit)}>
                        <BookmarkPlus size={14} /> Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "exit" && (
        <div className="panel" style={{ padding: 8 }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Date</th>
                  <th>Close</th>
                  <th>EMA {emaLen}</th>
                  <th>ATR stop</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {exitHits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Run exit scan for names whose latest daily close is below EMA {emaLen} or below (swing high − {atrMult}×ATR{atrLen}).
                    </td>
                  </tr>
                )}
                {exitHits.map((hit) => (
                  <tr key={hit.symbol}>
                    <td><strong>{hit.symbol}</strong></td>
                    <td>{hit.dailyDate}</td>
                    <td>{formatNumber(hit.dailyClose)}</td>
                    <td className={hit.belowEma ? "loss" : ""}>{formatNumber(hit.ema100)}</td>
                    <td className={hit.belowAtrStop ? "loss" : ""}>{formatNumber(hit.atrStop)}</td>
                    <td><span className="badge badge-exit">{hit.exitReason}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "portfolio" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Stat label="Open" value={String(openRows.length)} />
            <Stat label="Running P&L" value={formatInr(openPnl)} gain={openPnl >= 0} />
            <Stat label="Booked" value={String(closedRows.length)} />
            <Stat label="Booked P&L" value={formatInr(bookedPnl)} gain={bookedPnl >= 0} />
          </div>

          <div className="panel" style={{ padding: 8 }}>
            <h3 className="font-display" style={{ margin: "12px 16px" }}>Running</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Entry</th>
                    <th>Qty</th>
                    <th>Last</th>
                    <th>P&L</th>
                    <th>EMA exit</th>
                    <th>ATR stop</th>
                    <th>Flag</th>
                    <th>Book @</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {openRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="muted">Add names from the entry scan. Marks update from daily Yahoo data.</td>
                    </tr>
                  )}
                  {openRows.map((p) => {
                    const lv = levels[p.symbol];
                    const last = lv?.lastClose ?? p.entryPrice;
                    const pct = pnlPct(p.entryPrice, last);
                    const abs = pnlAbs(p.entryPrice, last, p.qty);
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.symbol}</strong></td>
                        <td>
                          {p.entryDate}
                          <div className="muted">{formatNumber(p.entryPrice)}</div>
                        </td>
                        <td>{p.qty}</td>
                        <td>{formatNumber(last)}</td>
                        <td className={pct >= 0 ? "gain" : "loss"}>
                          {formatPct(pct)}
                          <div>{formatInr(abs)}</div>
                        </td>
                        <td className={lv?.belowEma ? "loss" : ""}>{formatNumber(lv?.ema100)}</td>
                        <td className={lv?.belowAtrStop ? "loss" : ""}>{formatNumber(lv?.atrStop)}</td>
                        <td>
                          {lv?.suggestedExit ? (
                            <span className="badge badge-exit">{lv.exitReason}</span>
                          ) : (
                            <span className="badge badge-hold">open</span>
                          )}
                        </td>
                        <td>
                          <input
                            className="input"
                            style={{ width: 96 }}
                            placeholder={formatNumber(last, 1)}
                            value={bookQty[p.id] ?? ""}
                            onChange={(e) => setBookQty((s) => ({ ...s, [p.id]: e.target.value }))}
                          />
                        </td>
                        <td>
                          <button className="btn btn-danger" onClick={() => book(p)}>Book</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ padding: 8 }}>
            <h3 className="font-display" style={{ margin: "12px 16px" }}>Booked</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Qty</th>
                    <th>Final P&L</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {closedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">Closed trades land here with final P&amp;L.</td>
                    </tr>
                  )}
                  {closedRows.map((p) => {
                    const pct = pnlPct(p.entryPrice, p.exitPrice ?? p.entryPrice);
                    const abs = pnlAbs(p.entryPrice, p.exitPrice ?? p.entryPrice, p.qty);
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.symbol}</strong></td>
                        <td>
                          {p.entryDate}
                          <div className="muted">{formatNumber(p.entryPrice)}</div>
                        </td>
                        <td>
                          {p.exitDate ?? "—"}
                          <div className="muted">{formatNumber(p.exitPrice)}</div>
                        </td>
                        <td>{p.qty}</td>
                        <td className={pct >= 0 ? "gain" : "loss"}>
                          {formatPct(pct)}
                          <div>{formatInr(abs)}</div>
                        </td>
                        <td><span className="badge badge-exit">{p.exitReason ?? "MANUAL"}</span></td>
                        <td>
                          <button className="btn btn-ghost" onClick={() => removePos(p.id)}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="muted" style={{ fontSize: 12 }}>
      {label}
      <input
        className="input"
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ marginTop: 6 }}
      />
    </label>
  );
}

function Stat({ label, value, gain }: { label: string; value: string; gain?: boolean }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className={cn("metric-value", gain === true && "gain", gain === false && "loss")} style={{ fontSize: 22, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
