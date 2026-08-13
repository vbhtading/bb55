import { DEFAULTS } from "@/lib/strategy";

export function parseParams(searchParams: URLSearchParams) {
  const n = (key: string, fallback: number) => {
    const raw = searchParams.get(key);
    if (raw == null || raw === "") return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    bbLength: n("bbLen", DEFAULTS.bbLength),
    bbStd: n("bbStd", DEFAULTS.bbStd),
    bbOffset: Math.max(0, n("bbOff", DEFAULTS.bbOffset)),
    atrLength: n("atrLen", DEFAULTS.atrLength),
    atrMult: n("atrMult", DEFAULTS.atrMult),
    emaLength: n("emaLen", DEFAULTS.emaLength),
  };
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
