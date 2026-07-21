# Duplicate Product Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a “复制当前批次” action that creates a new batch with the same references, settings, and prompts, while clearing all image jobs and runtime state.

**Architecture:** Put all copy semantics in a pure `duplicateProductBatch(source, existingNames)` domain helper so React only performs list insertion, selection, and feedback. Reuse the existing debounced IndexedDB persistence; no schema change or supplier request is required.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, jsdom, IndexedDB persistence through the existing `utils/db.ts` layer.

## Global Constraints

- Preserve style reference image, product reference image, prompts, prompt selection, workflow settings, provider settings, and extension-node configuration.
- Clear all image jobs/results, `runError`, `sceneBible`, and `anchorImageId`; reset `runPhase` to `idle`.
- A copy with prompts opens at `review`; a copy without prompts opens at `setup`.
- Names progress as `原名称 - 副本`, `原名称 - 副本 2`, `原名称 - 副本 3` based on all current batch names.
- Create independent prompt and extension-node objects with new IDs; reference-image data URLs may be reused as immutable strings.
- Insert the copy at the top, select it immediately, and disable copying while the source batch is running.
- Do not add a confirmation dialog, copy-mode selector, database migration, supplier call, or scheduler registration.
- Preserve all unrelated uncommitted files and changes.

---

### Task 1: Domain-level batch duplication

**Files:**
- Modify: `domain/productWorkflow.ts`
- Test: `domain/productWorkflow.test.ts`

**Interfaces:**
- Consumes: `ProductBatch`, the existing private `createId(): string`, and `existingNames: Iterable<string>`.
- Produces: `duplicateProductBatch(source: ProductBatch, existingNames: Iterable<string>): ProductBatch`.

- [ ] **Step 1: Add failing domain tests for retained and reset fields**

Extend the import in `domain/productWorkflow.test.ts` with `duplicateProductBatch`, then add:

```ts
it("duplicates references, settings, and prompts while clearing generated state", () => {
  const source = createProductBatch("婚宴酒");
  source.nameSource = "manual";
  source.productReferenceImage = "data:image/png;base64,product";
  source.styleReferenceImage = "data:image/png;base64,style";
  source.creativeGuide = "暖色婚宴";
  source.workflowMode = "automatic";
  source.promptStrategy = "anchored-angles";
  source.sameSceneBranchMode = "custom-map";
  source.extensionNodes = [{ id: "node-1", type: "camera", instruction: "左侧近景" }];
  source.prompts = [{ id: "prompt-1", prompt: "宴会桌面", selected: false, status: "ready", createdAt: 1, updatedAt: 2 }];
  source.images = createImageJobs({ ...source, prompts: source.prompts.map(prompt => ({ ...prompt, selected: true })) });
  source.runPhase = "completed";
  source.runError = "old error";
  source.sceneBible = "old scene";
  source.anchorImageId = "old-anchor";
  source.stage = "results";

  const copy = duplicateProductBatch(source, [source.name]);

  expect(copy).toMatchObject({
    name: "婚宴酒 - 副本",
    nameSource: "automatic",
    productReferenceImage: source.productReferenceImage,
    styleReferenceImage: source.styleReferenceImage,
    creativeGuide: "暖色婚宴",
    workflowMode: "automatic",
    promptStrategy: "anchored-angles",
    sameSceneBranchMode: "custom-map",
    runPhase: "idle",
    sceneBible: "",
    stage: "review",
    images: []
  });
  expect(copy.id).not.toBe(source.id);
  expect(copy.runError).toBeUndefined();
  expect(copy.anchorImageId).toBeUndefined();
  expect(copy.prompts).toEqual([{ ...source.prompts[0], id: expect.any(String) }]);
  expect(copy.prompts[0]).not.toBe(source.prompts[0]);
  expect(copy.extensionNodes[0]).not.toBe(source.extensionNodes[0]);
  expect(copy.extensionNodes[0].id).not.toBe(source.extensionNodes[0].id);
});
```

- [ ] **Step 2: Add failing domain tests for naming and empty-prompt stage**

Add:

```ts
it("increments duplicate names and keeps an empty copy in setup", () => {
  const source = createProductBatch("婚宴酒");
  const first = duplicateProductBatch(source, ["婚宴酒"]);
  const second = duplicateProductBatch(source, ["婚宴酒", "婚宴酒 - 副本"]);
  const third = duplicateProductBatch(source, ["婚宴酒", "婚宴酒 - 副本", "婚宴酒 - 副本 2"]);

  expect([first.name, second.name, third.name]).toEqual([
    "婚宴酒 - 副本",
    "婚宴酒 - 副本 2",
    "婚宴酒 - 副本 3"
  ]);
  expect(first.stage).toBe("setup");
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx vitest run domain/productWorkflow.test.ts
```

Expected: FAIL because `duplicateProductBatch` is not exported.

- [ ] **Step 4: Implement the pure duplication helper**

Add after `createProductBatch()` in `domain/productWorkflow.ts`:

```ts
const getDuplicateBatchName = (sourceName: string, existingNames: Iterable<string>) => {
  const occupied = new Set(Array.from(existingNames, name => name.trim()));
  const baseName = `${sourceName.trim() || "未命名产品"} - 副本`;
  if (!occupied.has(baseName)) return baseName;
  let index = 2;
  while (occupied.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
};

export const duplicateProductBatch = (
  source: ProductBatch,
  existingNames: Iterable<string>
): ProductBatch => {
  const now = Date.now();
  return {
    ...source,
    id: createId(),
    name: getDuplicateBatchName(source.name, existingNames),
    nameSource: "automatic",
    extensionNodes: source.extensionNodes.map(node => ({ ...node, id: createId() })),
    prompts: source.prompts.map(prompt => ({ ...prompt, id: createId() })),
    images: [],
    runPhase: "idle",
    runError: undefined,
    sceneBible: "",
    anchorImageId: undefined,
    stage: source.prompts.length > 0 ? "review" : "setup",
    createdAt: now,
    updatedAt: now
  };
};
```

- [ ] **Step 5: Run domain tests and verify GREEN**

Run:

```bash
npx vitest run domain/productWorkflow.test.ts
```

Expected: the focused test file passes.

- [ ] **Step 6: Commit the domain increment**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "feat: define product batch duplication"
```

### Task 2: Batch-rail copy action and persistence

**Files:**
- Modify: `App.tsx`
- Modify: `index.css`
- Create: `App.duplicateBatch.test.tsx`

**Interfaces:**
- Consumes: `duplicateProductBatch(source: ProductBatch, existingNames: Iterable<string>): ProductBatch` from Task 1, `runningBatchIds: Set<string>`, and the existing debounced `saveProductBatchesToDB()` effect.
- Produces: a `.duplicate-batch-button` UI action which inserts and selects the copy without starting workflow or supplier work.

- [ ] **Step 1: Add a failing interaction test for copying and automatic persistence**

Create `App.duplicateBatch.test.tsx` with the same jsdom database mocks and mount/cleanup pattern used by `App.hydration.test.tsx`. Its main test must arrange a source batch with one prompt and one completed image, click `.duplicate-batch-button`, advance the existing 250 ms save timer, and assert:

```ts
it("copies the active batch, selects it, clears results, and persists both batches", async () => {
  const source = createProductBatch("婚宴酒");
  source.productReferenceImage = "data:image/png;base64,product";
  source.styleReferenceImage = "data:image/png;base64,style";
  source.stage = "results";
  source.runPhase = "completed";
  source.prompts = [{ id: "prompt-1", prompt: "宴会桌面", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
  source.images = [{
    ...createImageJobs(source)[0],
    status: "completed",
    resultUrl: "data:image/png;base64,result"
  }];
  dbMocks.loadBatches.mockResolvedValue([source]);

  const { container } = await mountApp();
  await flushHydration();
  await act(async () => {
    container.querySelector<HTMLButtonElement>(".duplicate-batch-button")?.click();
  });

  const items = container.querySelectorAll(".batch-item");
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toContain("婚宴酒 - 副本");
  expect(items[0].classList.contains("active")).toBe(true);
  expect(items[0].textContent).toContain("1 条提示词 · 0 张完成");
  expect(container.textContent).toContain("已复制产品批次");

  await act(async () => vi.advanceTimersByTimeAsync(250));
  const saved = dbMocks.saveBatches.mock.calls.at(-1)?.[0] as ProductBatch[];
  expect(saved).toHaveLength(2);
  expect(saved[0]).toMatchObject({ name: "婚宴酒 - 副本", images: [], stage: "review", runPhase: "idle" });
  expect(saved[1]).toEqual(source);
});
```

Include local helpers `mountApp()` and `flushHydration()` exactly as asynchronous React `act()` wrappers, reset all six DB mocks in `beforeEach`, enable fake timers, and unmount every root in `afterEach`.

- [ ] **Step 2: Add a failing interaction test for running-state disablement**

In the same test file, mock `services/geminiService.generateImage` with a never-settling promise, load a ready manual batch, click its “生成已选 1 张” button, then assert:

```ts
const copyButton = container.querySelector<HTMLButtonElement>(".duplicate-batch-button");
expect(copyButton?.disabled).toBe(true);
expect(container.querySelectorAll(".batch-item")).toHaveLength(1);
```

Unmounting the app must abort the pending run, following the existing App test cleanup pattern.

- [ ] **Step 3: Run the focused UI test and verify RED**

Run:

```bash
npx vitest run App.duplicateBatch.test.tsx
```

Expected: FAIL because `.duplicate-batch-button` does not exist.

- [ ] **Step 4: Add the copy action to App**

In `App.tsx`:

1. Add `Copy` to the `lucide-react` import.
2. Add `duplicateProductBatch` to the `domain/productWorkflow` import.
3. Add this handler next to `createBatch` and `deleteBatch`:

```ts
const duplicateBatch = () => {
  if (!activeBatch || runningBatchIds.has(activeBatch.id)) return;
  const copy = duplicateProductBatch(activeBatch, batches.map(batch => batch.name));
  setBatches(current => [copy, ...current]);
  setActiveBatchId(copy.id);
  showToast("已复制产品批次", "success");
};
```

4. Insert this button between the existing new and delete actions:

```tsx
<button
  className="duplicate-batch-button"
  disabled={generationActive}
  onClick={duplicateBatch}
>
  <Copy size={14} />复制当前批次
</button>
```

- [ ] **Step 5: Style the action consistently on desktop and mobile**

Update `index.css` so the copy action shares layout with the other rail actions:

```css
.new-batch-button, .duplicate-batch-button, .delete-batch-button {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 800;
}
.duplicate-batch-button {
  margin-top: 6px;
  color: #334155;
  background: #fff;
  border: 1px solid var(--line);
}
.duplicate-batch-button:hover:not(:disabled) { background: #f8fafc; }
```

Extend the existing mobile hide selector to:

```css
.rail-heading, .new-batch-button, .duplicate-batch-button, .delete-batch-button { display: none; }
```

- [ ] **Step 6: Run the focused UI test and verify GREEN**

Run:

```bash
npx vitest run App.duplicateBatch.test.tsx
```

Expected: both copy interaction tests pass without React act warnings or unhandled rejections.

- [ ] **Step 7: Run the complete required verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all tests pass, TypeScript exits with no diagnostics, Vite builds successfully, and whitespace validation passes.

- [ ] **Step 8: Update current-state documentation**

Add the implemented copy behavior and the final verification counts to `docs/CURRENT_STATE.md`. Preserve the existing deployment status and unresolved P1–P4 items; do not claim production deployment or real-image verification.

- [ ] **Step 9: Commit the UI increment**

```bash
git add App.tsx index.css App.duplicateBatch.test.tsx docs/CURRENT_STATE.md
git commit -m "feat: duplicate product batches"
```
