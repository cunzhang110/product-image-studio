import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createProductBatch } from "../domain/productWorkflow";
import {
  loadProductBatchesFromDB,
  loadPromptTemplatePreference,
  saveProductBatchesToDB,
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
