import type { ImageGeneration } from "../domain/productWorkflow";
import type { ReferenceImageItem } from "../types";

export type ImageJobWorker = (job: ImageGeneration) => Promise<string>;
export type ImageQueueUpdate = (jobs: ImageGeneration[]) => void;

export const buildJobReferences = (job: ImageGeneration): ReferenceImageItem[] => [
  { id: "product-reference", name: "产品参考图", imageData: job.productReferenceImageSnapshot },
  ...(job.anchorReferenceImageSnapshot
    ? [{ id: "anchor-reference", name: "主场景图", imageData: job.anchorReferenceImageSnapshot }]
    : []),
  ...(job.styleReferenceImageSnapshot
    ? [{ id: "style-reference", name: "风格参考图", imageData: job.styleReferenceImageSnapshot }]
    : [])
];

export const runProductImageJobs = async (
  inputJobs: ImageGeneration[],
  concurrency: number,
  worker: ImageJobWorker,
  onUpdate?: ImageQueueUpdate
): Promise<ImageGeneration[]> => {
  const jobs: ImageGeneration[] = inputJobs.map(job => ({ ...job, status: "queued", error: undefined }));
  const emit = () => onUpdate?.(jobs.map(job => ({ ...job })));
  let cursor = 0;
  emit();

  const runWorker = async () => {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      jobs[index] = { ...jobs[index], status: "generating", error: undefined };
      emit();

      try {
        const resultUrl = await worker(jobs[index]);
        jobs[index] = { ...jobs[index], status: "completed", resultUrl, error: undefined };
      } catch (error) {
        jobs[index] = {
          ...jobs[index],
          status: "failed",
          error: error instanceof Error ? error.message : "生成失败"
        };
      }
      emit();
    }
  };

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency || 1)), jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return jobs;
};
