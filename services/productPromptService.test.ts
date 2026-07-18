import { describe, expect, it } from "vitest";
import { buildProductPromptRequest } from "./productPromptService";

const baseInput = {
  productName: "青柠气泡水",
  referenceImage: "data:image/png;base64,YWJj",
  promptTemplate: "保持绿色瓶身与白色标签",
  creativeGuide: "自然光生活场景，变化构图与镜头",
  count: 8
};

describe("product prompt request", () => {
  it("uses the fixed OpenRouter Gemma model with the product image", () => {
    const request = buildProductPromptRequest(baseInput);

    expect(request.path).toBe("/api/openrouter/chat/completions");
    const body = request.body as any;
    expect(body.model).toBe("google/gemma-4-31b-it:free");
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: baseInput.referenceImage }
    });
    expect(body.messages[1].content[1].text).toContain("8 条");
  });

  it("requires a product reference image", () => {
    expect(() => buildProductPromptRequest({ ...baseInput, referenceImage: "" }))
      .toThrow("请先上传产品参考图");
  });
});
