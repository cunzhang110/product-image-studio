import { describe, expect, it } from "vitest";
import type { ImageGeneration } from "../domain/productWorkflow";
import { MuzhiBatchScheduler } from "./muzhiBatchScheduler";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeJob = (batchId: string, suffix: string): ImageGeneration => ({
  id: `${batchId}${suffix}`,
  batchId,
  promptVariantId: `prompt-${suffix}`,
  promptSnapshot: `scene ${suffix}`,
  productReferenceImageSnapshot: "data:image/png;base64,product",
  styleReferenceImageSnapshot: "data:image/png;base64,style",
  role: "standard",
  provider: "muzhi",
  model: "gpt-image-2",
  aspectRatio: "3:4",
  imageSize: "2K",
  status: "idle",
  createdAt: 1
});

describe("Muzhi batch scheduler", () => {
  it("limits all batches to seven while keeping one active image per batch", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const activeByBatch = new Map<string, number>();
    let active = 0;
    let maxActive = 0;
    let maxPerBatch = 0;
    const scheduler = new MuzhiBatchScheduler(7);
    const runs = Array.from({ length: 12 }, (_, index) => {
      const batchId = `batch-${index}`;
      return scheduler.enqueue({
        batchId,
        jobs: [makeJob(batchId, "1"), makeJob(batchId, "2")],
        worker: async job => {
          active += 1;
          activeByBatch.set(batchId, (activeByBatch.get(batchId) || 0) + 1);
          maxActive = Math.max(maxActive, active);
          maxPerBatch = Math.max(maxPerBatch, activeByBatch.get(batchId) || 0);
          const gate = deferred<string>();
          gates.set(job.id, gate);
          const value = await gate.promise;
          active -= 1;
          activeByBatch.set(batchId, (activeByBatch.get(batchId) || 1) - 1);
          return value;
        }
      });
    });

    await flushMicrotasks();
    expect(maxActive).toBe(7);
    expect(maxPerBatch).toBe(1);

    while (gates.size) {
      const [id, gate] = gates.entries().next().value!;
      gates.delete(id);
      gate.resolve(`data:${id}`);
      await flushMicrotasks();
    }

    const results = await Promise.all(runs);
    expect(results.flat().every(job => job.status === "completed")).toBe(true);
  });

  it("dispatches batches round-robin and keeps each batch FIFO", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const starts: string[] = [];
    const scheduler = new MuzhiBatchScheduler(3);
    const runs = ["A", "B", "C"].map(batchId => scheduler.enqueue({
      batchId,
      jobs: [makeJob(batchId, "1"), makeJob(batchId, "2")],
      worker: async job => {
        starts.push(job.id);
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    }));

    await flushMicrotasks();
    expect(starts).toEqual(["A1", "B1", "C1"]);
    gates.get("A1")!.resolve("data:A1");
    await flushMicrotasks();
    expect(starts).toEqual(["A1", "B1", "C1", "A2"]);

    while (gates.size) {
      const [id, gate] = gates.entries().next().value!;
      gates.delete(id);
      gate.resolve(`data:${id}`);
      await flushMicrotasks();
    }
    await Promise.all(runs);
  });

  it("releases a failed image slot for the next image without blocking another batch", async () => {
    const starts: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const scheduler = new MuzhiBatchScheduler(2);
    const runA = scheduler.enqueue({
      batchId: "A",
      jobs: [makeJob("A", "1"), makeJob("A", "2")],
      worker: async job => {
        starts.push(job.id);
        if (job.id === "A1") throw new Error("provider failed");
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    });
    const runB = scheduler.enqueue({
      batchId: "B",
      jobs: [makeJob("B", "1"), makeJob("B", "2")],
      worker: async job => {
        starts.push(job.id);
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    });
    const runC = scheduler.enqueue({
      batchId: "C",
      jobs: [makeJob("C", "1")],
      worker: async job => {
        starts.push(job.id);
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    });

    await flushMicrotasks();
    expect(starts).toEqual(["A1", "B1", "A2"]);
    gates.get("A2")!.resolve("data:A2");
    await flushMicrotasks();
    expect(starts).toContain("C1");
    gates.get("B1")!.resolve("data:B1");
    await flushMicrotasks();
    expect(starts).toContain("B2");

    while (gates.size) {
      const [id, gate] = gates.entries().next().value!;
      gates.delete(id);
      gate.resolve(`data:${id}`);
      await flushMicrotasks();
    }
    const [a] = await Promise.all([runA, runB, runC]);
    expect(a.map(job => job.status)).toEqual(["failed", "completed"]);
  });

  it("stopping one batch does not stop other batches", async () => {
    const scheduler = new MuzhiBatchScheduler(2);
    const starts: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const runA = scheduler.enqueue({
      batchId: "A",
      jobs: [makeJob("A", "1"), makeJob("A", "2")],
      worker: async (job, signal) => {
        starts.push(job.id);
        return new Promise<string>((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
          const gate = deferred<string>();
          gates.set(job.id, gate);
          gate.promise.then(resolve, reject);
        });
      }
    });
    const runB = scheduler.enqueue({
      batchId: "B",
      jobs: [makeJob("B", "1"), makeJob("B", "2")],
      worker: async job => {
        starts.push(job.id);
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    });
    const runC = scheduler.enqueue({
      batchId: "C",
      jobs: [makeJob("C", "1")],
      worker: async job => {
        starts.push(job.id);
        const gate = deferred<string>();
        gates.set(job.id, gate);
        return gate.promise;
      }
    });

    await flushMicrotasks();
    scheduler.cancel("A");
    await flushMicrotasks();
    expect(starts).toEqual(["A1", "B1", "C1"]);

    while (gates.size) {
      const [id, gate] = gates.entries().next().value!;
      gates.delete(id);
      gate.resolve(`data:${id}`);
      await flushMicrotasks();
    }
    const [a, b, c] = await Promise.all([runA, runB, runC]);
    expect(a.map(job => job.status)).toEqual(["stopped", "stopped"]);
    expect(b.every(job => job.status === "completed")).toBe(true);
    expect(c.every(job => job.status === "completed")).toBe(true);
  });

  it("lowers the limit without aborting active work and reports snapshot counts", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const signals: AbortSignal[] = [];
    const snapshots: Array<{ limit: number; activeCount: number; queuedCount: number; runningBatchCount: number }> = [];
    const scheduler = new MuzhiBatchScheduler(7, snapshot => snapshots.push(snapshot));
    const runs = Array.from({ length: 7 }, (_, index) => {
      const batchId = `batch-${index}`;
      return scheduler.enqueue({
        batchId,
        jobs: [makeJob(batchId, "1"), makeJob(batchId, "2")],
        worker: async (job, signal) => {
          signals.push(signal!);
          const gate = deferred<string>();
          gates.set(job.id, gate);
          return gate.promise;
        }
      });
    });

    await flushMicrotasks();
    expect(scheduler.getSnapshot()).toEqual({ limit: 7, activeCount: 7, queuedCount: 7, runningBatchCount: 7 });
    scheduler.setLimit(2);
    expect(scheduler.getSnapshot()).toEqual({ limit: 2, activeCount: 7, queuedCount: 7, runningBatchCount: 7 });
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    expect(snapshots.at(-1)).toEqual({ limit: 2, activeCount: 7, queuedCount: 7, runningBatchCount: 7 });

    while (gates.size) {
      const [id, gate] = gates.entries().next().value!;
      gates.delete(id);
      gate.resolve(`data:${id}`);
      await flushMicrotasks();
    }
    await Promise.all(runs);
  });

  it("never dispatches a repeated image ID twice", async () => {
    const scheduler = new MuzhiBatchScheduler(1);
    const gate = deferred<string>();
    const starts: string[] = [];
    const worker = async (job: ImageGeneration) => {
      starts.push(job.id);
      return gate.promise;
    };
    const original = makeJob("A", "1");
    const first = scheduler.enqueue({ batchId: "A", jobs: [original, { ...original }], worker });
    const second = scheduler.enqueue({ batchId: "A", jobs: [{ ...original }], worker });

    await flushMicrotasks();
    expect(starts).toEqual(["A1"]);
    gate.resolve("data:A1");
    await Promise.all([first, second]);
    expect(starts).toEqual(["A1"]);
  });
});
