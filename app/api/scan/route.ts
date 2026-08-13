import { NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/symbols";
import { fetchDailyAndWeekly } from "@/lib/yahoo";
import { evaluateEntry, isExitHit, evaluateDailyExit, type EntryHit, type ExitHit } from "@/lib/strategy";
import { mapPool, parseParams } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "exit" ? "exit" : "entry";
  const freshOnly = searchParams.get("fresh") !== "0";
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const limit = Math.min(80, Math.max(1, Number(searchParams.get("limit") || 40)));
  const params = parseParams(searchParams);

  const slice = SYMBOLS.slice(offset, offset + limit);
  const errors: { symbol: string; error: string }[] = [];

  const rows = await mapPool(slice, 6, async (symbol) => {
    try {
      const { daily, weekly } = await fetchDailyAndWeekly(symbol);
      if (mode === "entry") {
        const hit = evaluateEntry(symbol, weekly, daily, params);
        if (!hit) return null;
        if (freshOnly && !hit.freshBreakout) return null;
        return hit;
      }
      const ev = evaluateDailyExit(daily, params, null);
      if (!ev || !isExitHit(ev)) return null;
      const hit: ExitHit = { ...ev, symbol };
      return hit;
    } catch (err) {
      errors.push({
        symbol,
        error: err instanceof Error ? err.message : "fetch failed",
      });
      return null;
    }
  });

  const hits = rows.filter((r): r is EntryHit | ExitHit => r != null);
  if (mode === "entry") {
    (hits as EntryHit[]).sort((a, b) => b.closeVsUpperPct - a.closeVsUpperPct);
  }

  return NextResponse.json({
    mode,
    scanned: slice.length,
    offset,
    limit,
    universe: SYMBOLS.length,
    done: offset + slice.length >= SYMBOLS.length,
    nextOffset: offset + slice.length,
    found: hits.length,
    params,
    hits,
    errors: errors.slice(0, 30),
  });
}
