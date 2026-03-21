export type WatchRefreshStrategy = "watch-1s" | "watch-3s" | "watch-5s";
export type ScanRefreshStrategy = "scan-5s" | "scan-10s" | "scan-30s" | "scan-1min" | "scan-5min";
export type NonOffRefreshStrategy = WatchRefreshStrategy | ScanRefreshStrategy;
export type RefreshStrategy = "off" | NonOffRefreshStrategy;

export const DEFAULT_PREFERRED_REFRESH_STRATEGY: NonOffRefreshStrategy = "watch-1s";

export const REFRESH_STRATEGY_OPTIONS: ReadonlyArray<{
  label: string;
  value: RefreshStrategy;
}> = [
  { label: "Manual", value: "off" },
  { label: "Watch (1s debounce)", value: "watch-1s" },
  { label: "Watch (3s debounce)", value: "watch-3s" },
  { label: "Watch (5s debounce)", value: "watch-5s" },
  { label: "5s scan", value: "scan-5s" },
  { label: "10s scan", value: "scan-10s" },
  { label: "30s scan", value: "scan-30s" },
  { label: "1 min scan", value: "scan-1min" },
  { label: "5 min scan", value: "scan-5min" },
];

export const WATCH_STRATEGY_TO_DEBOUNCE_MS: Record<WatchRefreshStrategy, 1000 | 3000 | 5000> = {
  "watch-1s": 1_000,
  "watch-3s": 3_000,
  "watch-5s": 5_000,
};

export const SCAN_STRATEGY_TO_INTERVAL_MS: Record<ScanRefreshStrategy, number> = {
  "scan-5s": 5_000,
  "scan-10s": 10_000,
  "scan-30s": 30_000,
  "scan-1min": 60_000,
  "scan-5min": 300_000,
};

export function isWatchRefreshStrategy(
  strategy: RefreshStrategy,
): strategy is WatchRefreshStrategy {
  return strategy in WATCH_STRATEGY_TO_DEBOUNCE_MS;
}

export function isScanRefreshStrategy(strategy: RefreshStrategy): strategy is ScanRefreshStrategy {
  return strategy in SCAN_STRATEGY_TO_INTERVAL_MS;
}
