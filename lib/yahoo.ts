import YahooFinance from "yahoo-finance2";
import type { OhlcvBar } from "./indicators";
import { toYahooSymbol } from "./symbols";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const CACHE_MS = 6 * 60 * 60 * 1000;
const YEARS = 3;

type Cached = { at: number; daily: OhlcvBar[]; weekly: OhlcvBar[] };
const cache = new Map<string, Cached>();

export async function fetchDailyAndWeekly(symbol: string): Promise<{ daily: OhlcvBar[]; weekly: OhlcvBar[] }> {
  const key = toYahooSymbol(symbol);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { daily: hit.daily, weekly: hit.weekly };

  const period2 = new Date();
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - YEARS);

  let daily: OhlcvBar[] = [];
  try {
    const chart = await yahooFinance.chart(key, {
      period1,
      period2,
      interval: "1d",
    });
    daily = normalizeBars(
      (chart.quotes ?? []).map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      }))
    );
  } catch {
    const hist = await yahooFinance.historical(key, {
      period1,
      period2,
      interval: "1d",
    });
    daily = normalizeBars(
      hist.map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }))
    );
  }

  const weekly = toWeekly(daily);
  cache.set(key, { at: Date.now(), daily, weekly });
  return { daily, weekly };
}

export function toWeekly(daily: OhlcvBar[]): OhlcvBar[] {
  const weeks = new Map<string, OhlcvBar>();
  for (const bar of daily) {
    const d = new Date(`${bar.date}T00:00:00Z`);
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const existing = weeks.get(key);
    if (!existing) {
      weeks.set(key, { ...bar, date: key });
    } else {
      weeks.set(key, {
        date: key,
        open: existing.open,
        high: Math.max(existing.high, bar.high),
        low: Math.min(existing.low, bar.low),
        close: bar.close,
        volume: existing.volume + bar.volume,
      });
    }
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeBars(
  rows: Array<{
    date: Date | string;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
  }>
): OhlcvBar[] {
  const bars: OhlcvBar[] = rows
    .filter(
      (row) =>
        row.close != null &&
        row.open != null &&
        row.high != null &&
        row.low != null &&
        Number.isFinite(Number(row.close))
    )
    .map((row) => {
      const d = row.date instanceof Date ? row.date : new Date(row.date);
      return {
        date: d.toISOString().slice(0, 10),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const seen = new Set<string>();
  return bars.filter((b) => {
    if (seen.has(b.date) || b.close <= 0) return false;
    seen.add(b.date);
    return true;
  });
}
