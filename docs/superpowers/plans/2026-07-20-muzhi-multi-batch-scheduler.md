# Muzhi Multi-Batch Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple product batches to generate through Muzhi concurrently with a shared default limit of 7, strict in-batch ordering, fair round-robin scheduling, and batch-scoped stop/resume controls.

**Architecture:** Add a provider-specific scheduler that owns Muzhi image dispatch across all batches while allowing at most one in-flight image per batch. Keep Yunwu and APIMart on the existing queue, replace the single application run controller with a batch-keyed registry, and expose scheduler statistics plus a persisted global limit in the execution panel.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, IndexedDB, existing OpenAI-compatible Muzhi proxy.

## Global Constraints

- Muzhi global concurrency defaults to `7` and is clamped to `1` through `10`.
- The limit is shared by all Muzhi batches; it is not stored on each `ProductBatch`.
- A batch may have at most one Muzhi image request in flight and must dispatch its jobs in FIFO order.
- New batches join the round-robin tail and never abort an existing batch.
- Stopping a batch aborts and marks only that batch's queued or generating jobs as `stopped`; completed images remain unchanged.
- Resuming queues only unfinished jobs and deduplicates image task IDs.
- Lowering the limit never aborts an in-flight request; it only prevents further dispatch until active work falls below the new limit.
- Yunwu, APIMart, and OpenRouter retain their current request behavior.
- No new runtime dependency is allowed.
- Automated concurrency tests use deferred mock requests; a real Muzhi smoke test generates at most one image.

---

## File Map

- Create `services/muzhiBatchScheduler.ts`: provider-specific fair scheduler and observable snapshot.
- Create `services/muzhiBatchScheduler.test.ts`: deterministic concurrency, fairness, cancellation, and limit-change tests.
- Create `services/batchRunRegistry.ts`: batch-keyed `AbortController` ownership.
- Create `services/batchRunRegistry.test.ts`: isolation, restart, stop, and teardown tests.
- Modify `services/geminiService.ts`: bypass the legacy single-request slot only for Muzhi while retaining HTTP retry behavior.
- Create `services/geminiService.concurrency.test.ts`: prove Muzhi overlap and legacy-provider serialization.
- Create `domain/muzhiConcurrency.ts`: constants and normalization for the global preference.
- Create `domain/muzhiConcurrency.test.ts`: boundary tests.
- Modify `utils/db.ts` and `utils/db.test.ts`: persist the global limit in the existing `settings` store.
- Modify `utils/workspaceHydration.ts` and `utils/workspaceHydration.test.ts`: hydrate the preference independently from batch data.
- Modify `domain/productWorkflow.ts` and `domain/productWorkflow.test.ts`: distinguish queued, generating, complete, partial, and stopped labels.
- Modify `App.tsx`: integrate the shared scheduler, per-batch run registry, persistence, and batch-local actions.
- Create `App.multiBatch.test.tsx`: verify switching, starting, stopping, and controls do not cross batch boundaries.
- Modify `index.css`: style scheduler statistics and responsive controls.

### Task 1: Muzhi Fair Batch Scheduler

**Files:**
- Create: `domain/muzhiConcurrency.ts`
- Create: `domain/muzhiConcurrency.test.ts`
- Create: `services/muzhiBatchScheduler.ts`
- Create: `services/muzhiBatchScheduler.test.ts`

**Interfaces:**
- Consumes: `ImageGeneration` from `domain/productWorkflow.ts`.
- Produces: concurrency constants, `normalizeMuzhiGlobalConcurrency`, `MuzhiBatchScheduler`, `MuzhiSchedulerSnapshot`, `MuzhiBatchRunInput`, and `MuzhiImageWorker` with the signatures below.

- [ ] **Step 1: Write failing normalization and scheduler tests**

First assert normalization maps `undefined -> 7`, `0 -> 1`, `7.9 -> 7`, and `99 -> 10`. Create scheduler test helpers that return externally resolvable promises, then test 12 batches with two jobs each. Assert `maxActive === 7`, `maxActiveByBatch === 1`, per-batch start order is `1, 2`, the initial dispatch is `A1, B1, C1`, a failed image releases its slot and does not block the same batch's next image or another batch, stopping A does not affect B/C, lowering 7 to 2 does not abort active work, and a repeated image ID is never dispatched twice.

```ts
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

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
  await Promise.all(runs);
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failure**

Run: `npm test -- domain/muzhiConcurrency.test.ts services/muzhiBatchScheduler.test.ts`

Expected: FAIL because `./muzhiBatchScheduler` does not exist.

- [ ] **Step 3: Implement normalization and the scheduler state machine**

Create the dependency used by the scheduler:

```ts
export const DEFAULT_MUZHI_GLOBAL_CONCURRENCY = 7;
export const MIN_MUZHI_GLOBAL_CONCURRENCY = 1;
export const MAX_MUZHI_GLOBAL_CONCURRENCY = 10;

export const normalizeMuzhiGlobalConcurrency = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MUZHI_GLOBAL_CONCURRENCY;
  return Math.min(MAX_MUZHI_GLOBAL_CONCURRENCY, Math.max(MIN_MUZHI_GLOBAL_CONCURRENCY, Math.floor(numeric)));
};
```

Use these public types and keep all queue mutation inside the class:

```ts
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

export class MuzhiBatchScheduler {
  constructor(limit = DEFAULT_MUZHI_GLOBAL_CONCURRENCY, onSnapshot?: (value: MuzhiSchedulerSnapshot) => void);
  setLimit(limit: number): void;
  enqueue(input: MuzhiBatchRunInput): Promise<ImageGeneration[]>;
  cancel(batchId: string): void;
  getSnapshot(): MuzhiSchedulerSnapshot;
  dispose(): void;
}
```

Internally store one `BatchQueue` per `batchId`, a `roundRobin: string[]`, an `activeBatchIds: Set<string>`, and `activeCount`. Each queue owns an internal `AbortController`; forward the optional input signal to `cancel(batchId)`, have `cancel` abort the internal controller, and pass the internal signal to the worker. Clone input jobs; preserve `completed`, normalize every other accepted job to `queued`, and deduplicate IDs against queued, active, and completed IDs in that batch. `drain()` repeatedly takes the next eligible batch from the rotation while `activeCount < limit`; `runNext()` marks one job `generating`, awaits the worker, converts success/error/abort to `completed`/`failed`/`stopped`, releases the batch and global slot in `finally`, resolves every enqueue waiter for that batch when no work remains, removes the forwarded abort listener, and calls `drain()` again.

- [ ] **Step 4: Run scheduler tests**

Run: `npm test -- domain/muzhiConcurrency.test.ts services/muzhiBatchScheduler.test.ts`

Expected: PASS for concurrency, FIFO, round-robin, duplicate IDs, stop isolation, snapshot counts, and dynamic limit tests.

- [ ] **Step 5: Commit the scheduler**

```bash
git add domain/muzhiConcurrency.ts domain/muzhiConcurrency.test.ts services/muzhiBatchScheduler.ts services/muzhiBatchScheduler.test.ts
git commit -m "feat: add fair Muzhi batch scheduler"
```

### Task 2: Provider Request Gate

**Files:**
- Modify: `services/geminiService.ts`
- Create: `services/geminiService.concurrency.test.ts`

**Interfaces:**
- Consumes: existing `requestJson`, `getRetryDelayMs`, `sleep`, and provider configuration.
- Produces: unchanged public `generateImage(...)` behavior; only Muzhi request-slot semantics change.

- [ ] **Step 1: Write failing request-overlap tests**

Mock `globalThis.fetch` with deferred responses and call `vi.resetModules()` between provider cases so module-level request-slot timestamps cannot leak across tests. Start two exported `requestProviderJson` calls for Muzhi and assert `fetch` is called twice before either response resolves. Run the same setup for APIMart and Yunwu and assert only the first fetch starts until it resolves and the configured minimum interval elapses. Add a Muzhi `429` test with `Retry-After: 0` followed by success, use fake timers to advance the configured 5-second minimum retry delay, and assert two fetch attempts plus the successful parsed payload.

```ts
it("allows Muzhi requests to overlap", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise));
  const a = requestProviderJson("muzhi", "/v1/images/generations", requestInit);
  const b = requestProviderJson("muzhi", "/v1/images/generations", requestInit);
  await flushMicrotasks();
  expect(fetch).toHaveBeenCalledTimes(2);
  first.resolve(okImageResponse("a"));
  second.resolve(okImageResponse("b"));
  await expect(Promise.all([a, b])).resolves.toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests and verify current Muzhi serialization fails**

Run: `npm test -- services/geminiService.concurrency.test.ts`

Expected: FAIL because the second Muzhi request remains behind `requestSlotStates.muzhi.queue`.

- [ ] **Step 3: Bypass the legacy slot for Muzhi and retain retries**

Change the request wrapper, not the response parser:

```ts
const withRequestSlot = async <T>(provider: ServiceProvider, task: () => Promise<T>, signal?: AbortSignal) => {
  if (provider === "muzhi") {
    if (signal?.aborted) throw createAbortError();
    return task();
  }
  return withSerializedProviderSlot(provider, task, signal);
};
```

Move the current queue/minimum-interval body unchanged into `withSerializedProviderSlot`. Keep `requestJson`'s loop, `getRetryDelayMs`, `Retry-After` parsing, abort-aware `sleep`, status conversion, retry count, and existing `export const requestProviderJson = requestJson` unchanged. Tests import that existing export; no test-only API or configuration export is added.

- [ ] **Step 4: Run provider and existing queue tests**

Run: `npm test -- services/geminiService.concurrency.test.ts services/productImageQueue.test.ts`

Expected: PASS; Muzhi overlaps, APIMart/Yunwu serialize, and `429` retry still succeeds.

- [ ] **Step 5: Commit the request-gate change**

```bash
git add services/geminiService.ts services/geminiService.concurrency.test.ts
git commit -m "fix: allow scheduled Muzhi requests to overlap"
```

### Task 3: Persisted Global Concurrency Preference

**Files:**
- Modify: `utils/db.ts`
- Modify: `utils/db.test.ts`
- Modify: `utils/workspaceHydration.ts`
- Modify: `utils/workspaceHydration.test.ts`

**Interfaces:**
- Consumes: concurrency constants and `normalizeMuzhiGlobalConcurrency` from Task 1.
- Produces: `saveMuzhiConcurrencyPreference` and `loadMuzhiConcurrencyPreference`.
- Extends: `hydrateProductWorkspace` loaders with `loadMuzhiConcurrency: () => Promise<number | null>` and result with `muzhiGlobalConcurrency: number`.

- [ ] **Step 1: Write failing IndexedDB and hydration tests**

In fake IndexedDB, assert save/load round-trip under record ID `muzhi-global-concurrency`. In hydration, assert stored `5` is returned, absent/failed settings read returns `7`, and a settings failure never discards successfully loaded batches.

```ts
await saveMuzhiConcurrencyPreference(5);
await expect(loadMuzhiConcurrencyPreference()).resolves.toBe(5);
```

- [ ] **Step 2: Run focused tests and verify missing exports**

Run: `npm test -- domain/muzhiConcurrency.test.ts utils/db.test.ts utils/workspaceHydration.test.ts`

Expected: FAIL because the persistence functions and hydration field do not exist.

- [ ] **Step 3: Implement persistence and hydration**

```ts
const MUZHI_CONCURRENCY_PREFERENCE_ID = "muzhi-global-concurrency";
```

Store `{ id: MUZHI_CONCURRENCY_PREFERENCE_ID, value: normalizeMuzhiGlobalConcurrency(value) }` in `settings`. Load the same record and return `null` when it is absent. Extend `Promise.allSettled` in `hydrateProductWorkspace` to include `loadMuzhiConcurrency()` and normalize either its fulfilled value or `7`; batch persistence eligibility must continue to depend only on the batch read.

- [ ] **Step 4: Run preference tests**

Run: `npm test -- domain/muzhiConcurrency.test.ts utils/db.test.ts utils/workspaceHydration.test.ts`

Expected: PASS, including old databases with no concurrency record.

- [ ] **Step 5: Commit the preference layer**

```bash
git add utils/db.ts utils/db.test.ts utils/workspaceHydration.ts utils/workspaceHydration.test.ts
git commit -m "feat: persist Muzhi global concurrency"
```

### Task 4: Batch-Scoped Run Ownership

**Files:**
- Create: `services/batchRunRegistry.ts`
- Create: `services/batchRunRegistry.test.ts`

**Interfaces:**
- Produces: `BatchRunRegistry.begin(batchId)`, `isCurrent(batchId, controller)`, `finish(batchId, controller)`, `stop(batchId)`, `stopAll()`, `has(batchId)`, and `getRunningBatchIds()`.

- [ ] **Step 1: Write failing controller-isolation tests**

```ts
it("starting another batch does not abort the first", () => {
  const registry = new BatchRunRegistry();
  const a = registry.begin("A");
  const b = registry.begin("B");
  expect(a.signal.aborted).toBe(false);
  expect(b.signal.aborted).toBe(false);
  registry.stop("B");
  expect(a.signal.aborted).toBe(false);
  expect(b.signal.aborted).toBe(true);
});
```

Also verify beginning A twice aborts only A's prior controller, stale `finish` cannot remove the replacement, `stopAll` aborts every controller, and snapshots contain unique batch IDs.

- [ ] **Step 2: Run the focused test and confirm missing module failure**

Run: `npm test -- services/batchRunRegistry.test.ts`

Expected: FAIL because `BatchRunRegistry` does not exist.

- [ ] **Step 3: Implement the registry**

```ts
export class BatchRunRegistry {
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly onChange?: (batchIds: Set<string>) => void) {}
  begin(batchId: string) {
    this.controllers.get(batchId)?.abort();
    const controller = new AbortController();
    this.controllers.set(batchId, controller);
    this.emit();
    return controller;
  }
  isCurrent(batchId: string, controller: AbortController) {
    return this.controllers.get(batchId) === controller;
  }
  finish(batchId: string, controller: AbortController) {
    if (!this.isCurrent(batchId, controller)) return;
    this.controllers.delete(batchId);
    this.emit();
  }
  stop(batchId: string) {
    this.controllers.get(batchId)?.abort();
    this.controllers.delete(batchId);
    this.emit();
  }
  stopAll() { [...this.controllers.values()].forEach(controller => controller.abort()); this.controllers.clear(); this.emit(); }
  has(batchId: string) { return this.controllers.has(batchId); }
  getRunningBatchIds() { return new Set(this.controllers.keys()); }
  private emit() { this.onChange?.(this.getRunningBatchIds()); }
}
```

- [ ] **Step 4: Run registry tests**

Run: `npm test -- services/batchRunRegistry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add services/batchRunRegistry.ts services/batchRunRegistry.test.ts
git commit -m "refactor: isolate product batch run controllers"
```

### Task 5: Application Orchestration and Batch-Local Controls

**Files:**
- Modify: `App.tsx`
- Create: `App.multiBatch.test.tsx`
- Modify: `App.hydration.test.tsx`

**Interfaces:**
- Consumes: `MuzhiBatchScheduler`, `BatchRunRegistry`, hydrated `muzhiGlobalConcurrency`, and preference persistence APIs.
- Produces: one shared scheduler per mounted app, batch-local run state, and provider-aware `executeBatchJobs`.

- [ ] **Step 1: Write failing integration tests**

Mock DB hydration with two ready Muzhi batches and mock the workflow/image worker with deferred promises. Start A, switch to B, start B, and assert A's signal remains active. Switch back to A and stop it; assert A aborts, B continues, A completed image remains, and B still displays its stop button. Unmount and assert both remaining signals abort. Update `App.hydration.test.tsx` DB mocks to include load/save concurrency functions so existing hydration coverage remains explicit.

```ts
expect(runSignals.get("A")?.aborted).toBe(false);
expect(runSignals.get("B")?.aborted).toBe(false);
await clickBatch("A");
await clickButton("停止生成");
expect(runSignals.get("A")?.aborted).toBe(true);
expect(runSignals.get("B")?.aborted).toBe(false);
```

- [ ] **Step 2: Run App tests and verify the single-controller behavior fails**

Run: `npm test -- App.multiBatch.test.tsx App.hydration.test.tsx`

Expected: FAIL because starting B aborts A and global `promptLoading`/`imageRunning` hide B's start action.

- [ ] **Step 3: Integrate batch-keyed runs**

Replace `activeRunControllerRef`, `activeRunBatchIdRef`, global `promptLoading`, and global `imageRunning` as run guards with:

```ts
const [runningBatchIds, setRunningBatchIds] = useState<Set<string>>(new Set());
const runRegistryRef = useRef<BatchRunRegistry | null>(null);
if (!runRegistryRef.current) {
  runRegistryRef.current = new BatchRunRegistry(ids => setRunningBatchIds(ids));
}
const beginRun = (batchId: string) => runRegistryRef.current!.begin(batchId);
const isCurrentRun = (batchId: string, controller: AbortController) => runRegistryRef.current!.isCurrent(batchId, controller);
const finishRun = (batchId: string, controller: AbortController) => runRegistryRef.current!.finish(batchId, controller);
const generationActive = runningBatchIds.has(activeBatch.id);
```

Every async handler must capture `const batchId = activeBatch.id`, call `isCurrentRun(batchId, controller)` before applying updates, and call `finishRun(batchId, controller)` in `finally`. Guards become `runningBatchIds.has(batchId)` so other batches remain startable. `handleStopGeneration` calls `runRegistry.stop(activeBatch.id)` and updates only that batch. The mount cleanup calls both `runRegistry.stopAll()` and `muzhiScheduler.dispose()`.

- [ ] **Step 4: Route Muzhi image jobs through the shared scheduler**

Create one scheduler instance and retain it for the app lifetime:

```ts
const [muzhiSnapshot, setMuzhiSnapshot] = useState<MuzhiSchedulerSnapshot>({
  limit: DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
  activeCount: 0,
  queuedCount: 0,
  runningBatchCount: 0
});
const muzhiSchedulerRef = useRef<MuzhiBatchScheduler | null>(null);
if (!muzhiSchedulerRef.current) {
  muzhiSchedulerRef.current = new MuzhiBatchScheduler(DEFAULT_MUZHI_GLOBAL_CONCURRENCY, setMuzhiSnapshot);
}

const executeBatchJobs: ProductBatchWorkflowDependencies["runJobs"] = (batch, jobs, onJobs, signal) => (
  batch.imageProvider === "muzhi"
    ? muzhiSchedulerRef.current!.enqueue({ batchId: batch.id, jobs, worker: generateJobImage, onJobs, signal })
    : runProductImageJobs(jobs, batch.concurrency, job => generateJobImage(job, signal), onJobs, signal)
);
```

Use `executeBatchJobs` in direct generation, retry, automatic flow, manual anchor flow, continue, and resume paths. Do not call `runProductImageJobs` directly for a Muzhi job. The scheduler's worker receives its batch signal so cancellation reaches the fetch request.

- [ ] **Step 5: Hydrate and persist the shared limit**

Set `muzhiGlobalConcurrency` from workspace hydration, call `muzhiScheduler.setLimit(value)` whenever it changes, and save with `saveMuzhiConcurrencyPreference(value)`. A persistence failure shows the existing settings error treatment but does not stop active jobs. Do not copy the value into `activeBatch.concurrency`.

- [ ] **Step 6: Run application integration tests**

Run: `npm test -- App.multiBatch.test.tsx App.hydration.test.tsx services/muzhiBatchScheduler.test.ts services/batchRunRegistry.test.ts`

Expected: PASS; A and B overlap, stopping A does not affect B, switching batches presents the correct controls, and teardown aborts all runs.

- [ ] **Step 7: Commit orchestration**

```bash
git add App.tsx App.multiBatch.test.tsx App.hydration.test.tsx
git commit -m "feat: run Muzhi batches independently"
```

### Task 6: Scheduler UI and Batch Status Copy

**Files:**
- Modify: `App.tsx`
- Modify: `index.css`
- Modify: `domain/productWorkflow.ts`
- Modify: `domain/productWorkflow.test.ts`

**Interfaces:**
- Consumes: `MuzhiSchedulerSnapshot` and `normalizeMuzhiGlobalConcurrency`.
- Produces: Muzhi execution controls and the exact status labels `排队中`, `生图中 X/Y`, `已完成`, `部分完成`, and `已停止`.

- [ ] **Step 1: Write failing status and rendered-control tests**

Add domain cases for all-queued images, at least one generating image, completed plus failed, all completed, and stopped. Extend `App.multiBatch.test.tsx` to select Muzhi and assert the panel contains `Muzhi 全局并发`, `7 / 10`, `实际生成`, `排队任务`, and `运行批次`; selecting APIMart must restore the existing per-batch `1–3` control.

```ts
expect(getBatchDisplayStatus({ ...batch, runPhase: "generating-images", images: queuedJobs }).label).toBe("排队中");
expect(getBatchDisplayStatus({ ...batch, runPhase: "generating-images", images: generatingJobs }).label).toBe("生图中 1/5");
```

- [ ] **Step 2: Run tests and verify copy/control failures**

Run: `npm test -- domain/productWorkflow.test.ts App.multiBatch.test.tsx`

Expected: FAIL because queued batches currently display `生图中 0/N` and the panel exposes only per-batch concurrency.

- [ ] **Step 3: Implement status precedence**

In `getBatchDisplayStatus`, retain stopped/prompt/anchor precedence, then calculate `queued`, `generating`, `completed`, and `failed`. Return `排队中` when there are queued images and no generating image, `生图中 ${completed}/${total}` when any image is generating, `已完成` when all complete, `部分完成` when completion is mixed with failure or stopped work, and `失败` only when no result completed and all terminal work failed.

- [ ] **Step 4: Replace the Muzhi execution control**

When `activeBatch.imageProvider === "muzhi"`, render a range input with min `1`, max `10`, value `muzhiGlobalConcurrency`, and label `${value} / 10`. Add a compact three-column statistics row:

```tsx
<div className="scheduler-stats" aria-live="polite">
  <div><span>实际生成</span><strong>{muzhiSnapshot.activeCount}</strong></div>
  <div><span>排队任务</span><strong>{muzhiSnapshot.queuedCount}</strong></div>
  <div><span>运行批次</span><strong>{muzhiSnapshot.runningBatchCount}</strong></div>
</div>
```

For Yunwu/APIMart preserve the existing per-batch range `1..3` and explanatory copy. Style the stats without nested cards, keep labels at least 13px and controls at least 40px high, and switch the statistics row to one column only below 420px if three columns cannot fit.

- [ ] **Step 5: Run UI and status tests**

Run: `npm test -- domain/productWorkflow.test.ts App.multiBatch.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the UI**

```bash
git add App.tsx index.css domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "feat: show Muzhi scheduler activity"
```

### Task 7: Full Verification, Browser Acceptance, and Deployment

**Files:**
- Modify only if verification reveals a regression in files already listed above.

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: verified build, pushed `main`, and production deployment.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: every test passes with no unhandled rejection or React `act(...)` warning introduced by this feature.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite exits 0 with no TypeScript/build error.

- [ ] **Step 3: Start the local app and perform browser acceptance**

Run: `npm run dev -- --host 127.0.0.1`

Using Playwright/browser tooling, verify at desktop `1440x900` and mobile `390x844`:

1. Muzhi displays `7 / 10` and the three live counters without overlap.
2. Start batch A, switch to batch B, and confirm B can start while A remains marked running.
3. Switch to A and stop it; B stays running and A's completed cards remain visible.
4. Lower the limit while work is active; active count does not abruptly drop from cancellation.
5. APIMart/Yunwu still show their old per-batch concurrency control.

Expected: controls are legible, batch status badges update independently, and no console error occurs.

- [ ] **Step 4: Run one controlled Muzhi smoke request**

With the configured production-style environment, create one batch containing one small Muzhi image task. Confirm the request reaches `/v1/images/edits` when a product reference is present, returns one image, and the batch changes to `已完成`. Do not launch seven paid images for this check.

- [ ] **Step 5: Inspect the final diff and repository state**

Run: `git diff --check && git status --short && git log --oneline -8`

Expected: no whitespace errors, no uncommitted generated files, and each implementation task has its own commit.

- [ ] **Step 6: Push and verify production**

```bash
git push origin main
vercel --prod
```

Expected: both commands exit 0. Open `https://chanpinshengtu.vercel.app`, repeat the one-batch start/stop check, and confirm the deployed commit matches local `HEAD`.
