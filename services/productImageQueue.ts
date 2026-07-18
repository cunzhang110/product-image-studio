import type { ImageGeneration } from "../domain/productWorkflow";
import type { ReferenceImageItem } from "../types";
import { optimizeReferenceImageDataUrl } from "../utils/referenceImageOptimization";

export type ImageJobWorker = (job: ImageGeneration) => Promise<string>;
export type ImageQueueUpdate = (jobs: ImageGeneration[]) => void;

export const isGenerationAbort = (error: unknown) => (
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError"
);

export const buildJobReferences = (job: ImageGeneration): ReferenceImageItem[] => [
  { id: "product-reference", name: "产品参考图", imageData: job.productReferenceImageSnapshot },
  ...(job.anchorReferenceImageSnapshot
    ? [{ id: "anchor-reference", name: "主场景图", imageData: job.anchorReferenceImageSnapshot }]
    : [])
];

export const buildJobReferencePrompt = (job: ImageGeneration) => [
  "@{产品参考图} 是唯一产品视觉依据和最高优先级主体约束，必须完全保持产品颜色、透明度、材质、瓶型、瓶盖、包装、Logo、文字、比例和结构一致。",
  job.anchorReferenceImageSnapshot
    ? "@{主场景图} 锁定环境、布景、道具、光线和产品位置，只改变提示词指定的机位。"
    : "",
  job.promptSnapshot
].filter(Boolean).join("");

export const prepareJobReferencesForRequest = async (
  job: ImageGeneration,
  optimize: (dataUrl: string) => Promise<string> = optimizeReferenceImageDataUrl
): Promise<ReferenceImageItem[]> => {
  const references = buildJobReferences(job);
  if (!job.anchorReferenceImageSnapshot) return references;
  const optimizedAnchor = await optimize(job.anchorReferenceImageSnapshot);
  return references
    .map(reference => reference.id === "anchor-reference"
    ? { ...reference, imageData: optimizedAnchor }
    : reference);
};

export const runProductImageJobs = async (
  inputJobs: ImageGeneration[],
  concurrency: number,
  worker: ImageJobWorker,
  onUpdate?: ImageQueueUpdate,
  signal?: AbortSignal
): Promise<ImageGeneration[]> => {
  const jobs: ImageGeneration[] = inputJobs.map(job => job.status === "completed"
    ? { ...job }
    : { ...job, status: "queued", error: undefined });
  const pendingIndexes = jobs.flatMap((job, index) => job.status === "completed" ? [] : [index]);
  const emit = () => onUpdate?.(jobs.map(job => ({ ...job })));
  let cursor = 0;
  emit();

  const runWorker = async () => {
    while (cursor < pendingIndexes.length && !signal?.aborted) {
      const index = pendingIndexes[cursor];
      cursor += 1;
      jobs[index] = { ...jobs[index], status: "generating", error: undefined };
      emit();

      try {
        const resultUrl = await worker(jobs[index]);
        jobs[index] = signal?.aborted
          ? { ...jobs[index], status: "stopped", error: undefined }
          : { ...jobs[index], status: "completed", resultUrl, error: undefined };
      } catch (error) {
        jobs[index] = {
          ...jobs[index],
          status: signal?.aborted || isGenerationAbort(error) ? "stopped" : "failed",
          error: signal?.aborted || isGenerationAbort(error) ? undefined : error instanceof Error ? error.message : "生成失败"
        };
      }
      emit();
    }
  };

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency || 1)), pendingIndexes.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (signal?.aborted) {
    for (const index of pendingIndexes) {
      if (["queued", "generating"].includes(jobs[index].status)) {
        jobs[index] = { ...jobs[index], status: "stopped", error: undefined };
      }
    }
    emit();
  }
  return jobs;
};
