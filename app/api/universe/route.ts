import { NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/symbols";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ count: SYMBOLS.length, symbols: SYMBOLS });
}
