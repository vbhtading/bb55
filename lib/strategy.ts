import type { OhlcvBar } from "./indicators";
import { atr, bollinger, ema } from "./indicators";

export const DEFAULTS = {
  bbLength: 55,
  bbStd: 3,
  bbOffset: 4,
  atrLength: 14,
  atrMult: 1.8,
  emaLength: 100,
};

export type ScanParams = typeof DEFAULTS;

export type EntryHit = {
  symbol: string;
  weekDate: string;
  weekClose: number;
  weekHigh: number;
  bbMid: number;
  bbUpper: number;
  bbLower: number;
  closeVsUpperPct: number;
  freshBreakout: boolean;
  dailyDate: string;
  dailyClose: number;
  ema100: number;
  atr: number;
  atrStop: number;
  belowEma: boolean;
  belowAtrStop: boolean;
};

export type ExitHit = {
  symbol: string;
  dailyDate: string;
  dailyClose: number;
  ema100: number;
  atr: number;
  atrStop: number;
  belowEma: boolean;
  belowAtrStop: boolean;
  exitReason: "EMA100" | "ATR" | "BOTH";
};

export type PositionLevels = {
  symbol: string;
  dailyDate: string;
  lastClose: number;
  ema100: number | null;
  atr: number | null;
  highestHighSinceEntry: number | null;
  atrStop: number | null;
  belowEma: boolean;
  belowAtrStop: boolean;
  suggestedExit: boolean;
  exitReason: "EMA100" | "ATR" | "BOTH" | null;
};

function bandAt(series: (number | null)[], index: number, offset: number): number | null {
  const src = index - Math.max(0, offset);
  if (src < 0) return null;
  return series[src];
}

export function evaluateEntry(
  symbol: string,
  weekly: OhlcvBar[],
  daily: OhlcvBar[],
  params: ScanParams
): EntryHit | null {
  if (weekly.length < params.bbLength + params.bbOffset + 2) return null;
  if (daily.length < params.emaLength + params.atrLength + 2) return null;

  const closes = weekly.map((b) => b.close);
  const { mid, upper, lower } = bollinger(closes, params.bbLength, params.bbStd);
  const i = weekly.length - 1;
  const prev = i - 1;
  const upperNow = bandAt(upper, i, params.bbOffset);
  const upperPrev = bandAt(upper, prev, params.bbOffset);
  const midNow = bandAt(mid, i, params.bbOffset);
  const lowerNow = bandAt(lower, i, params.bbOffset);
  if (upperNow == null || midNow == null || lowerNow == null) return null;

  const week = weekly[i];
  if (week.close <= upperNow) return null;

  const freshBreakout = upperPrev != null && weekly[prev].close <= upperPrev;
  const dailyEval = evaluateDailyExit(daily, params, null);

  return {
    symbol,
    weekDate: week.date,
    weekClose: week.close,
    weekHigh: week.high,
    bbMid: midNow,
    bbUpper: upperNow,
    bbLower: lowerNow,
    closeVsUpperPct: ((week.close - upperNow) / upperNow) * 100,
    freshBreakout,
    dailyDate: dailyEval?.dailyDate ?? daily[daily.length - 1].date,
    dailyClose: dailyEval?.dailyClose ?? daily[daily.length - 1].close,
    ema100: dailyEval?.ema100 ?? 0,
    atr: dailyEval?.atr ?? 0,
    atrStop: dailyEval?.atrStop ?? 0,
    belowEma: dailyEval?.belowEma ?? false,
    belowAtrStop: dailyEval?.belowAtrStop ?? false,
  };
}

export function evaluateDailyExit(
  daily: OhlcvBar[],
  params: ScanParams,
  sinceDate: string | null
): ExitHit | null {
  if (daily.length < params.emaLength + params.atrLength + 2) return null;
  const closes = daily.map((b) => b.close);
  const emaSeries = ema(closes, params.emaLength);
  const atrSeries = atr(daily, params.atrLength);
  const i = daily.length - 1;
  const emaNow = emaSeries[i];
  const atrNow = atrSeries[i];
  if (emaNow == null || atrNow == null) return null;

  let start = 0;
  if (sinceDate) {
    const idx = daily.findIndex((b) => b.date >= sinceDate);
    start = idx >= 0 ? idx : 0;
  } else {
    start = Math.max(0, daily.length - params.atrLength);
  }

  let hh = daily[start].high;
  for (let j = start; j <= i; j++) hh = Math.max(hh, daily[j].high);
  const atrStop = hh - params.atrMult * atrNow;
  const close = daily[i].close;
  const belowEma = close < emaNow;
  const belowAtrStop = close < atrStop;
  if (!belowEma && !belowAtrStop && sinceDate == null) {
    return {
      symbol: "",
      dailyDate: daily[i].date,
      dailyClose: close,
      ema100: emaNow,
      atr: atrNow,
      atrStop,
      belowEma,
      belowAtrStop,
      exitReason: "EMA100",
    };
  }

  let exitReason: ExitHit["exitReason"] = "EMA100";
  if (belowEma && belowAtrStop) exitReason = "BOTH";
  else if (belowAtrStop) exitReason = "ATR";

  return {
    symbol: "",
    dailyDate: daily[i].date,
    dailyClose: close,
    ema100: emaNow,
    atr: atrNow,
    atrStop,
    belowEma,
    belowAtrStop,
    exitReason,
  };
}

export function positionLevels(
  symbol: string,
  daily: OhlcvBar[],
  entryDate: string,
  params: ScanParams
): PositionLevels | null {
  const ev = evaluateDailyExit(daily, params, entryDate);
  if (!ev) return null;
  const suggested = ev.belowEma || ev.belowAtrStop;
  return {
    symbol,
    dailyDate: ev.dailyDate,
    lastClose: ev.dailyClose,
    ema100: ev.ema100,
    atr: ev.atr,
    highestHighSinceEntry: ev.atrStop + params.atrMult * ev.atr,
    atrStop: ev.atrStop,
    belowEma: ev.belowEma,
    belowAtrStop: ev.belowAtrStop,
    suggestedExit: suggested,
    exitReason: suggested ? ev.exitReason : null,
  };
}

export function isExitHit(ev: ExitHit): boolean {
  return ev.belowEma || ev.belowAtrStop;
}
