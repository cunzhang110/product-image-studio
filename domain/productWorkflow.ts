import type { AspectRatio, ImageSize, ServiceProvider } from "../types";

export const OPENROUTER_PROMPT_MODEL = "qwen/qwen3.5-9b";
export type PromptProvider = "openrouter";
export type BatchStage = "setup" | "review" | "results";
export type PromptStatus = "ready" | "generating" | "failed";
export type ImageJobStatus = "idle" | "queued" | "generating" | "completed" | "failed" | "stopped";
export type WorkflowMode = "manual" | "automatic";
export type PromptStrategy = "varied-scenes" | "anchored-angles";
export type BatchRunPhase = "idle" | "generating-prompts" | "generating-anchor" | "awaiting-anchor-approval" | "generating-images" | "completed" | "failed" | "stopped";
export type BatchNameSource = "automatic" | "manual";
export type ImageGenerationRole = "standard" | "anchor" | "derived";
export type BatchStatusTone = "gray" | "purple" | "blue" | "orange" | "green" | "red";

export interface BatchDisplayStatus {
  tone: BatchStatusTone;
  label: string;
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

export const createProductBatch = (name = "未命名产品"): ProductBatch => {
  const now = Date.now();
  return {
    id: createId(),
    name: name.trim() || "未命名产品",
    nameSource: "automatic",
    productReferenceImage: "",
    styleReferenceImage: "",
    promptTemplate: "",
    creativeGuide: "",
    requestedPromptCount: 12,
    promptProvider: "openrouter",
    promptModel: OPENROUTER_PROMPT_MODEL,
    imageProvider: "yunwu",
    imageModel: "gemini-3.1-flash-image-preview",
    aspectRatio: "3:4",
    imageSize: "2K",
    concurrency: 1,
    workflowMode: "manual",
    promptStrategy: "varied-scenes",
    runPhase: "idle",
    sceneBible: "",
    stage: "setup",
    prompts: [],
    images: [],
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

export const getBatchDisplayStatus = (batch: ProductBatch): BatchDisplayStatus => {
  if (batch.runPhase === "stopped") return { tone: "orange", label: "已停止" };
  if (batch.runPhase === "generating-prompts") return { tone: "purple", label: "生成提示词" };
  if (batch.runPhase === "generating-anchor") return { tone: "blue", label: "生成主场景" };
  if (batch.runPhase === "awaiting-anchor-approval") return { tone: "orange", label: "待确认主场景" };
  const total = batch.images.length;
  const completed = batch.images.filter(image => image.status === "completed").length;
  const failed = batch.images.filter(image => image.status === "failed").length;
  const hasActiveImages = batch.images.some(image => ["queued", "generating"].includes(image.status));
  if (batch.runPhase === "generating-images" || hasActiveImages) return { tone: "blue", label: `生图中 ${completed}/${total}` };
  if (total > 0 && completed === total) return { tone: "green", label: "已完成" };
  if (completed > 0 && failed > 0) return { tone: "orange", label: "部分完成" };
  if (batch.runPhase === "failed" || (total > 0 && failed === total)) return { tone: "red", label: "失败" };
  return { tone: "gray", label: "待生成" };
};
