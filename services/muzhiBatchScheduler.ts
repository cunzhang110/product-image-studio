import {
  DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
  normalizeMuzhiGlobalConcurrency
} from "../domain/muzhiConcurrency";
import type { ImageGeneration } from "../domain/productWorkflow";
import { isGenerationAbort } from "./productImageQueue";

export type MuzhiImageWorker = (job: ImageGeneration, signal?: AbortSignal) => Promise<string>;

export interface MuzhiSchedulerSnapshot {
  limit: number;
  activeCount: number;
  queuedCount: number;
  runningBatchCount: number;
}

export interface MuzhiBatchRunInput {
  batchId: string;
  jobs: ImageGeneration[];
  worker: MuzhiImageWorker;
  onJobs?: (jobs: ImageGeneration[]) => void;
  signal?: AbortSignal;
}

interface BatchQueue {
  batchId: string;
  jobs: ImageGeneration[];
  worker: MuzhiImageWorker;
  controller: AbortController;
  waiters: Array<(jobs: ImageGeneration[]) => void>;
  onJobs: Set<(jobs: ImageGeneration[]) => void>;
  abortListeners: Array<{ signal: AbortSignal; listener: () => void }>;
}

const cloneJobs = (jobs: ImageGeneration[]) => jobs.map(job => ({ ...job }));

export class MuzhiBatchScheduler {
  private readonly batches = new Map<string, BatchQueue>();
  private readonly roundRobin: string[] = [];
  private readonly activeBatchIds = new Set<string>();
  private activeCount = 0;
  private limit: number;
  private draining = false;

  constructor(
    limit = DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
    private readonly onSnapshot?: (value: MuzhiSchedulerSnapshot) => void
  ) {
    this.limit = normalizeMuzhiGlobalConcurrency(limit);
  }

  setLimit(limit: number): void {
    this.limit = normalizeMuzhiGlobalConcurrency(limit);
    this.emitSnapshot();
    this.drain();
  }

  enqueue(input: MuzhiBatchRunInput): Promise<ImageGeneration[]> {
    let queue = this.batches.get(input.batchId);
    if (!queue) {
      queue = {
        batchId: input.batchId,
        jobs: [],
        worker: input.worker,
        controller: new AbortController(),
        waiters: [],
        onJobs: new Set(),
        abortListeners: []
      };
      this.batches.set(input.batchId, queue);
      this.roundRobin.push(input.batchId);
    }

    if (input.onJobs) queue.onJobs.add(input.onJobs);
    const knownIds = new Set(queue.jobs.map(job => job.id));
    for (const inputJob of input.jobs) {
      if (knownIds.has(inputJob.id)) continue;
      knownIds.add(inputJob.id);
      queue.jobs.push(inputJob.status === "completed"
        ? { ...inputJob }
        : { ...inputJob, status: "queued", error: undefined });
    }

    if (input.signal) {
      const listener = () => this.cancel(input.batchId);
      input.signal.addEventListener("abort", listener, { once: true });
      queue.abortListeners.push({ signal: input.signal, listener });
      if (input.signal.aborted) listener();
    }

    const result = new Promise<ImageGeneration[]>(resolve => queue!.waiters.push(resolve));
    this.emitQueue(queue);
    this.finishIfComplete(queue);
    this.drain();
    return result;
  }

  cancel(batchId: string): void {
    const queue = this.batches.get(batchId);
    if (!queue) return;

    queue.controller.abort();
    queue.jobs = queue.jobs.map(job => job.status === "queued"
      ? { ...job, status: "stopped", error: undefined }
      : job);
    this.emitQueue(queue);
    this.finishIfComplete(queue);
    this.drain();
  }

  getSnapshot(): MuzhiSchedulerSnapshot {
    return {
      limit: this.limit,
      activeCount: this.activeCount,
      queuedCount: Array.from(this.batches.values())
        .reduce((count, queue) => count + queue.jobs.filter(job => job.status === "queued").length, 0),
      runningBatchCount: this.activeBatchIds.size
    };
  }

  dispose(): void {
    for (const batchId of [...this.batches.keys()]) this.cancel(batchId);
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.activeCount < this.limit) {
        const queue = this.nextEligibleBatch();
        if (!queue) break;
        this.runNext(queue);
      }
    } finally {
      this.draining = false;
    }
  }

  private nextEligibleBatch(): BatchQueue | undefined {
    const attempts = this.roundRobin.length;
    for (let index = 0; index < attempts; index += 1) {
      const batchId = this.roundRobin.shift()!;
      const queue = this.batches.get(batchId);
      if (!queue) continue;
      this.roundRobin.push(batchId);
      if (
        !this.activeBatchIds.has(batchId)
        && !queue.controller.signal.aborted
        && queue.jobs.some(job => job.status === "queued")
      ) return queue;
    }
    return undefined;
  }

  private async runNext(queue: BatchQueue): Promise<void> {
    const index = queue.jobs.findIndex(job => job.status === "queued");
    if (index === -1) return;

    this.activeCount += 1;
    this.activeBatchIds.add(queue.batchId);
    queue.jobs[index] = { ...queue.jobs[index], status: "generating", error: undefined };
    this.emitQueue(queue);

    try {
      const resultUrl = await queue.worker({ ...queue.jobs[index] }, queue.controller.signal);
      queue.jobs[index] = queue.controller.signal.aborted
        ? { ...queue.jobs[index], status: "stopped", error: undefined }
        : { ...queue.jobs[index], status: "completed", resultUrl, error: undefined };
    } catch (error) {
      const stopped = queue.controller.signal.aborted || isGenerationAbort(error);
      queue.jobs[index] = stopped
        ? { ...queue.jobs[index], status: "stopped", error: undefined }
        : {
          ...queue.jobs[index],
          status: "failed",
          error: error instanceof Error ? error.message : "生成失败"
        };
    } finally {
      this.activeCount -= 1;
      this.activeBatchIds.delete(queue.batchId);
      this.emitQueue(queue);
      this.finishIfComplete(queue);
      this.drain();
    }
  }

  private finishIfComplete(queue: BatchQueue): void {
    if (queue.jobs.some(job => job.status === "queued" || job.status === "generating")) return;

    this.batches.delete(queue.batchId);
    const roundRobinIndex = this.roundRobin.indexOf(queue.batchId);
    if (roundRobinIndex !== -1) this.roundRobin.splice(roundRobinIndex, 1);
    for (const { signal, listener } of queue.abortListeners) {
      signal.removeEventListener("abort", listener);
    }
    const jobs = cloneJobs(queue.jobs);
    for (const resolve of queue.waiters) resolve(jobs);
    queue.waiters = [];
    this.emitSnapshot();
  }

  private emitQueue(queue: BatchQueue): void {
    const jobs = cloneJobs(queue.jobs);
    for (const onJobs of queue.onJobs) onJobs(jobs);
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.onSnapshot?.(this.getSnapshot());
  }
}
