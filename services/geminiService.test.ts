import { describe, expect, it } from "vitest";
import { resolveImageGenerationPrompt } from "./geminiService";

describe("image provider prompt", () => {
  it("uses the product-fidelity reference prompt for every provider payload", () => {
    expect(resolveImageGenerationPrompt("原始场景", "产品透明度必须一致")).toBe("产品透明度必须一致");
    expect(resolveImageGenerationPrompt("原始场景", undefined)).toBe("原始场景");
  });
});
