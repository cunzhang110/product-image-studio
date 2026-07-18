import { describe, expect, it } from "vitest";
import { createImageJobs, createProductBatch, normalizeProductBatch, parsePromptList } from "./productWorkflow";

describe("product workflow", () => {
  it("creates a single-reference product batch", () => {
    const batch = createProductBatch("新品饮料");

    expect(batch.name).toBe("新品饮料");
    expect(batch.referenceImage).toBe("");
    expect(batch.prompts).toEqual([]);
    expect(batch.promptProvider).toBe("openrouter");
    expect(batch.promptModel).toBe("google/gemma-4-31b-it:free");
  });

  it("migrates persisted prompt settings to the fixed OpenRouter model", () => {
    const legacy = {
      ...createProductBatch("旧批次"),
      promptProvider: "yunwu",
      promptModel: "gemini-3-pro-preview"
    } as any;

    expect(normalizeProductBatch(legacy)).toMatchObject({
      promptProvider: "openrouter",
      promptModel: "google/gemma-4-31b-it:free"
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
    batch.referenceImage = "data:image/png;base64,abc";
    batch.prompts = [
      { id: "p1", prompt: "A", selected: true, status: "ready", createdAt: 1, updatedAt: 1 },
      { id: "p2", prompt: "B", selected: false, status: "ready", createdAt: 1, updatedAt: 1 }
    ];

    const jobs = createImageJobs(batch);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].promptSnapshot).toBe("A");
    expect(jobs[0].referenceImageSnapshot).toBe(batch.referenceImage);
  });
});
