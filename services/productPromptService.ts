import type { PromptProvider } from "../domain/productWorkflow";
import { parsePromptList } from "../domain/productWorkflow";
import type { ServiceProvider } from "../types";
import { requestProviderJson } from "./geminiService";

export interface ProductPromptInput {
  provider: PromptProvider;
  model: string;
  productName: string;
  referenceImage: string;
  promptTemplate: string;
  creativeGuide: string;
  count: number;
}

type PromptRequest = {
  provider: ServiceProvider;
  path: string;
  body: Record<string, unknown>;
};

const splitDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("产品参考图格式无效，请重新上传。");
  return { mimeType: match[1], data: match[2] };
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
  if ((input.provider as ServiceProvider) === "muzhi") {
    throw new Error("Muzhi 暂不用于生成提示词，请选择云雾或 APIMart。");
  }
  if (!input.referenceImage) throw new Error("请先上传产品参考图。");
  const instruction = buildPromptInstruction(input);

  if (input.provider === "apimart") {
    return {
      provider: "apimart",
      path: "/api/v1/chat/completions",
      body: {
        model: input.model,
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
              { type: "text", text: instruction }
            ]
          }
        ]
      }
    };
  }

  const image = splitDataUrl(input.referenceImage);
  return {
    provider: "yunwu",
    path: `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    body: {
      systemInstruction: {
        parts: [{ text: "你是商业产品摄影提示词策划师。严格保持参考产品一致，只输出 JSON 字符串数组。" }]
      },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: image.mimeType, data: image.data } },
          { text: instruction }
        ]
      }],
      generationConfig: { temperature: 0.8, responseMimeType: "application/json" }
    }
  };
};

const extractResponseText = (provider: PromptProvider, response: any) => {
  if (provider === "apimart") {
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(item => item?.text || "").join("\n");
    return "";
  }
  return (response?.candidates?.[0]?.content?.parts || []).map((part: any) => part?.text || "").join("\n");
};

export const generateProductPrompts = async (input: ProductPromptInput): Promise<string[]> => {
  const request = buildProductPromptRequest(input);
  const response = await requestProviderJson<any>(request.provider, request.path, {
    method: "POST",
    body: JSON.stringify(request.body)
  });
  const prompts = parsePromptList(extractResponseText(input.provider, response));
  if (!prompts.length) throw new Error("提示词 AI 没有返回可用内容，请重试。");
  return prompts.slice(0, Math.max(1, input.count));
};
