# Automatic Anchored Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic end-to-end generation, same-scene multi-angle generation anchored to one master image, file-based batch naming, and visible batch lifecycle badges without changing existing manual behavior.

**Architecture:** Extend the persisted batch domain with explicit workflow, strategy, naming, and run-phase fields. Keep status derivation and job construction pure in the domain, isolate OpenRouter scene-plan parsing in the prompt service, and place resumable workflow sequencing in a dedicated coordinator that receives prompt/image dependencies. React components select modes and render state; `App.tsx` connects the coordinator to persistence and provider adapters.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, IndexedDB, OpenRouter Qwen 3.5 9B, existing Yunwu/APIMart/Muzhi image adapters.

## Global Constraints

- Preserve existing manual multi-scene behavior for migrated batches.
- Automatic mode requires both a style reference image and a product reference image.
- Requested prompt count equals final image count.
- The master scene image is final image 1 in anchored-angle mode.
- Product reference is highest priority, master scene is the environment anchor, and style reference controls visual tone.
- Every derived image independently references the same master image; outputs must never chain from one derived image to the next.
- Manual anchored mode pauses after the master image; automatic anchored mode continues without confirmation.
- Use existing providers and models; add no dependency or new backend service.

---

### Task 1: Persisted Workflow Domain and Batch Status

**Files:**
- Modify: `domain/productWorkflow.ts`
- Modify: `domain/productWorkflow.test.ts`

**Interfaces:**
- Produces: `WorkflowMode`, `PromptStrategy`, `BatchRunPhase`, `BatchNameSource`, `ImageGenerationRole`, `BatchDisplayStatus`.
- Produces: `getBatchDisplayStatus(batch: ProductBatch): BatchDisplayStatus`.
- Produces: `applyProductReferenceFilename(batch: ProductBatch, filename: string): ProductBatch`.
- Produces: `createAnchoredImageJobs(batch: ProductBatch, anchorPromptId: string): ImageGeneration[]`.

- [ ] **Step 1: Write failing migration, naming, status, and anchored-job tests**

```ts
it("migrates old batches to manual varied-scene mode", () => {
  expect(normalizeProductBatch(createProductBatch("旧批次"))).toMatchObject({
    workflowMode: "manual",
    promptStrategy: "varied-scenes",
    runPhase: "idle",
    nameSource: "manual"
  });
});

it("uses the product filename until the user names the batch", () => {
  const batch = { ...createProductBatch(), nameSource: "automatic" as const };
  expect(applyProductReferenceFilename(batch, "婚宴产品.jpg").name).toBe("婚宴产品");
  expect(applyProductReferenceFilename({ ...batch, nameSource: "manual", name: "婚宴系列" }, "新图.png").name).toBe("婚宴系列");
});

it("shows generation progress from persisted jobs", () => {
  const batch = createProductBatch();
  batch.runPhase = "generating-images";
  batch.images = [makeImage("completed"), makeImage("generating")];
  expect(getBatchDisplayStatus(batch)).toEqual({ tone: "blue", label: "生图中 1/2" });
});
```

- [ ] **Step 2: Run the domain tests and verify failure**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: FAIL because the new fields and helpers do not exist.

- [ ] **Step 3: Add explicit workflow fields and pure helpers**

```ts
export type WorkflowMode = "manual" | "automatic";
export type PromptStrategy = "varied-scenes" | "anchored-angles";
export type BatchRunPhase = "idle" | "generating-prompts" | "generating-anchor" | "awaiting-anchor-approval" | "generating-images" | "completed" | "failed";
export type BatchNameSource = "automatic" | "manual";
export type ImageGenerationRole = "standard" | "anchor" | "derived";

export interface BatchDisplayStatus {
  tone: "gray" | "purple" | "blue" | "orange" | "green" | "red";
  label: string;
}
```

Add `workflowMode`, `promptStrategy`, `runPhase`, `runError`, `nameSource`, `sceneBible`, `anchorImageId`, and `role`/`anchorReferenceImageSnapshot` to the relevant interfaces. Normalize missing values to manual, varied-scenes, idle, manual-name behavior. Derive labels from phase and job counts, strip the final filename extension with `/\.[^.]+$/`, and create one anchor job plus derived jobs while keeping total jobs equal to `requestedPromptCount`.

- [ ] **Step 4: Run domain tests**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain change**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "feat add product batch workflow state"
```

---

### Task 2: Generate Structured Same-Scene Plans

**Files:**
- Modify: `services/productPromptService.ts`
- Modify: `services/productPromptService.test.ts`

**Interfaces:**
- Consumes: `PromptStrategy` from Task 1.
- Produces: `AnchoredScenePlan { sceneBible: string; anchorPrompt: string; anglePrompts: string[] }`.
- Produces: `generateProductPromptPlan(input: ProductPromptInput & { strategy: PromptStrategy }): Promise<ProductPromptPlan>`.

- [ ] **Step 1: Write failing request and parser tests**

```ts
it("asks Qwen for one anchor and count minus one camera variants", () => {
  const request = buildProductPromptRequest({ ...input, count: 6, strategy: "anchored-angles" });
  const text = JSON.stringify(request.body);
  expect(text).toContain("1 张主场景");
  expect(text).toContain("5 个不同机位");
  expect(text).toContain("环境固定字段");
});

it("parses an anchored scene plan", () => {
  expect(parseAnchoredScenePlan(JSON.stringify({
    sceneBible: "白色桌布、香槟塔、右侧暖光",
    anchorPrompt: "正面主场景",
    anglePrompts: ["左前方 45 度", "低机位近景"]
  }), 3).anglePrompts).toHaveLength(2);
});
```

- [ ] **Step 2: Run prompt-service tests and verify failure**

Run: `npm test -- services/productPromptService.test.ts`

Expected: FAIL because anchored plan support does not exist.

- [ ] **Step 3: Implement two prompt response contracts**

```ts
export type ProductPromptPlan =
  | { strategy: "varied-scenes"; prompts: string[] }
  | { strategy: "anchored-angles"; sceneBible: string; anchorPrompt: string; anglePrompts: string[] };
```

For `varied-scenes`, preserve the current JSON string-array instruction. For `anchored-angles`, request one JSON object with a fixed scene bible, one anchor prompt, and exactly `count - 1` angle prompts. Require each angle prompt to repeat the fixed environment facts and change only camera height, direction, lens, framing, or distance. Reject incomplete objects with a Chinese retryable error instead of silently falling back to varied scenes.

- [ ] **Step 4: Run prompt tests**

Run: `npm test -- services/productPromptService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the prompt strategy change**

```bash
git add services/productPromptService.ts services/productPromptService.test.ts
git commit -m "feat generate anchored scene prompt plans"
```

---

### Task 3: Resumable Manual and Automatic Workflow Coordinator

**Files:**
- Create: `services/productBatchWorkflow.ts`
- Create: `services/productBatchWorkflow.test.ts`
- Modify: `services/productImageQueue.ts`

**Interfaces:**
- Consumes: `ProductPromptPlan`, domain job helpers, and existing `runProductImageJobs`.
- Produces: `runAutomaticProductBatch(batch, dependencies, onUpdate): Promise<ProductBatch>`.
- Produces: `startManualAnchoredBatch(batch, dependencies, onUpdate): Promise<ProductBatch>`.
- Produces: `continueManualAnchoredBatch(batch, dependencies, onUpdate): Promise<ProductBatch>`.
- Dependencies: `{ generatePromptPlan, generateJobImage }`, both injected for deterministic tests.

- [ ] **Step 1: Write failing coordinator tests**

```ts
it("runs automatic varied scenes from prompts through final images", async () => {
  const result = await runAutomaticProductBatch(batchWithRefs({ requestedPromptCount: 3 }), deps(), vi.fn());
  expect(result.prompts).toHaveLength(3);
  expect(result.images).toHaveLength(3);
  expect(result.runPhase).toBe("completed");
});

it("counts the anchor as image one and shares it with every derived job", async () => {
  const result = await runAutomaticProductBatch(batchWithRefs({ promptStrategy: "anchored-angles", requestedPromptCount: 4 }), deps(), vi.fn());
  expect(result.images).toHaveLength(4);
  expect(result.images[0].role).toBe("anchor");
  expect(result.images.slice(1).every(job => job.anchorReferenceImageSnapshot === result.images[0].resultUrl)).toBe(true);
});

it("manual anchored mode pauses after the anchor", async () => {
  const result = await startManualAnchoredBatch(batchWithRefs({ promptStrategy: "anchored-angles" }), deps(), vi.fn());
  expect(result.runPhase).toBe("awaiting-anchor-approval");
  expect(result.images).toHaveLength(1);
});

it("stops on anchor failure but continues past one derived failure", async () => {
  const anchorFailure = deps({ generateJobImage: async job => {
    if (job.role === "anchor") throw new Error("anchor failed");
    return "data:image/png;base64,ok";
  }});
  const stopped = await runAutomaticProductBatch(
    batchWithRefs({ promptStrategy: "anchored-angles", requestedPromptCount: 3 }),
    anchorFailure,
    vi.fn()
  );
  expect(stopped.runPhase).toBe("failed");
  expect(stopped.images).toHaveLength(1);

  const derivedFailure = deps({ generateJobImage: async job => {
    if (job.role === "derived" && job.promptSnapshot.includes("第二机位")) throw new Error("shot failed");
    return "data:image/png;base64,ok";
  }});
  const partial = await runAutomaticProductBatch(
    batchWithRefs({ promptStrategy: "anchored-angles", requestedPromptCount: 3 }),
    derivedFailure,
    vi.fn()
  );
  expect(partial.images.filter(job => job.status === "completed")).toHaveLength(2);
  expect(getBatchDisplayStatus(partial).label).toBe("部分完成");
});
```

- [ ] **Step 2: Run coordinator tests and verify failure**

Run: `npm test -- services/productBatchWorkflow.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement phase-by-phase orchestration**

The coordinator must emit a fully serializable batch after every transition: `generating-prompts`, `generating-anchor`, `awaiting-anchor-approval` or `generating-images`, then `completed`/`failed`. Validate both references before automatic start. Generate the anchor alone; only after success construct derived jobs with the anchor data URL snapshot. Run derived jobs through the existing concurrency queue. Mark mixed outcomes as completed data with display status derived as partial completion.

- [ ] **Step 4: Add retry-safe queue behavior**

Ensure coordinator updates replace jobs by ID and never append duplicate jobs when invoked after a persisted phase. Preserve completed jobs and retry only failed/idle work.

- [ ] **Step 5: Run coordinator and queue tests**

Run: `npm test -- services/productBatchWorkflow.test.ts services/productImageQueue.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the coordinator**

```bash
git add services/productBatchWorkflow.ts services/productBatchWorkflow.test.ts services/productImageQueue.ts
git commit -m "feat orchestrate automatic product generation"
```

---

### Task 4: Send the Master Scene as an Independent Image Reference

**Files:**
- Modify: `App.tsx`
- Modify: `services/productImageQueue.ts`
- Modify: `services/productImageQueue.test.ts`

**Interfaces:**
- Consumes: `ImageGeneration.anchorReferenceImageSnapshot`.
- Produces provider reference order: product, master scene when present, style.

- [ ] **Step 1: Add a failing reference-order test**

```ts
expect(buildJobReferences(derivedJob).map(item => item.name)).toEqual([
  "产品参考图",
  "主场景图",
  "风格参考图"
]);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- services/productImageQueue.test.ts`

Expected: FAIL because the helper and master reference do not exist.

- [ ] **Step 3: Export and use `buildJobReferences`**

```ts
export const buildJobReferences = (job: ImageGeneration): ReferenceImageItem[] => [
  { id: "product-reference", name: "产品参考图", imageData: job.productReferenceImageSnapshot },
  ...(job.anchorReferenceImageSnapshot ? [{ id: "anchor-reference", name: "主场景图", imageData: job.anchorReferenceImageSnapshot }] : []),
  ...(job.styleReferenceImageSnapshot ? [{ id: "style-reference", name: "风格参考图", imageData: job.styleReferenceImageSnapshot }] : [])
];
```

Use the helper for normal generation and retries. The provider prompt must state that product is the highest-priority identity reference, master scene locks environment/props/lighting, and style reference only controls tone.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- services/productImageQueue.test.ts`

Expected: PASS.

```bash
git add App.tsx services/productImageQueue.ts services/productImageQueue.test.ts
git commit -m "feat anchor derived images to master scene"
```

---

### Task 5: Mode Controls, Automatic Naming, and Batch Badges

**Files:**
- Modify: `components/ProductSetup.tsx`
- Create: `components/BatchStatusBadge.tsx`
- Modify: `App.tsx`
- Modify: `index.css`

**Interfaces:**
- Consumes: domain mode types and `getBatchDisplayStatus`.
- Produces: accessible segmented controls for operation mode and prompt strategy.

- [ ] **Step 1: Add mode controls to setup**

Render two segmented controls using buttons rather than select menus:

```tsx
<ModeControl label="操作模式" value={batch.workflowMode} options={[
  ["manual", "手动"], ["automatic", "自动"]
]} onChange={workflowMode => onPatch({ workflowMode })} />
<ModeControl label="生成方式" value={batch.promptStrategy} options={[
  ["varied-scenes", "多场景创意"], ["anchored-angles", "同场景多机位"]
]} onChange={promptStrategy => onPatch({ promptStrategy })} />
```

Automatic mode button copy is `开始自动生成 N 张`; manual mode retains `生成 N 条提示词`.

- [ ] **Step 2: Wire filename-based naming**

Pass the original `File.name` into `applyProductReferenceFilename` after image conversion. On direct name input, patch both `name` and `nameSource: "manual"`. Clearing or replacing the reference must not rename a manually named batch.

- [ ] **Step 3: Add batch status badges**

Render `BatchStatusBadge` beneath or beside the batch name with fixed-height colored styles for gray, purple, blue, orange, green, and red. Keep the existing prompt/image counts as secondary text and avoid resizing the row between statuses.

- [ ] **Step 4: Add workflow-aware action states**

Disable automatic start until both references exist. Show exact missing input text near the primary button. In manual anchored mode, show `确认主场景并继续` during `awaiting-anchor-approval`, plus a retry icon on the anchor result.

- [ ] **Step 5: Run typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

- [ ] **Step 6: Commit UI changes**

```bash
git add components/ProductSetup.tsx components/BatchStatusBadge.tsx App.tsx index.css
git commit -m "feat add workflow controls and batch badges"
```

---

### Task 6: Integrate Persistence, Recovery, and End-to-End Actions

**Files:**
- Modify: `App.tsx`
- Modify: `utils/db.test.ts`
- Modify: `components/ResultGallery.tsx`

**Interfaces:**
- Consumes all coordinator functions from Task 3.
- Produces resumable buttons based on persisted `runPhase` without automatically spending credits after page load.

- [ ] **Step 1: Add persistence migration tests**

Verify IndexedDB round trips all workflow fields, scene bible, anchor image ID, and anchor snapshots. Verify old stored records normalize to manual varied-scenes mode.

- [ ] **Step 2: Use persisted run phase for workflow state**

Use `runPhase` for batch status and disable conflicting actions. Keep short-lived React flags only for button double-click protection. Every coordinator `onUpdate` callback must call `updateBatch` so IndexedDB receives intermediate state.

- [ ] **Step 3: Connect the four workflows**

- Manual varied scenes calls the existing prompt-review path.
- Automatic varied scenes calls `runAutomaticProductBatch` and ends on results.
- Manual anchored calls `startManualAnchoredBatch`, displays the anchor, then `continueManualAnchoredBatch` after confirmation.
- Automatic anchored calls `runAutomaticProductBatch` through anchor and derived images.

- [ ] **Step 4: Add recovery actions**

On reload, never silently resume paid requests. Render `继续自动流程` for recoverable generating phases, `重试主场景` for failed/awaiting anchor states, and existing single-job retry for derived failures. Reuse persisted snapshots for every retry.

- [ ] **Step 5: Run the complete automated suite**

Run: `npm test && npx tsc --noEmit && npm run build`

Expected: all tests pass and production build succeeds.

- [ ] **Step 6: Commit integration**

```bash
git add App.tsx components/ResultGallery.tsx utils/db.test.ts
git commit -m "feat integrate resumable product workflows"
```

---

### Task 7: Browser Verification, Production Push, and Vercel Check

**Files:**
- Modify only if verification exposes a defect in files owned by Tasks 1-6.

- [ ] **Step 1: Start the local development server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL and stays running.

- [ ] **Step 2: Verify desktop and mobile layouts**

Use Playwright at 1440×900 and 390×844. Confirm segmented controls, batch status badges, upload cards, action buttons, and result cards do not overlap or resize unpredictably.

- [ ] **Step 3: Verify all four workflows with mocked provider responses**

Intercept OpenRouter and image-provider requests. Assert final counts, manual anchor pause, automatic continuation, shared anchor reference payload, partial completion state, and no duplicate jobs after a simulated reload.

- [ ] **Step 4: Run final repository checks**

Run: `git diff --check && npm test && npx tsc --noEmit && npm run build`

Expected: no whitespace errors, all tests pass, typecheck passes, and build succeeds.

- [ ] **Step 5: Push main and wait for Vercel**

```bash
git push origin main
vercel ls product-image-studio --environment production
```

Expected: the latest production deployment is `Ready` and aliased to `https://chanpinshengtu.vercel.app`.

- [ ] **Step 6: Verify production without spending unexpectedly**

Open the production URL, confirm the new controls and persisted migration, then run one explicitly selected low-count automatic flow only if provider credentials are present. Confirm the production request includes product, master scene, and style references in the required order.
