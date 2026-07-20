import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createProductBatch } from "../domain/productWorkflow";
import {
  initDB,
  loadProductBatchesFromDB,
  loadMuzhiConcurrencyPreference,
  loadPromptTemplatePreference,
  saveProductBatchesToDB,
  saveMuzhiConcurrencyPreference,
  savePromptTemplatePreference
} from "./db";

describe("product batch database", () => {
  it("persists and restores product batches", async () => {
    const batch = createProductBatch("测试产品");
    batch.promptTemplate = "固定包装";

    await saveProductBatchesToDB([batch]);
    const restored = await loadProductBatchesFromDB();

    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("测试产品");
    expect(restored[0].promptTemplate).toBe("固定包装");
  });
});

describe("prompt template preference database", () => {
  it("distinguishes a missing template preference from a saved empty template", async () => {
    expect(await loadPromptTemplatePreference()).toBeNull();
    await savePromptTemplatePreference("");
    expect(await loadPromptTemplatePreference()).toBe("");
    await savePromptTemplatePreference("新的酒瓶模板");
    expect(await loadPromptTemplatePreference()).toBe("新的酒瓶模板");
  });
});

describe("Muzhi concurrency preference database", () => {
  it("returns null when the concurrency preference is absent", async () => {
    await expect(loadMuzhiConcurrencyPreference()).resolves.toBeNull();
  });

  it("persists and restores the global concurrency preference", async () => {
    await saveMuzhiConcurrencyPreference(5);

    const db = await initDB();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction("settings", "readonly")
        .objectStore("settings")
        .get("muzhi-global-concurrency");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(stored).toEqual({ id: "muzhi-global-concurrency", value: 5 });
    await expect(loadMuzhiConcurrencyPreference()).resolves.toBe(5);
  });
});
