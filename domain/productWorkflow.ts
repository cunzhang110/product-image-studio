import type { AspectRatio, ImageSize, ServiceProvider } from "../types";

export const OPENROUTER_PROMPT_MODEL = "qwen/qwen3.5-9b";
export type PromptProvider = "openrouter";
export type BatchStage = "setup" | "review" | "results";
export type PromptStatus = "ready" | "generating" | "failed";
export type ImageJobStatus = "idle" | "queued" | "generating" | "completed" | "failed";

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
    productReferenceImage,
    styleReferenceImage,
    promptProvider: "openrouter",
    promptModel: OPENROUTER_PROMPT_MODEL,
    images: (batch.images || []).map(image => ({
      ...image,
      productReferenceImageSnapshot: image.productReferenceImageSnapshot || image.referenceImageSnapshot || productReferenceImage,
      styleReferenceImageSnapshot: image.styleReferenceImageSnapshot || styleReferenceImage
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
      provider: batch.imageProvider,
      model: batch.imageModel,
      aspectRatio: batch.aspectRatio,
      imageSize: batch.imageSize,
      status: "idle",
      createdAt: now
    }));
};
