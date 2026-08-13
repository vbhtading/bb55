import { NextResponse } from "next/server";
import { fetchDailyAndWeekly } from "@/lib/yahoo";
import { positionLevels } from "@/lib/strategy";
import { mapPool, parseParams } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  positions: Array<{ symbol: string; entryDate: string }>;
};

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = parseParams(searchParams);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const positions = (body.positions ?? []).slice(0, 80);
  const errors: { symbol: string; error: string }[] = [];

  const rows = await mapPool(positions, 6, async (pos) => {
    try {
      const { daily } = await fetchDailyAndWeekly(pos.symbol);
      const levels = positionLevels(pos.symbol, daily, pos.entryDate, params);
      if (!levels) {
        errors.push({ symbol: pos.symbol, error: "insufficient history" });
        return null;
      }
      return levels;
    } catch (err) {
      errors.push({
        symbol: pos.symbol,
        error: err instanceof Error ? err.message : "fetch failed",
      });
      return null;
    }
  });

  return NextResponse.json({
    levels: rows.filter(Boolean),
    errors,
    params,
  });
}
