export type PositionStatus = "open" | "closed";

export type MockPosition = {
  id: string;
  symbol: string;
  qty: number;
  entryDate: string;
  entryPrice: number;
  weekClose: number;
  bbUpper: number;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
  exitDate?: string;
  exitPrice?: number;
  exitReason?: "EMA100" | "ATR" | "BOTH" | "MANUAL";
};

export const PORTFOLIO_KEY = "bb-weekly-scanner-portfolio-v1";

export function pnlPct(entry: number, exit: number): number {
  if (!entry) return 0;
  return ((exit - entry) / entry) * 100;
}

export function pnlAbs(entry: number, exit: number, qty: number): number {
  return (exit - entry) * qty;
}

export function loadPortfolio(): MockPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MockPosition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePortfolio(rows: MockPosition[]) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(rows));
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
