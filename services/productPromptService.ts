import { OPENROUTER_PROMPT_MODEL, parsePromptList } from "../domain/productWorkflow";

export interface ProductPromptInput {
  productName: string;
  referenceImage: string;
  promptTemplate: string;
  creativeGuide: string;
  count: number;
}

type PromptRequest = {
  path: string;
  body: Record<string, unknown>;
};

const buildPromptInstruction = (input: ProductPromptInput) => [
  `请围绕参考图中的“${input.productName || "产品"}”生成 ${input.count} 条可直接用于图片生成的中文提示词。`,
  "所有提示词必须保持同一个产品的外形、颜色、包装、标签、Logo 和可见结构一致。",
  "只描述参考图中能够确认的信息，不虚构背面、内部结构或不存在的配件。",
  "每条提示词可以变化场景、构图、镜头、光线、摆放方式和人物互动，但产品始终是清晰主角。",
  `提示词模板：${input.promptTemplate.trim() || "保持产品真实、清晰、可识别"}`,
  `创作引导：${input.creativeGuide.trim() || "在不同真实商业场景中变化画面"}`,
  "只返回 JSON 字符串数组，不要编号，不要解释，不要 Markdown。"
].join("\n");

export const buildProductPromptRequest = (input: ProductPromptInput): PromptRequest => {
  if (!input.referenceImage) throw new Error("请先上传产品参考图。");
  return {
    path: "/api/openrouter/chat/completions",
    body: {
      model: OPENROUTER_PROMPT_MODEL,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: "你是商业产品摄影提示词策划师。严格保持参考产品一致，只输出 JSON 字符串数组。"
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: input.referenceImage } },
            { type: "text", text: buildPromptInstruction(input) }
          ]
        }
      ]
    }
  };
};

const extractResponseText = (response: any) => {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(item => item?.text || "").join("\n");
  return "";
};

export const generateProductPrompts = async (input: ProductPromptInput): Promise<string[]> => {
  const request = buildProductPromptRequest(input);
  const response = await fetch(request.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `提示词服务请求失败 (${response.status})`);
  }
  const prompts = parsePromptList(extractResponseText(data));
  if (!prompts.length) throw new Error("提示词 AI 没有返回可用内容，请重试。");
  return prompts.slice(0, Math.max(1, input.count));
};
