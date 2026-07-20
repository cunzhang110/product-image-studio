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

  it("stops an abort-ignoring run immediately but holds its physical slot", async () => {
    const oldGate = deferred<string>();
    const otherGate = deferred<string>();
    const updates: ImageGeneration[][] = [];
    const starts: string[] = [];
    const scheduler = new MuzhiBatchScheduler(1);
    let firstSettled = false;
    const first = scheduler.enqueue({
      batchId: "A",
      jobs: [makeJob("A", "1"), makeJob("A", "2")],
      onJobs: jobs => updates.push(jobs),
      worker: async job => {
        starts.push(job.id);
        return oldGate.promise;
      }
    });
    first.then(() => { firstSettled = true; });
    const other = scheduler.enqueue({
      batchId: "B",
      jobs: [makeJob("B", "1")],
      worker: async job => {
        starts.push(job.id);
        return otherGate.promise;
      }
    });

    await flushMicrotasks();
    scheduler.cancel("A");
    await flushMicrotasks();

    expect(updates.at(-1)?.map(job => job.status)).toEqual(["stopped", "stopped"]);
    expect(firstSettled).toBe(true);
    expect(starts).toEqual(["A1"]);
    expect(scheduler.getSnapshot().activeCount).toBe(1);

    oldGate.resolve("data:A1");
    await flushMicrotasks();
    expect(starts).toEqual(["A1", "B1"]);
    otherGate.resolve("data:B1");
    await Promise.all([first, other]);
  });

  it("does not invoke a worker after an onJobs cancellation observes generating", async () => {
    let calls = 0;
    const scheduler = new MuzhiBatchScheduler(1);
    const result = await scheduler.enqueue({
      batchId: "A",
      jobs: [makeJob("A", "1")],
      onJobs: jobs => {
        if (jobs.some(job => job.status === "generating")) scheduler.cancel("A");
      },
      worker: async () => {
        calls += 1;
        return "unused";
      }
    });

    expect(calls).toBe(0);
    expect(result.map(job => job.status)).toEqual(["stopped"]);
    expect(scheduler.getSnapshot()).toEqual({ limit: 1, activeCount: 0, queuedCount: 0, runningBatchCount: 0 });
  });

  it("settles a pre-aborted run without dispatching or retaining a waiter", async () => {
    const controller = new AbortController();
    controller.abort();
    const updates: ImageGeneration[][] = [];
    let calls = 0;
    const completed = { ...makeJob("A", "done"), status: "completed" as const, resultUrl: "data:done" };
    const scheduler = new MuzhiBatchScheduler(1);

    const result = await scheduler.enqueue({
      batchId: "A",
      jobs: [completed, makeJob("A", "1")],
      signal: controller.signal,
      onJobs: jobs => updates.push(jobs),
      worker: async () => {
        calls += 1;
        return "unused";
      }
    });

    expect(calls).toBe(0);
    expect(result.map(job => job.status)).toEqual(["completed", "stopped"]);
    expect(updates.at(-1)?.map(job => job.status)).toEqual(["completed", "stopped"]);
    expect(scheduler.getSnapshot()).toEqual({ limit: 1, activeCount: 0, queuedCount: 0, runningBatchCount: 0 });
  });

  it("queues a cancelled batch resume until the old physical request settles", async () => {
    const oldGate = deferred<string>();
    const resumedGate = deferred<string>();
    const starts: string[] = [];
    const signals: AbortSignal[] = [];
    const scheduler = new MuzhiBatchScheduler(1);
    const completed = { ...makeJob("A", "done"), status: "completed" as const, resultUrl: "data:done" };
    const first = scheduler.enqueue({
      batchId: "A",
      jobs: [completed, makeJob("A", "1")],
      worker: async (job, signal) => {
        starts.push(`old:${job.id}`);
        signals.push(signal!);
        return oldGate.promise;
      }
    });

    await flushMicrotasks();
    scheduler.cancel("A");
    const stopped = await first;
    const resumed = scheduler.enqueue({
      batchId: "A",
      jobs: stopped,
      worker: async (job, signal) => {
        starts.push(`new:${job.id}`);
        signals.push(signal!);
        return resumedGate.promise;
      }
    });

    await flushMicrotasks();
    expect(starts).toEqual(["old:A1"]);
    expect(scheduler.getSnapshot()).toEqual({ limit: 1, activeCount: 1, queuedCount: 1, runningBatchCount: 1 });
    oldGate.resolve("ignored-old-result");
    await flushMicrotasks();
    expect(starts).toEqual(["old:A1", "new:A1"]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    resumedGate.resolve("data:A1");
    const result = await resumed;
    expect(result.map(job => job.id)).toEqual(["Adone", "A1"]);
    expect(result.map(job => job.status)).toEqual(["completed", "completed"]);
  });

  it("starts a resumed run once after the cancelled physical request rejects", async () => {
    const oldGate = deferred<string>();
    const resumedGate = deferred<string>();
    const starts: string[] = [];
    const signals: AbortSignal[] = [];
    const scheduler = new MuzhiBatchScheduler(1);
    const first = scheduler.enqueue({
      batchId: "A",
      jobs: [makeJob("A", "1")],
      worker: async (job, signal) => {
        starts.push(`old:${job.id}`);
        signals.push(signal!);
        return oldGate.promise;
      }
    });

    await flushMicrotasks();
    scheduler.cancel("A");
    const stopped = await first;
    const resumed = scheduler.enqueue({
      batchId: "A",
      jobs: stopped,
      worker: async (job, signal) => {
        starts.push(`new:${job.id}`);
        signals.push(signal!);
        return resumedGate.promise;
      }
    });

    oldGate.reject(new Error("old request failed after cancellation"));
    await flushMicrotasks();
    expect(stopped.map(job => job.status)).toEqual(["stopped"]);
    expect(starts).toEqual(["old:A1", "new:A1"]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    resumedGate.resolve("data:A1");
    const result = await resumed;
    expect(starts.filter(value => value === "new:A1")).toHaveLength(1);
    expect(result.map(job => job.status)).toEqual(["completed"]);
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

  it("retains completed IDs after settlement and restores their original result", async () => {
    const scheduler = new MuzhiBatchScheduler(1);
    const job1 = { ...makeJob("A", "1"), id: "job-1" };
    const job2 = { ...makeJob("A", "2"), id: "job-2" };
    const first = await scheduler.enqueue({
      batchId: "A",
      jobs: [job1],
      worker: async () => "data:original-job-1"
    });
    expect(first[0].status).toBe("completed");

    const calls: string[] = [];
    const result = await scheduler.enqueue({
      batchId: "A",
      jobs: [{ ...job1, status: "idle", resultUrl: undefined }, job2],
      worker: async job => {
        calls.push(job.id);
        return `data:${job.id}`;
      }
    });

    expect(calls).toEqual(["job-2"]);
    expect(result[0]).toMatchObject({
      id: "job-1",
      status: "completed",
      resultUrl: "data:original-job-1"
    });
    expect(result[1]).toMatchObject({ id: "job-2", status: "completed", resultUrl: "data:job-2" });
  });

  it("keeps stopped and failed IDs eligible after a batch settles", async () => {
    const scheduler = new MuzhiBatchScheduler(1);
    const calls: string[] = [];
    const stopped = { ...makeJob("A", "stopped"), status: "stopped" as const };
    const failed = { ...makeJob("A", "failed"), status: "failed" as const, error: "old failure" };

    const result = await scheduler.enqueue({
      batchId: "A",
      jobs: [stopped, failed],
      worker: async job => {
        calls.push(job.id);
        return `data:${job.id}`;
      }
    });

    expect(calls).toEqual(["Astopped", "Afailed"]);
    expect(result.every(job => job.status === "completed")).toBe(true);
  });

  it("clears retained completed IDs on dispose", async () => {
    const scheduler = new MuzhiBatchScheduler(1);
    const job = { ...makeJob("A", "1"), id: "job-1" };
    await scheduler.enqueue({ batchId: "A", jobs: [job], worker: async () => "data:first" });
    scheduler.dispose();
    let calls = 0;

    const result = await scheduler.enqueue({
      batchId: "A",
      jobs: [{ ...job, status: "idle" }],
      worker: async () => {
        calls += 1;
        return "data:after-dispose";
      }
    });

    expect(calls).toBe(1);
    expect(result[0].resultUrl).toBe("data:after-dispose");
  });
});
