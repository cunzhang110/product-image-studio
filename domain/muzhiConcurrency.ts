export const DEFAULT_MUZHI_GLOBAL_CONCURRENCY = 7;
export const MIN_MUZHI_GLOBAL_CONCURRENCY = 1;
export const MAX_MUZHI_GLOBAL_CONCURRENCY = 10;

export const normalizeMuzhiGlobalConcurrency = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MUZHI_GLOBAL_CONCURRENCY;
  return Math.min(MAX_MUZHI_GLOBAL_CONCURRENCY, Math.max(MIN_MUZHI_GLOBAL_CONCURRENCY, Math.floor(numeric)));
};
