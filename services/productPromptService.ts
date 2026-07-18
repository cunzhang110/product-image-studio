import { OPENROUTER_PROMPT_MODEL, parsePromptList, type PromptStrategy } from "../domain/productWorkflow";

export interface ProductPromptInput {
  productName: string;
  styleReferenceImage: string;
  promptTemplate: string;
  creativeGuide: string;
  count: number;
  strategy?: PromptStrategy;
}

export interface AnchoredScenePlan {
  sceneBible: string;
  anchorPrompt: string;
  anglePrompts: string[];
}

export type ProductPromptPlan =
  | { strategy: "varied-scenes"; prompts: string[] }
  | ({ strategy: "anchored-angles" } & AnchoredScenePlan);

type PromptRequest = {
  path: string;
  body: Record<string, unknown>;
};

const buildVariedPromptInstruction = (input: ProductPromptInput) => [
  `请参考风格参考图，为“${input.productName || "产品"}”生成 ${input.count} 条可直接用于图片生成的中文提示词。`,
  "分析风格参考图的构图、光线、色彩、场景、镜头语言和整体调性，并将这些视觉特征转化为提示词。",
  "风格参考图不是产品参考图，不要推断产品外观，也不要描述图中原有物品的品牌、Logo、包装和文字。",
  "真正的产品参考图会在生图阶段另行提供；每条提示词都应要求以产品参考图中的产品为清晰主角，并保持其外观完全一致。",
  `提示词模板：${input.promptTemplate.trim() || "保持产品参考图中的产品真实、清晰、可识别"}`,
  `创作引导：${input.creativeGuide.trim() || "在不同真实商业场景中变化画面"}`,
  "只返回 JSON 字符串数组，不要编号，不要解释，不要 Markdown。"
].join("\n");

const buildAnchoredPromptInstruction = (input: ProductPromptInput) => [
  `请参考风格参考图，为“${input.productName || "产品"}”设计同一环境下的一组商业摄影方案。`,
  `输出 1 张主场景和 ${Math.max(0, input.count - 1)} 个不同机位，最终共 ${input.count} 张。`,
  "先建立不可变化的环境固定字段：空间结构、背景、桌面材质、道具及位置、光线方向、色彩影调、产品摆放区域与尺度。",
  "主场景提示词完整描述环境；不同机位只能改变镜头方向、高度、距离、焦段、景别和构图，不得改动固定环境。",
  "产品外观由生图阶段的产品参考图约束，不要复制风格图中原有商品、品牌、Logo 或文字。",
  `提示词模板：${input.promptTemplate.trim() || "保持产品参考图中的产品真实、清晰、可识别"}`,
  `创作引导：${input.creativeGuide.trim() || "真实商业摄影，环境与道具保持一致"}`,
  "只返回 JSON 对象，格式为 {\"sceneBible\":\"环境固定字段\",\"anchorPrompt\":\"主场景提示词\",\"anglePrompts\":[\"机位提示词\"]}，不要解释或 Markdown。"
].join("\n");

export const buildProductPromptRequest = (input: ProductPromptInput): PromptRequest => {
  if (!input.styleReferenceImage) throw new Error("请先上传风格参考图。");
  const anchored = input.strategy === "anchored-angles";
  return {
    path: "/api/openrouter/chat/completions",
    body: {
      model: OPENROUTER_PROMPT_MODEL,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: anchored
            ? "你是商业产品摄影导演。创建严格固定的场景设定，并设计同一环境下的不同摄影机位，只输出指定 JSON。"
            : "你是商业产品摄影提示词策划师。只从风格参考图提取视觉风格，不把图中原有物品当成最终产品，只输出 JSON 字符串数组。"
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: input.styleReferenceImage } },
            { type: "text", text: anchored ? buildAnchoredPromptInstruction(input) : buildVariedPromptInstruction(input) }
          ]
        }
      ]
    }
  };
};

const stripFence = (raw: string) => raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export const parseAnchoredScenePlan = (raw: string, count: number): AnchoredScenePlan => {
  let parsed: any;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("提示词 AI 返回的同场景方案格式不正确，请重试。");
  }
  const sceneBible = String(parsed?.sceneBible || "").trim();
  const anchorPrompt = String(parsed?.anchorPrompt || "").trim();
  const anglePrompts = Array.isArray(parsed?.anglePrompts)
    ? parsed.anglePrompts.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : [];
  const expectedAngles = Math.max(0, count - 1);
  if (!sceneBible || !anchorPrompt || anglePrompts.length < expectedAngles) {
    throw new Error(`同场景方案不完整，需要 1 张主场景和 ${expectedAngles} 个不同机位，请重试。`);
  }
  return { sceneBible, anchorPrompt, anglePrompts: anglePrompts.slice(0, expectedAngles) };
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

export const generateProductPromptPlan = async (input: ProductPromptInput): Promise<ProductPromptPlan> => {
  if (input.strategy !== "anchored-angles") {
    return { strategy: "varied-scenes", prompts: await generateProductPrompts(input) };
  }
  const request = buildProductPromptRequest(input);
  const response = await fetch(request.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `提示词服务请求失败 (${response.status})`);
  return { strategy: "anchored-angles", ...parseAnchoredScenePlan(extractResponseText(data), input.count) };
};
