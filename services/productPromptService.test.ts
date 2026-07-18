import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProductPromptRequest, generateProductPrompts, parseAnchoredScenePlan } from "./productPromptService";

const baseInput = {
  productName: "青柠气泡水",
  styleReferenceImage: "data:image/png;base64,YWJj",
  promptTemplate: "保持绿色瓶身与白色标签",
  creativeGuide: "自然光生活场景，变化构图与镜头",
  count: 8
};

describe("product prompt request", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("requests one master scene and count minus one camera variants", () => {
    const request = buildProductPromptRequest({ ...baseInput, count: 6, strategy: "anchored-angles" });
    const text = JSON.stringify(request.body);
    expect(text).toContain("1 张主场景");
    expect(text).toContain("5 个不同机位");
    expect(text).toContain("sceneBible");
  });

  it("parses a complete anchored scene plan", () => {
    const plan = parseAnchoredScenePlan(JSON.stringify({
      sceneBible: "白色桌布、香槟塔、右侧暖光",
      anchorPrompt: "正面主场景",
      anglePrompts: ["左前方 45 度", "低机位近景"]
    }), 3);
    expect(plan.anglePrompts).toHaveLength(2);
    expect(plan.anchorPrompt).toBe("正面主场景");
  });

  it("accepts a master-only anchored plan for custom branches", () => {
    const request = buildProductPromptRequest({ ...baseInput, count: 1, strategy: "anchored-angles" });
    const text = JSON.stringify(request.body);
    expect(text).toContain("1 张主场景");
    expect(text).toContain("0 个不同机位");
    expect(parseAnchoredScenePlan(JSON.stringify({
      sceneBible: "固定婚宴桌面",
      anchorPrompt: "主场景",
      anglePrompts: []
    }), 1)).toEqual({ sceneBible: "固定婚宴桌面", anchorPrompt: "主场景", anglePrompts: [] });
  });

  it("passes the workflow abort signal to the prompt request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '["场景一"]' } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await generateProductPrompts({ ...baseInput, count: 1 }, controller.signal);

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
