# Refine Batch Duplication and Muzhi Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make batch copying always available and always create a clean setup batch without prompts or creative guidance, while making Muzhi the default provider for newly created batches.

**Architecture:** Keep copy/reset semantics and new-batch defaults in `domain/productWorkflow.ts`. `App.tsx` only triggers the pure domain helper and no longer disables the copy button while the source batch runs; existing persistence and scheduler isolation remain unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, jsdom, IndexedDB, Vercel CLI.

## Global Constraints

- Copying is allowed during every source-batch run phase and must not stop, cancel, or mutate the source run.
- Every copy clears `creativeGuide`, `prompts`, `images`, `runError`, `sceneBible`, and `anchorImageId`, resets `runPhase` to `idle`, and opens at `stage: "setup"`.
- Every copy preserves both reference images, prompt template, request count, workflow strategy, extension-node configuration, provider/model settings, aspect ratio, image size, and concurrency.
- A copied batch keeps the source provider and model; it is not forced to Muzhi.
- New batches default to `imageProvider: "muzhi"` and `imageModel: "gpt-image-2"`.
- Existing persisted batches are not migrated to Muzhi.
- No database schema, supplier request format, scheduler, key handling, or paid image request changes.
- Preserve unrelated uncommitted README and documentation changes.
- After verification, merge to `main`, push `cunzhang110/product-image-studio`, deploy Vercel project `product-image-studio`, and verify `chanpinshengtu.vercel.app` is `Ready`.

---

### Task 1: Domain copy semantics and new-batch defaults

**Files:**
- Modify: `domain/productWorkflow.ts`
- Test: `domain/productWorkflow.test.ts`

**Interfaces:**
- Consumes: existing `createProductBatch()` and `duplicateProductBatch(source, existingNames)` APIs.
- Produces: unchanged function signatures with revised defaults and copy reset behavior.

- [ ] **Step 1: Change the domain expectations first**

In `domain/productWorkflow.test.ts`, change the new-batch provider assertions to:

```ts
expect(batch.imageProvider).toBe("muzhi");
expect(batch.imageModel).toBe("gpt-image-2");
```

Replace the duplicate test’s retained prompt/guide expectations with:

```ts
expect(copy).toMatchObject({
  name: "婚宴酒 - 副本",
  productReferenceImage: source.productReferenceImage,
  styleReferenceImage: source.styleReferenceImage,
  creativeGuide: "",
  imageProvider: source.imageProvider,
  imageModel: source.imageModel,
  runPhase: "idle",
  sceneBible: "",
  stage: "setup",
  prompts: [],
  images: []
});
expect(source.creativeGuide).toBe("暖色婚宴");
expect(source.prompts).toHaveLength(1);
expect(source.images).toHaveLength(1);
```

Keep the independent extension-node assertion and remove assertions that expect copied prompts or a `review` stage.

- [ ] **Step 2: Add an existing-batch normalization regression assertion**

Extend the persisted-batch migration test with an explicit existing provider:

```ts
const legacy = {
  ...createProductBatch("旧批次"),
  imageProvider: "yunwu",
  imageModel: "gemini-3.1-flash-image-preview",
  referenceImage: "data:image/png;base64,legacy-product",
  productReferenceImage: undefined,
  styleReferenceImage: undefined,
  promptProvider: "yunwu",
  promptModel: "gemini-3-pro-preview"
} as any;
```

Assert normalization preserves:

```ts
imageProvider: "yunwu",
imageModel: "gemini-3.1-flash-image-preview"
```

- [ ] **Step 3: Run the focused domain test and verify RED**

Run:

```bash
npx vitest run domain/productWorkflow.test.ts
```

Expected: FAIL because new batches still default to Yunwu and copies still retain creative guidance/prompts or enter review.

- [ ] **Step 4: Implement the minimum domain changes**

In `createProductBatch()` change:

```ts
imageProvider: "muzhi",
imageModel: "gpt-image-2",
```

In `duplicateProductBatch()` replace copied prompt behavior and conditional stage with:

```ts
creativeGuide: "",
extensionNodes: source.extensionNodes.map(node => ({ ...node, id: createId() })),
prompts: [],
images: [],
runPhase: "idle",
runError: undefined,
sceneBible: "",
anchorImageId: undefined,
stage: "setup",
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run domain/productWorkflow.test.ts utils/workspaceHydration.test.ts
```

Expected: both files pass; hydration-created empty workspaces inherit the new Muzhi default while persisted batches remain unchanged.

- [ ] **Step 6: Commit the domain increment**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "fix: reset copied batches and default to Muzhi"
```

### Task 2: Always-available copy interaction

**Files:**
- Modify: `App.tsx`
- Test: `App.duplicateBatch.test.tsx`

**Interfaces:**
- Consumes: revised `duplicateProductBatch()` from Task 1 and the existing per-batch run registry.
- Produces: an enabled `.duplicate-batch-button` in every run state without touching the source controller.

- [ ] **Step 1: Update the copy interaction tests first**

Change the completed-source test to assert the new copy is clean:

```ts
expect(items[0].textContent).toContain("0 条提示词 · 0 张完成");
expect(saved[0]).toMatchObject({
  name: "婚宴酒 - 副本",
  creativeGuide: "",
  prompts: [],
  images: [],
  stage: "setup",
  runPhase: "idle"
});
```

Replace the running-state disablement test with a running-copy test:

```ts
it("copies a clean setup batch without aborting the active source run", async () => {
  // Arrange the existing ready source and a pending generateImage promise.
  const { container } = await mountApp();
  await flushHydration();
  await act(async () => {
    buttonWithText(container, "生成已选 1 张")?.click();
    await Promise.resolve();
    await Promise.resolve();
  });

  const copyButton = container.querySelector<HTMLButtonElement>(".duplicate-batch-button");
  expect(copyButton?.disabled).toBe(false);
  await act(async () => copyButton?.click());
  expect(container.querySelectorAll(".batch-item")).toHaveLength(2);
  expect(container.querySelector(".batch-item.active")?.textContent).toContain("0 条提示词 · 0 张完成");
  expect(sourceSignal.aborted).toBe(false);
});
```

Capture `sourceSignal` from the final `AbortSignal` argument passed to the mocked `generateImage`, following `App.multiBatch.test.tsx`.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```bash
npx vitest run App.duplicateBatch.test.tsx
```

Expected: FAIL because the copy button remains disabled while the source batch is running.

- [ ] **Step 3: Remove the UI guard and disabled state**

In `App.tsx`, change the handler guard from:

```ts
if (!activeBatch || runningBatchIds.has(activeBatch.id)) return;
```

to:

```ts
if (!activeBatch) return;
```

Render the button without `disabled={generationActive}`:

```tsx
<button className="duplicate-batch-button" onClick={duplicateBatch}>
  <Copy size={14} />复制当前批次
</button>
```

- [ ] **Step 4: Run the focused UI test and verify GREEN**

Run:

```bash
npx vitest run App.duplicateBatch.test.tsx App.multiBatch.test.tsx
```

Expected: both files pass, showing that copying does not abort or reroute active source work.

- [ ] **Step 5: Commit the UI increment**

```bash
git add App.tsx App.duplicateBatch.test.tsx
git commit -m "fix: allow clean copies of running batches"
```

### Task 3: Verification, status documentation, GitHub, and production

**Files:**
- Modify after merge: `docs/CURRENT_STATE.md`

**Interfaces:**
- Consumes: the two verified feature commits.
- Produces: tested `main`, synced GitHub, and a `Ready` Vercel production deployment.

- [ ] **Step 1: Run the complete repository verification**

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all tests pass, TypeScript exits without diagnostics, Vite builds successfully, and whitespace validation passes.

- [ ] **Step 2: Verify the desktop interaction without paid API calls**

Use a local mocked or pending provider response to confirm the copy action remains clickable while a batch is active, the source run remains active, and the selected copy contains zero prompts and zero images. Confirm the browser console has no warnings/errors and the 1440×900 and 390×844 layouts have no horizontal overflow.

- [ ] **Step 3: Merge locally and update current state**

Merge the isolated feature branch into `main`, then update `docs/CURRENT_STATE.md` with:

```md
- 产品批次复制始终创建干净的新一轮：保留参考图和配置，清空提示词、创作引导、结果与运行状态；原批次运行期间也可复制且不会被中止。
- 新建产品批次默认使用 Muzhi `gpt-image-2`；已有及复制来源批次的供应商选择保持不变。
```

Record the actual final test count and deployment ID; do not claim paid image validation.

- [ ] **Step 4: Push main to GitHub**

```bash
git push origin main
```

Expected: `git rev-parse HEAD` equals `git rev-parse origin/main`.

- [ ] **Step 5: Deploy and inspect production**

```bash
deployment_url=$(vercel --prod --yes)
vercel inspect "$deployment_url"
```

Expected: project `product-image-studio`, target `production`, status `Ready`, and alias `https://chanpinshengtu.vercel.app`.
