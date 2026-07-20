import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
  MAX_MUZHI_GLOBAL_CONCURRENCY,
  MIN_MUZHI_GLOBAL_CONCURRENCY,
  normalizeMuzhiGlobalConcurrency
} from "./muzhiConcurrency";

describe("Muzhi global concurrency", () => {
  it("uses the documented default and clamps finite values", () => {
    expect(DEFAULT_MUZHI_GLOBAL_CONCURRENCY).toBe(7);
    expect(MIN_MUZHI_GLOBAL_CONCURRENCY).toBe(1);
    expect(MAX_MUZHI_GLOBAL_CONCURRENCY).toBe(10);
    expect(normalizeMuzhiGlobalConcurrency(undefined)).toBe(7);
    expect(normalizeMuzhiGlobalConcurrency(0)).toBe(1);
    expect(normalizeMuzhiGlobalConcurrency(7.9)).toBe(7);
    expect(normalizeMuzhiGlobalConcurrency(99)).toBe(10);
  });
});
