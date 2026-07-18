import { describe, expect, it } from "vitest";
import { buildProductPromptRequest } from "./productPromptService";

const baseInput = {
  productName: "青柠气泡水",
  styleReferenceImage: "data:image/png;base64,YWJj",
  promptTemplate: "保持绿色瓶身与白色标签",
  creativeGuide: "自然光生活场景，变化构图与镜头",
  count: 8
};

describe("product prompt request", () => {
  it("uses Qwen3.5 9B with the style reference image", () => {
    const request = buildProductPromptRequest(baseInput);

    expect(request.path).toBe("/api/openrouter/chat/completions");
    const body = request.body as any;
    expect(body.model).toBe("qwen/qwen3.5-9b");
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: baseInput.styleReferenceImage }
    });
    expect(body.messages[1].content[1].text).toContain("8 条");
    expect(body.messages[1].content[1].text).toContain("风格参考图");
    expect(body.messages[1].content[1].text).toContain("不要推断产品外观");
  });

  it("requires a style reference image", () => {
    expect(() => buildProductPromptRequest({ ...baseInput, styleReferenceImage: "" }))
      .toThrow("请先上传风格参考图");
  });
});
