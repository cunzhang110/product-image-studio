import { buildCustomAnchoredPrompts, createImageJobs, promptsToVariants, type ImageGeneration, type ProductBatch } from "../domain/productWorkflow";
import type { ProductPromptPlan } from "./productPromptService";
import { isGenerationAbort } from "./productImageQueue";

export interface ProductBatchWorkflowDependencies {
  generatePromptPlan: (batch: ProductBatch, signal?: AbortSignal) => Promise<ProductPromptPlan>;
  runJobs: (
    batch: ProductBatch,
    jobs: ImageGeneration[],
    onJobs: (jobs: ImageGeneration[]) => void,
    signal?: AbortSignal
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
    ? batch.sameSceneBranchMode === "custom-map"
      ? buildCustomAnchoredPrompts(batch, plan.anchorPrompt, plan.sceneBible)
      : [plan.anchorPrompt, ...plan.anglePrompts]
    : plan.prompts;
  return {
    ...batch,
    sceneBible: plan.strategy === "anchored-angles" ? plan.sceneBible : "",
    prompts: promptsToVariants(plan.strategy === "anchored-angles" && batch.sameSceneBranchMode === "custom-map"
      ? texts
      : texts.slice(0, batch.requestedPromptCount))
  };
};

const jobsForAnchoredBatch = (batch: ProductBatch) => createImageJobs(batch).map((job, index) => ({
  ...job,
  role: index === 0 ? "anchor" as const : "derived" as const
}));

const finishFromJobs = (batch: ProductBatch, images: ImageGeneration[], onUpdate: BatchUpdate) => emit({
  ...batch,
  images,
  runPhase: images.some(image => image.status === "stopped")
    ? "stopped"
    : images.some(image => image.status === "completed") ? "completed" : "failed",
  runError: images.some(image => image.status === "stopped" || image.status === "completed")
    ? undefined
    : images[0]?.error || "生图失败",
  stage: "results"
}, onUpdate);

const stoppedBatch = (batch: ProductBatch, onUpdate: BatchUpdate) => emit({
  ...batch,
  runPhase: "stopped",
  runError: undefined,
  images: batch.images.map(image => ["queued", "generating"].includes(image.status)
    ? { ...image, status: "stopped" as const, error: undefined }
    : image)
}, onUpdate);

const mergeJobs = (base: ImageGeneration[], updates: ImageGeneration[]) => {
  const byId = new Map(updates.map(job => [job.id, job]));
  return base.map(job => byId.get(job.id) || job);
};

const runAnchor = async (
  batch: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate,
  signal?: AbortSignal
) => {
  const jobs = jobsForAnchoredBatch(batch);
  let running = emit({ ...batch, images: [jobs[0]], runPhase: "generating-anchor", stage: "results" }, onUpdate);
  const [anchor] = await dependencies.runJobs(running, [jobs[0]], images => {
    running = emit({ ...running, images }, onUpdate);
  }, signal);
  return { batch: { ...running, images: [anchor], anchorImageId: anchor.id }, anchor, derived: jobs.slice(1) };
};

export const runAutomaticProductBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate,
  signal?: AbortSignal
): Promise<ProductBatch> => {
  if (!input.styleReferenceImage || !input.productReferenceImage) {
    throw new Error("自动模式需要同时上传风格参考图和产品参考图。");
  }
  let batch = emit({ ...input, runPhase: "generating-prompts", runError: undefined }, onUpdate);
  try {
    const plan = await dependencies.generatePromptPlan(batch, signal);
    if (signal?.aborted) return stoppedBatch(batch, onUpdate);
    batch = emit(preparePrompts(batch, plan), onUpdate);
    if (plan.strategy === "varied-scenes") {
      const jobs = createImageJobs(batch);
      batch = emit({ ...batch, images: jobs, runPhase: "generating-images", stage: "results" }, onUpdate);
      const completed = await dependencies.runJobs(batch, jobs, images => {
        batch = emit({ ...batch, images }, onUpdate);
      }, signal);
      return finishFromJobs(batch, completed, onUpdate);
    }

    const anchorRun = await runAnchor(batch, dependencies, onUpdate, signal);
    batch = anchorRun.batch;
    if (signal?.aborted || anchorRun.anchor.status === "stopped") {
      return stoppedBatch(batch, onUpdate);
    }
    if (anchorRun.anchor.status !== "completed" || !anchorRun.anchor.resultUrl) {
      return emit({ ...batch, runPhase: "failed", runError: anchorRun.anchor.error || "主场景生成失败" }, onUpdate);
    }
    const derived = anchorRun.derived.map(job => ({ ...job, anchorReferenceImageSnapshot: anchorRun.anchor.resultUrl }));
    batch = emit({ ...batch, images: [anchorRun.anchor, ...derived], runPhase: "generating-images" }, onUpdate);
    const completed = await dependencies.runJobs(batch, derived, images => {
      batch = emit({ ...batch, images: [anchorRun.anchor, ...images] }, onUpdate);
    }, signal);
    return finishFromJobs(batch, [anchorRun.anchor, ...completed], onUpdate);
  } catch (error) {
    if (signal?.aborted || isGenerationAbort(error)) return stoppedBatch(batch, onUpdate);
    return emit({ ...batch, runPhase: "failed", runError: error instanceof Error ? error.message : "自动流程失败" }, onUpdate);
  }
};

export const startManualAnchoredBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate,
  signal?: AbortSignal
): Promise<ProductBatch> => {
  let batch = emit({ ...input, runPhase: "generating-prompts", runError: undefined }, onUpdate);
  try {
    const plan = await dependencies.generatePromptPlan(batch, signal);
    if (signal?.aborted) return stoppedBatch(batch, onUpdate);
    if (plan.strategy !== "anchored-angles") throw new Error("当前不是同场景多机位方案。");
    batch = emit(preparePrompts(batch, plan), onUpdate);
    const anchorRun = await runAnchor(batch, dependencies, onUpdate, signal);
    if (signal?.aborted || anchorRun.anchor.status === "stopped") {
      return stoppedBatch(anchorRun.batch, onUpdate);
    }
    if (anchorRun.anchor.status !== "completed") {
      return emit({ ...anchorRun.batch, runPhase: "failed", runError: anchorRun.anchor.error }, onUpdate);
    }
    return emit({ ...anchorRun.batch, runPhase: "awaiting-anchor-approval", stage: "results" }, onUpdate);
  } catch (error) {
    if (signal?.aborted || isGenerationAbort(error)) return stoppedBatch(batch, onUpdate);
    return emit({ ...batch, runPhase: "failed", runError: error instanceof Error ? error.message : "主场景生成失败" }, onUpdate);
  }
};

export const continueManualAnchoredBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate,
  signal?: AbortSignal
): Promise<ProductBatch> => {
  const anchor = input.images.find(image => image.role === "anchor" && image.status === "completed" && image.resultUrl);
  if (!anchor?.resultUrl) throw new Error("请先生成并确认主场景图。");
  const refreshedInput = input.sameSceneBranchMode === "custom-map"
    ? {
      ...input,
      prompts: promptsToVariants(buildCustomAnchoredPrompts(
        input,
        input.prompts[0]?.prompt || anchor.promptSnapshot,
        input.sceneBible
      ))
    }
    : input;
  const allJobs = jobsForAnchoredBatch(refreshedInput);
  const derived = allJobs.slice(1).map(job => ({ ...job, anchorReferenceImageSnapshot: anchor.resultUrl }));
  let batch = emit({ ...refreshedInput, images: [anchor, ...derived], runPhase: "generating-images", stage: "results" }, onUpdate);
  const completed = await dependencies.runJobs(batch, derived, images => {
    batch = emit({ ...batch, images: [anchor, ...images] }, onUpdate);
  }, signal);
  return finishFromJobs(batch, [anchor, ...completed], onUpdate);
};

export const resumeProductBatch = async (
  input: ProductBatch,
  dependencies: ProductBatchWorkflowDependencies,
  onUpdate: BatchUpdate,
  signal?: AbortSignal
): Promise<ProductBatch> => {
  if (!input.prompts.length) {
    if (input.workflowMode === "automatic") {
      return runAutomaticProductBatch(input, dependencies, onUpdate, signal);
    }
    if (input.promptStrategy === "anchored-angles") {
      return startManualAnchoredBatch(input, dependencies, onUpdate, signal);
    }
    let batch = emit({ ...input, runPhase: "generating-prompts", runError: undefined }, onUpdate);
    try {
      const plan = await dependencies.generatePromptPlan(batch, signal);
      if (signal?.aborted) return stoppedBatch(batch, onUpdate);
      batch = preparePrompts(batch, plan);
      return emit({ ...batch, stage: "review", runPhase: "idle" }, onUpdate);
    } catch (error) {
      if (signal?.aborted || isGenerationAbort(error)) return stoppedBatch(batch, onUpdate);
      return emit({ ...batch, runPhase: "failed", runError: error instanceof Error ? error.message : "提示词生成失败" }, onUpdate);
    }
  }

  if (input.promptStrategy === "anchored-angles") {
    const existingAnchor = input.images.find(image => image.role === "anchor" && image.status === "completed" && image.resultUrl);
    if (!existingAnchor) {
      const anchorRun = await runAnchor(input, dependencies, onUpdate, signal);
      if (anchorRun.anchor.status === "stopped" || signal?.aborted) return stoppedBatch(anchorRun.batch, onUpdate);
      if (anchorRun.anchor.status !== "completed" || !anchorRun.anchor.resultUrl) {
        return emit({ ...anchorRun.batch, runPhase: "failed", runError: anchorRun.anchor.error || "主场景生成失败" }, onUpdate);
      }
      if (input.workflowMode === "manual") {
        return emit({ ...anchorRun.batch, runPhase: "awaiting-anchor-approval", stage: "results" }, onUpdate);
      }
      return resumeProductBatch({
        ...input,
        images: [anchorRun.anchor, ...anchorRun.derived],
        anchorImageId: anchorRun.anchor.id
      }, dependencies, onUpdate, signal);
    }

    const generatedDerived = jobsForAnchoredBatch(input).slice(1);
    const existingDerived = input.images.filter(image => image.role === "derived");
    const derived = (existingDerived.length ? existingDerived : generatedDerived)
      .map(job => ({ ...job, anchorReferenceImageSnapshot: existingAnchor.resultUrl }));
    const remaining = derived.filter(job => job.status !== "completed");
    const allJobs = [existingAnchor, ...derived];
    if (!remaining.length) return finishFromJobs(input, allJobs, onUpdate);

    let batch = emit({ ...input, images: allJobs, runPhase: "generating-images", stage: "results" }, onUpdate);
    const completed = await dependencies.runJobs(batch, remaining, images => {
      batch = emit({ ...batch, images: [existingAnchor, ...mergeJobs(derived, images)] }, onUpdate);
    }, signal);
    return finishFromJobs(batch, [existingAnchor, ...mergeJobs(derived, completed)], onUpdate);
  }

  const allJobs = input.images.length ? input.images : createImageJobs(input);
  const remaining = allJobs.filter(job => job.status !== "completed");
  if (!remaining.length) return finishFromJobs(input, allJobs, onUpdate);
  let batch = emit({ ...input, images: allJobs, runPhase: "generating-images", stage: "results" }, onUpdate);
  const completed = await dependencies.runJobs(batch, remaining, images => {
    batch = emit({ ...batch, images: mergeJobs(allJobs, images) }, onUpdate);
  }, signal);
  return finishFromJobs(batch, mergeJobs(allJobs, completed), onUpdate);
};
