import { createImageJobs, promptsToVariants, type ImageGeneration, type ProductBatch } from "../domain/productWorkflow";
import type { ProductPromptPlan } from "./productPromptService";

export interface ProductBatchWorkflowDependencies {
  generatePromptPlan: (batch: ProductBatch) => Promise<ProductPromptPlan>;
  runJobs: (
    batch: ProductBatch,
    jobs: ImageGeneration[],
    onJobs: (jobs: ImageGeneration[]) => void
  ) => Promise<ImageGeneration[]>;
}

type BatchUpdate = (batch: ProductBatch) => void;

const emit = (batch: ProductBatch, onUpdate: BatchUpdate) => {
  const next = { ...batch, updatedAt: Date.now() };
  onUpdate(next);
  return next;
};

const preparePrompts = (batch: ProductBatch, plan: ProductPromptPlan) => {
  const texts = plan.strategy === "anchored-angles"
    ? [plan.anchorPrompt, ...plan.anglePrompts]
    : plan.prompts;
  return {
    ...batch,
    sceneBible: plan.strategy === "anchored-angles" ? plan.sceneBible : "",
    prompts: promptsToVariants(texts.slice(0, batch.requestedPromptCount))
  };
};

const jobsForAnchoredBatch = (batch: ProductBatch) => createImageJobs(batch).map((job, index) => ({
  ...job,
  role: index === 0 ? "anchor" as const : "derived" as const
}));

const finishFromJobs = (batch: ProductBatch, images: ImageGeneration[], onUpdate: BatchUpdate) => emit({
  ...batch,
  images,
  runPhase: images.some(image => image.status === "completed") ? "completed" : "failed",
  runError: images.some(image => image.status === "completed") ? undefined : images[0]?.error || "生图失败",
  stage: "results"
}, onUpdate);

const runAnchor = async (
  batch: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate
) => {
  const jobs = jobsForAnchoredBatch(batch);
  let running = emit({ ...batch, images: [jobs[0]], runPhase: "generating-anchor", stage: "results" }, onUpdate);
  const [anchor] = await dependencies.runJobs(running, [jobs[0]], images => {
    running = emit({ ...running, images }, onUpdate);
  });
  return { batch: { ...running, images: [anchor], anchorImageId: anchor.id }, anchor, derived: jobs.slice(1) };
};

export const runAutomaticProductBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate
): Promise<ProductBatch> => {
  if (!input.styleReferenceImage || !input.productReferenceImage) {
    throw new Error("自动模式需要同时上传风格参考图和产品参考图。");
  }
  let batch = emit({ ...input, runPhase: "generating-prompts", runError: undefined }, onUpdate);
  try {
    const plan = await dependencies.generatePromptPlan(batch);
    batch = emit(preparePrompts(batch, plan), onUpdate);
    if (plan.strategy === "varied-scenes") {
      const jobs = createImageJobs(batch);
      batch = emit({ ...batch, images: jobs, runPhase: "generating-images", stage: "results" }, onUpdate);
      const completed = await dependencies.runJobs(batch, jobs, images => {
        batch = emit({ ...batch, images }, onUpdate);
      });
      return finishFromJobs(batch, completed, onUpdate);
    }

    const anchorRun = await runAnchor(batch, dependencies, onUpdate);
    batch = anchorRun.batch;
    if (anchorRun.anchor.status !== "completed" || !anchorRun.anchor.resultUrl) {
      return emit({ ...batch, runPhase: "failed", runError: anchorRun.anchor.error || "主场景生成失败" }, onUpdate);
    }
    const derived = anchorRun.derived.map(job => ({ ...job, anchorReferenceImageSnapshot: anchorRun.anchor.resultUrl }));
    batch = emit({ ...batch, images: [anchorRun.anchor, ...derived], runPhase: "generating-images" }, onUpdate);
    const completed = await dependencies.runJobs(batch, derived, images => {
      batch = emit({ ...batch, images: [anchorRun.anchor, ...images] }, onUpdate);
    });
    return finishFromJobs(batch, [anchorRun.anchor, ...completed], onUpdate);
  } catch (error) {
    return emit({ ...batch, runPhase: "failed", runError: error instanceof Error ? error.message : "自动流程失败" }, onUpdate);
  }
};

export const startManualAnchoredBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate
): Promise<ProductBatch> => {
  let batch = emit({ ...input, runPhase: "generating-prompts", runError: undefined }, onUpdate);
  try {
    const plan = await dependencies.generatePromptPlan(batch);
    if (plan.strategy !== "anchored-angles") throw new Error("当前不是同场景多机位方案。");
    batch = emit(preparePrompts(batch, plan), onUpdate);
    const anchorRun = await runAnchor(batch, dependencies, onUpdate);
    if (anchorRun.anchor.status !== "completed") {
      return emit({ ...anchorRun.batch, runPhase: "failed", runError: anchorRun.anchor.error }, onUpdate);
    }
    return emit({ ...anchorRun.batch, runPhase: "awaiting-anchor-approval", stage: "results" }, onUpdate);
  } catch (error) {
    return emit({ ...batch, runPhase: "failed", runError: error instanceof Error ? error.message : "主场景生成失败" }, onUpdate);
  }
};

export const continueManualAnchoredBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate
): Promise<ProductBatch> => {
  const anchor = input.images.find(image => image.role === "anchor" && image.status === "completed" && image.resultUrl);
  if (!anchor?.resultUrl) throw new Error("请先生成并确认主场景图。");
  const allJobs = jobsForAnchoredBatch(input);
  const derived = allJobs.slice(1).map(job => ({ ...job, anchorReferenceImageSnapshot: anchor.resultUrl }));
  let batch = emit({ ...input, images: [anchor, ...derived], runPhase: "generating-images", stage: "results" }, onUpdate);
  const completed = await dependencies.runJobs(batch, derived, images => {
    batch = emit({ ...batch, images: [anchor, ...images] }, onUpdate);
  });
  return finishFromJobs(batch, [anchor, ...completed], onUpdate);
};
