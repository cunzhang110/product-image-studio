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

interface BatchRun {
  jobs: ImageGeneration[];
  worker: MuzhiImageWorker;
  controller: AbortController;
  waiters: Array<(jobs: ImageGeneration[]) => void>;
  onJobs: Set<(jobs: ImageGeneration[]) => void>;
  abortListeners: Array<{ signal: AbortSignal; listener: () => void }>;
  cancelled: boolean;
  settled: boolean;
}

interface BatchQueue {
  batchId: string;
  current: BatchRun;
  pending?: BatchRun;
}

const cloneJobs = (jobs: ImageGeneration[]) => jobs.map(job => ({ ...job }));

const stoppedInputJobs = (jobs: ImageGeneration[]) => {
  const seen = new Set<string>();
  return jobs.flatMap(job => {
    if (seen.has(job.id)) return [];
    seen.add(job.id);
    return [{
      ...job,
      status: job.status === "completed" ? "completed" as const : "stopped" as const,
      error: undefined
    }];
  });
};

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
    if (input.signal?.aborted) {
      const jobs = stoppedInputJobs(input.jobs);
      input.onJobs?.(cloneJobs(jobs));
      return Promise.resolve(cloneJobs(jobs));
    }

    let queue = this.batches.get(input.batchId);
    let run: BatchRun;
    if (!queue) {
      run = this.createRun(input.worker);
      queue = { batchId: input.batchId, current: run };
      this.batches.set(input.batchId, queue);
      this.roundRobin.push(input.batchId);
    } else if (queue.current.cancelled && this.activeBatchIds.has(input.batchId)) {
      run = queue.pending || this.createRun(input.worker);
      queue.pending = run;
    } else {
      run = queue.current;
    }

    if (input.onJobs) run.onJobs.add(input.onJobs);
    this.appendJobs(run, input.jobs, queue.current === run ? [] : queue.current.jobs);
    const result = new Promise<ImageGeneration[]>(resolve => run.waiters.push(resolve));

    if (input.signal) {
      const listener = () => this.cancel(input.batchId);
      input.signal.addEventListener("abort", listener, { once: true });
      run.abortListeners.push({ signal: input.signal, listener });
    }

    this.emitRun(run);
    this.settleRunIfComplete(run);
    this.advanceQueue(queue);
    this.drain();
    return result;
  }

  cancel(batchId: string): void {
    const queue = this.batches.get(batchId);
    if (!queue) return;

    this.cancelRun(queue.current);
    if (queue.pending) {
      this.cancelRun(queue.pending);
      queue.pending = undefined;
    }
    this.advanceQueue(queue);
    this.drain();
  }

  getSnapshot(): MuzhiSchedulerSnapshot {
    return {
      limit: this.limit,
      activeCount: this.activeCount,
      queuedCount: Array.from(this.batches.values()).reduce((count, queue) => (
        count
        + queue.current.jobs.filter(job => job.status === "queued").length
        + (queue.pending?.jobs.filter(job => job.status === "queued").length || 0)
      ), 0),
      runningBatchCount: this.activeBatchIds.size
    };
  }

  dispose(): void {
    for (const batchId of [...this.batches.keys()]) this.cancel(batchId);
  }

  private createRun(worker: MuzhiImageWorker): BatchRun {
    return {
      jobs: [],
      worker,
      controller: new AbortController(),
      waiters: [],
      onJobs: new Set(),
      abortListeners: [],
      cancelled: false,
      settled: false
    };
  }

  private appendJobs(run: BatchRun, inputJobs: ImageGeneration[], previousJobs: ImageGeneration[]): void {
    const knownIds = new Set(run.jobs.map(job => job.id));
    const completedById = new Map(
      [...previousJobs, ...run.jobs]
        .filter(job => job.status === "completed")
        .map(job => [job.id, job])
    );

    for (const inputJob of inputJobs) {
      if (knownIds.has(inputJob.id)) continue;
      knownIds.add(inputJob.id);
      const completed = completedById.get(inputJob.id);
      run.jobs.push(completed
        ? { ...completed }
        : inputJob.status === "completed"
          ? { ...inputJob }
          : { ...inputJob, status: "queued", error: undefined });
    }
  }

  private cancelRun(run: BatchRun): void {
    if (run.cancelled) return;
    run.cancelled = true;
    run.controller.abort();
    run.jobs = run.jobs.map(job => job.status === "queued" || job.status === "generating"
      ? { ...job, status: "stopped", error: undefined }
      : job);
    this.emitRun(run);
    this.settleRun(run);
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
        && !queue.current.cancelled
        && queue.current.jobs.some(job => job.status === "queued")
      ) return queue;
    }
    return undefined;
  }

  private async runNext(queue: BatchQueue): Promise<void> {
    const run = queue.current;
    const index = run.jobs.findIndex(job => job.status === "queued");
    if (index === -1) return;

    this.activeCount += 1;
    this.activeBatchIds.add(queue.batchId);
    run.jobs[index] = { ...run.jobs[index], status: "generating", error: undefined };
    this.emitRun(run);

    try {
      const resultUrl = await run.worker({ ...run.jobs[index] }, run.controller.signal);
      if (run.jobs[index].status === "generating") {
        run.jobs[index] = run.controller.signal.aborted
          ? { ...run.jobs[index], status: "stopped", error: undefined }
          : { ...run.jobs[index], status: "completed", resultUrl, error: undefined };
      }
    } catch (error) {
      if (run.jobs[index].status === "generating") {
        const stopped = run.controller.signal.aborted || isGenerationAbort(error);
        run.jobs[index] = stopped
          ? { ...run.jobs[index], status: "stopped", error: undefined }
          : {
            ...run.jobs[index],
            status: "failed",
            error: error instanceof Error ? error.message : "生成失败"
          };
      }
    } finally {
      this.activeCount -= 1;
      this.activeBatchIds.delete(queue.batchId);
      if (run.settled) this.emitSnapshot();
      else this.emitRun(run);
      this.settleRunIfComplete(run);
      this.advanceQueue(queue);
      this.drain();
    }
  }

  private settleRunIfComplete(run: BatchRun): void {
    if (run.jobs.some(job => job.status === "queued" || job.status === "generating")) return;
    this.settleRun(run);
  }

  private settleRun(run: BatchRun): void {
    if (run.settled) return;
    run.settled = true;
    for (const { signal, listener } of run.abortListeners) {
      signal.removeEventListener("abort", listener);
    }
    run.abortListeners = [];
    const jobs = cloneJobs(run.jobs);
    for (const resolve of run.waiters) resolve(jobs);
    run.waiters = [];
    run.onJobs.clear();
  }

  private advanceQueue(queue: BatchQueue): void {
    if (this.activeBatchIds.has(queue.batchId) || !queue.current.settled) return;
    if (queue.pending) {
      queue.current = queue.pending;
      queue.pending = undefined;
      return;
    }
    this.removeQueue(queue);
  }

  private removeQueue(queue: BatchQueue): void {
    if (this.batches.get(queue.batchId) !== queue) return;
    this.batches.delete(queue.batchId);
    const roundRobinIndex = this.roundRobin.indexOf(queue.batchId);
    if (roundRobinIndex !== -1) this.roundRobin.splice(roundRobinIndex, 1);
    this.emitSnapshot();
  }

  private emitRun(run: BatchRun): void {
    const jobs = cloneJobs(run.jobs);
    for (const onJobs of run.onJobs) onJobs(jobs);
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.onSnapshot?.(this.getSnapshot());
  }
}
