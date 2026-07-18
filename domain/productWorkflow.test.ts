import { describe, expect, it } from "vitest";
import { createImageJobs, createProductBatch, normalizeProductBatch, parsePromptList } from "./productWorkflow";

describe("product workflow", () => {
  it("creates a dual-reference product batch with Qwen prompt generation", () => {
    const batch = createProductBatch("新品饮料");

    expect(batch.name).toBe("新品饮料");
    expect(batch.styleReferenceImage).toBe("");
    expect(batch.productReferenceImage).toBe("");
    expect(batch.prompts).toEqual([]);
    expect(batch.promptProvider).toBe("openrouter");
    expect(batch.promptModel).toBe("qwen/qwen3.5-9b");
  });

  it("migrates persisted prompt settings to the fixed OpenRouter model", () => {
    const legacy = {
      ...createProductBatch("旧批次"),
      referenceImage: "data:image/png;base64,legacy-product",
      productReferenceImage: undefined,
      styleReferenceImage: undefined,
      promptProvider: "yunwu",
      promptModel: "gemini-3-pro-preview"
    } as any;

    expect(normalizeProductBatch(legacy)).toMatchObject({
      promptProvider: "openrouter",
      promptModel: "qwen/qwen3.5-9b",
      productReferenceImage: "data:image/png;base64,legacy-product",
      styleReferenceImage: ""
    });
  });

  it("parses a JSON prompt array and removes empty duplicates", () => {
    expect(parsePromptList('["场景 A", "场景 A", "", "场景 B"]')).toEqual([
      "场景 A",
      "场景 B"
    ]);
  });

  it("falls back to newline prompts", () => {
    expect(parsePromptList("场景 A\n\n场景 B\n场景 A")).toEqual(["场景 A", "场景 B"]);
  });

  it("creates image jobs only for selected prompts", () => {
    const batch = createProductBatch("产品");
    batch.productReferenceImage = "data:image/png;base64,product";
    batch.styleReferenceImage = "data:image/png;base64,style";
    batch.prompts = [
      { id: "p1", prompt: "A", selected: true, status: "ready", createdAt: 1, updatedAt: 1 },
      { id: "p2", prompt: "B", selected: false, status: "ready", createdAt: 1, updatedAt: 1 }
    ];

    const jobs = createImageJobs(batch);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].promptSnapshot).toBe("A");
    expect(jobs[0].productReferenceImageSnapshot).toBe(batch.productReferenceImage);
    expect(jobs[0].styleReferenceImageSnapshot).toBe(batch.styleReferenceImage);
  });
});
