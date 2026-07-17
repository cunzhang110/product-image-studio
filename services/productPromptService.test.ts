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
  it("includes the product image as Gemini inline data", () => {
    const request = buildProductPromptRequest({
      ...baseInput,
      provider: "yunwu",
      model: "gemini-3-pro-preview"
    });

    expect(request.path).toContain("gemini-3-pro-preview:generateContent");
    const body = request.body as any;
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/png", data: "YWJj" });
    expect(body.contents[0].parts[1].text).toContain("8 条");
  });

  it("includes the product image in OpenAI compatible content", () => {
    const request = buildProductPromptRequest({
      ...baseInput,
      provider: "apimart",
      model: "gemini-2.5-pro"
    });

    expect(request.path).toBe("/api/v1/chat/completions");
    const body = request.body as any;
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: baseInput.referenceImage }
    });
    expect(body.messages[1].content[1].text).toContain("8 条");
  });

  it("rejects Muzhi as a prompt provider", () => {
    expect(() => buildProductPromptRequest({
      ...baseInput,
      provider: "muzhi" as any,
      model: "gpt-image-2"
    })).toThrow("Muzhi 暂不用于生成提示词");
  });
});
