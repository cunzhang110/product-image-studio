import type { AspectRatio, ImageSize, ServiceProvider } from "../types";

export const OPENROUTER_PROMPT_MODEL = "qwen/qwen3.5-9b";
export type PromptProvider = "openrouter";
export type BatchStage = "setup" | "review" | "results";
export type PromptStatus = "ready" | "generating" | "failed";
export type ImageJobStatus = "idle" | "queued" | "generating" | "completed" | "failed" | "stopped";
export type WorkflowMode = "manual" | "automatic";
export type PromptStrategy = "varied-scenes" | "anchored-angles";
export type SameSceneBranchMode = "ai-random" | "custom-map";
export type ExtensionNodeType = "camera" | "action" | "camera-action";
export type BatchRunPhase = "idle" | "generating-prompts" | "generating-anchor" | "awaiting-anchor-approval" | "generating-images" | "completed" | "failed" | "stopped";
export type BatchNameSource = "automatic" | "manual";
export type ImageGenerationRole = "standard" | "anchor" | "derived";
export type BatchStatusTone = "gray" | "purple" | "blue" | "orange" | "green" | "red";

export const DEFAULT_PRODUCT_PROMPT_TEMPLATE = "保留酒瓶产品，并确保酒瓶完整清晰地出现在画面中。酒瓶不能缺失、细节清楚。场景替换为【XXX】。使用 iPhone 后置镜头拍摄，符合现实世界逻辑，呈现自然、透亮、生活化的日常快照质感，风格简约、松弛、真实。";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif", "bmp"
]);

export const isSupportedImageFile = (
  file: { name?: string; type?: string } | null | undefined
) => {
  if (!file) return false;
  const type = file.type?.trim().toLowerCase() || "";
  if (type) return type.startsWith("image/");
  const extension = file.name?.trim().match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return Boolean(extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension));
};

export interface BatchDisplayStatus {
  tone: BatchStatusTone;
  label: string;
}

export interface SceneExtensionNode {
  id: string;
  type: ExtensionNodeType;
  instruction: string;
}

export interface PromptVariant {
  id: string;
  prompt: string;
  selected: boolean;
  status: PromptStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImageGeneration {
  id: string;
  batchId: string;
  promptVariantId: string;
  promptSnapshot: string;
  productReferenceImageSnapshot: string;
  styleReferenceImageSnapshot: string;
  anchorReferenceImageSnapshot?: string;
  role: ImageGenerationRole;
  referenceImageSnapshot?: string;
  provider: ServiceProvider;
  model: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  status: ImageJobStatus;
  resultUrl?: string;
  error?: string;
  createdAt: number;
}

export interface ProductBatch {
  id: string;
  name: string;
  nameSource: BatchNameSource;
  productReferenceImage: string;
  styleReferenceImage: string;
  referenceImage?: string;
  promptTemplate: string;
  creativeGuide: string;
  requestedPromptCount: number;
  promptProvider: PromptProvider;
  promptModel: string;
  imageProvider: ServiceProvider;
  imageModel: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  concurrency: number;
  workflowMode: WorkflowMode;
  promptStrategy: PromptStrategy;
  sameSceneBranchMode: SameSceneBranchMode;
  extensionNodes: SceneExtensionNode[];
  runPhase: BatchRunPhase;
  runError?: string;
  sceneBible: string;
  anchorImageId?: string;
  stage: BatchStage;
  prompts: PromptVariant[];
  images: ImageGeneration[];
  createdAt: number;
  updatedAt: number;
}

const createId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createProductBatch = (
  name = "未命名产品",
  promptTemplate = DEFAULT_PRODUCT_PROMPT_TEMPLATE
): ProductBatch => {
  const now = Date.now();
  return {
    id: createId(),
    name: name.trim() || "未命名产品",
    nameSource: "automatic",
    productReferenceImage: "",
    styleReferenceImage: "",
    promptTemplate,
    creativeGuide: "",
    requestedPromptCount: 12,
    promptProvider: "openrouter",
    promptModel: OPENROUTER_PROMPT_MODEL,
    imageProvider: "muzhi",
    imageModel: "gpt-image-2",
    aspectRatio: "3:4",
    imageSize: "2K",
    concurrency: 1,
    workflowMode: "manual",
    promptStrategy: "varied-scenes",
    sameSceneBranchMode: "ai-random",
    extensionNodes: [],
    runPhase: "idle",
    sceneBible: "",
    stage: "setup",
    prompts: [],
    images: [],
    createdAt: now,
    updatedAt: now
  };
};

const getDuplicateBatchName = (sourceName: string, existingNames: Iterable<string>) => {
  const occupied = new Set(Array.from(existingNames, name => name.trim()));
  const baseName = `${sourceName.trim() || "未命名产品"} - 副本`;
  if (!occupied.has(baseName)) return baseName;
  let index = 2;
  while (occupied.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
};

export const duplicateProductBatch = (
  source: ProductBatch,
  existingNames: Iterable<string>
): ProductBatch => {
  const now = Date.now();
  return {
    ...source,
    id: createId(),
    name: getDuplicateBatchName(source.name, existingNames),
    nameSource: "automatic",
    creativeGuide: "",
    extensionNodes: source.extensionNodes.map(node => ({ ...node, id: createId() })),
    prompts: [],
    images: [],
    runPhase: "idle",
    runError: undefined,
    sceneBible: "",
    anchorImageId: undefined,
    stage: "setup",
    createdAt: now,
    updatedAt: now
  };
};

export const normalizeProductBatch = (batch: ProductBatch): ProductBatch => {
  const productReferenceImage = batch.productReferenceImage || batch.referenceImage || "";
  const styleReferenceImage = batch.styleReferenceImage || "";
  return {
    ...batch,
    nameSource: batch.nameSource || "manual",
    workflowMode: batch.workflowMode || "manual",
    promptStrategy: batch.promptStrategy || "varied-scenes",
    sameSceneBranchMode: batch.sameSceneBranchMode || "ai-random",
    extensionNodes: Array.isArray(batch.extensionNodes)
      ? batch.extensionNodes.map(node => ({
        id: node.id || createId(),
        type: node.type || "camera",
        instruction: String(node.instruction || "")
      }))
      : [],
    runPhase: batch.runPhase || "idle",
    sceneBible: batch.sceneBible || "",
    productReferenceImage,
    styleReferenceImage,
    promptProvider: "openrouter",
    promptModel: OPENROUTER_PROMPT_MODEL,
    images: (batch.images || []).map(image => ({
      ...image,
      productReferenceImageSnapshot: image.productReferenceImageSnapshot || image.referenceImageSnapshot || productReferenceImage,
      styleReferenceImageSnapshot: image.styleReferenceImageSnapshot || styleReferenceImage,
      role: image.role || "standard"
    }))
  };
};

const normalizePromptList = (items: unknown[]) => {
  const seen = new Set<string>();
  return items
    .map(item => String(item ?? "").trim())
    .filter(item => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

export const parsePromptList = (raw: string): string[] => {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return normalizePromptList(parsed);
    if (Array.isArray(parsed?.prompts)) return normalizePromptList(parsed.prompts);
  } catch {
    // Some compatible text endpoints return plain lines despite the JSON instruction.
  }
  return normalizePromptList(normalized.split(/\r?\n/).map(line => line.replace(/^\s*(?:\d+[.)、]|[-*])\s*/, "")));
};

export const promptsToVariants = (prompts: string[]): PromptVariant[] => {
  const now = Date.now();
  return prompts.map(prompt => ({
    id: createId(),
    prompt,
    selected: true,
    status: "ready",
    createdAt: now,
    updatedAt: now
  }));
};

export const createImageJobs = (batch: ProductBatch): ImageGeneration[] => {
  const now = Date.now();
  return batch.prompts
    .filter(prompt => prompt.selected && prompt.prompt.trim())
    .map(prompt => ({
      id: createId(),
      batchId: batch.id,
      promptVariantId: prompt.id,
      promptSnapshot: prompt.prompt.trim(),
      productReferenceImageSnapshot: batch.productReferenceImage,
      styleReferenceImageSnapshot: batch.styleReferenceImage,
      role: "standard",
      provider: batch.imageProvider,
      model: batch.imageModel,
      aspectRatio: batch.aspectRatio,
      imageSize: batch.imageSize,
      status: "idle",
      createdAt: now
    }));
};

export const applyProductReferenceFilename = (batch: ProductBatch, filename: string): ProductBatch => {
  if (batch.nameSource === "manual") return batch;
  const name = filename.trim().replace(/\.[^.]+$/, "").trim();
  return name ? { ...batch, name, nameSource: "automatic" } : batch;
};

const DEFAULT_WINE_EXTENSION_NODES: Array<Omit<SceneExtensionNode, "id">> = [
  { type: "camera", instruction: "左侧 45 度酒瓶近景，保持瓶身标签正面清晰可见" },
  { type: "camera", instruction: "顶部俯拍场景全景，完整展示桌面布置与酒瓶位置" },
  { type: "camera", instruction: "低机位瓶身与标签细节特写，背景轻微虚化" },
  { type: "action", instruction: "人物手持酒瓶，瓶身标签正对镜头" },
  { type: "camera-action", instruction: "打开酒瓶并向酒杯倒酒，保持原场景与产品外观一致" }
];

export const createDefaultWineExtensionNodes = (): SceneExtensionNode[] => (
  DEFAULT_WINE_EXTENSION_NODES.map(node => ({ ...node, id: createId() }))
);

export const getPlannedImageCount = (batch: ProductBatch) => (
  batch.promptStrategy === "anchored-angles" && batch.sameSceneBranchMode === "custom-map"
    ? 1 + batch.extensionNodes.length
    : batch.requestedPromptCount
);

const CUSTOM_BRANCH_RULES: Record<ExtensionNodeType, string> = {
  camera: "只允许改变摄影机方向、高度、距离、焦段、景别、构图和景深；产品状态和摆放位置保持不变。",
  action: "允许产品位置、人物手势和使用状态按指令变化；镜头风格保持不变。",
  "camera-action": "允许机位和产品动作按指令同时变化。"
};

export const buildCustomBranchPrompt = (sceneBible: string, node: SceneExtensionNode) => [
  "严格参考主场景图，保持同一空间、背景、桌面、道具、光线方向、色彩影调和整体画面调性。",
  `场景固定字段：${sceneBible.trim() || "完全沿用主场景图"}。`,
  CUSTOM_BRANCH_RULES[node.type],
  `本次延伸指令：${node.instruction.trim()}。`,
  "产品参考图是唯一产品视觉依据，必须保持产品颜色、透明度、材质、瓶型、瓶盖、包装、标签、Logo、文字、比例和结构一致，不得替换或重新设计产品。"
].join("\n");

export const buildCustomAnchoredPrompts = (
  batch: ProductBatch,
  anchorPrompt: string,
  sceneBible: string
) => [
  anchorPrompt.trim(),
  ...batch.extensionNodes.map(node => buildCustomBranchPrompt(sceneBible, node))
];

export const getImageRunPhase = (images: ImageGeneration[]): BatchRunPhase => {
  if (images.some(image => image.status === "stopped")) return "stopped";
  if (images.some(image => image.status === "completed")) return "completed";
  return "failed";
};

export const getBatchDisplayStatus = (batch: ProductBatch): BatchDisplayStatus => {
  if (batch.runPhase === "stopped") return { tone: "orange", label: "已停止" };
  if (batch.runPhase === "generating-prompts") return { tone: "purple", label: "生成提示词" };
  if (batch.runPhase === "generating-anchor") return { tone: "blue", label: "生成主场景" };
  if (batch.runPhase === "awaiting-anchor-approval") return { tone: "orange", label: "待确认主场景" };
  const total = batch.images.length;
  const queued = batch.images.filter(image => image.status === "queued").length;
  const generating = batch.images.filter(image => image.status === "generating").length;
  const completed = batch.images.filter(image => image.status === "completed").length;
  const failed = batch.images.filter(image => image.status === "failed").length;
  const stopped = batch.images.filter(image => image.status === "stopped").length;
  if (queued > 0 && generating === 0) return { tone: "blue", label: "排队中" };
  if (generating > 0) return { tone: "blue", label: `生图中 ${completed}/${total}` };
  if (total > 0 && completed === total) return { tone: "green", label: "已完成" };
  if (completed > 0 && (failed > 0 || stopped > 0)) return { tone: "orange", label: "部分完成" };
  if (total > 0 && completed === 0 && failed === total) return { tone: "red", label: "失败" };
  return { tone: "gray", label: "待生成" };
};
