# Product Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a complete single-product workflow that turns one reference image, a prompt template, and creative guidance into reviewed prompts and then batch-generated images.

**Architecture:** Keep the existing provider adapters as the image-generation boundary. Add a small product-batch domain module, a multimodal prompt-generation function, IndexedDB persistence, and focused React workspace components controlled by a new App shell.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest, existing Yunwu/APIMart/Muzhi adapters, IndexedDB, JSZip.

## Global Constraints

- Work only in `cunzhang110/product-image-studio`; do not modify `cunzhang110/piliangchutu`.
- Each batch has exactly one product and one product reference image.
- The same reference image is sent to the prompt AI and every image task.
- Prompt review is mandatory before image generation.
- Do not add automatic product-consistency checking.
- Keep Yunwu on `gemini-3.1-flash-image-preview` and APIMart/Muzhi on `gpt-image-2`.
- Deploy publicly to `https://chanpinshengtu.vercel.app`.

---

### Task 1: Product Batch Domain

**Files:**
- Create: `domain/productWorkflow.ts`
- Create: `domain/productWorkflow.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ProductBatch`, `PromptVariant`, `ImageGeneration`, `createProductBatch()`, `parsePromptList()`, `createImageJobs()`.

- [ ] **Step 1: Install Vitest and add a test script**

Run: `npm install --save-dev vitest`

Add `"test": "vitest run"` to `package.json`.

- [ ] **Step 2: Write failing domain tests**

```ts
import { describe, expect, it } from "vitest";
import { createImageJobs, createProductBatch, parsePromptList } from "./productWorkflow";

describe("product workflow", () => {
  it("creates a single-reference product batch", () => {
    const batch = createProductBatch("新品饮料");
    expect(batch.name).toBe("新品饮料");
    expect(batch.referenceImage).toBe("");
    expect(batch.prompts).toEqual([]);
  });

  it("parses a JSON prompt array and removes empty duplicates", () => {
    expect(parsePromptList('["场景 A", "场景 A", "", "场景 B"]')).toEqual(["场景 A", "场景 B"]);
  });

  it("creates jobs only for selected prompts", () => {
    const batch = createProductBatch("产品");
    batch.referenceImage = "data:image/png;base64,abc";
    batch.prompts = [
      { id: "p1", prompt: "A", selected: true, status: "ready", createdAt: 1, updatedAt: 1 },
      { id: "p2", prompt: "B", selected: false, status: "ready", createdAt: 1, updatedAt: 1 }
    ];
    expect(createImageJobs(batch)).toHaveLength(1);
    expect(createImageJobs(batch)[0].referenceImageSnapshot).toBe(batch.referenceImage);
  });
});
```

- [ ] **Step 3: Run RED test**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: FAIL because `domain/productWorkflow.ts` does not exist.

- [ ] **Step 4: Implement the minimal domain module**

Create typed batch, prompt, and image job factories. `parsePromptList()` accepts a JSON array or a newline list, trims entries, and removes duplicates. `createImageJobs()` snapshots the batch reference image and selected prompt.

- [ ] **Step 5: Run GREEN test**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: 3 tests pass.

### Task 2: Multimodal Prompt Generation

**Files:**
- Create: `services/productPromptService.ts`
- Create: `services/productPromptService.test.ts`
- Modify: `services/geminiService.ts`

**Interfaces:**
- Consumes: `ServiceProvider`, browser-stored provider keys, `parsePromptList()`.
- Produces: `generateProductPrompts(input): Promise<string[]>`.

- [ ] **Step 1: Write failing request-builder tests**

Test that Yunwu receives text plus `inline_data`, APIMart receives a user content array with `image_url`, the requested count is present, and Muzhi is rejected as a prompt provider.

- [ ] **Step 2: Run RED test**

Run: `npm test -- services/productPromptService.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement request builders and generation**

The system instruction must preserve visible product identity, avoid inventing hidden angles, vary scene/composition/light, and return only a JSON string array. Reuse an exported authenticated JSON request helper from `geminiService.ts`.

- [ ] **Step 4: Run GREEN test**

Run: `npm test -- services/productPromptService.test.ts`

Expected: all prompt-service tests pass.

### Task 3: Product Workspace UI

**Files:**
- Replace: `App.tsx`
- Create: `components/ProductSetup.tsx`
- Create: `components/PromptReview.tsx`
- Create: `components/ResultGallery.tsx`
- Create: `components/ProviderSettings.tsx`
- Replace: `index.css`
- Modify: `index.html`
- Modify: `metadata.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: domain factories and prompt-generation service.
- Produces: a three-stage workspace: setup, prompt review, results.

- [ ] **Step 1: Add Lucide React**

Run: `npm install lucide-react`

- [ ] **Step 2: Implement a quiet production workspace**

Use a compact dark top bar, a narrow batch rail, an unframed main work area, and a stable right execution panel. The setup stage contains one product image drop zone, template, creative guide, prompt count, and generate-prompts command. The review stage contains editable rows, selection controls, regeneration, append, and a visible selected count. The result stage contains stable-ratio image tiles and task status.

- [ ] **Step 3: Add responsive states**

Desktop uses three columns. Tablet collapses the right panel below the main workspace. Mobile uses a single column with a sticky bottom primary action and no overlapping controls.

- [ ] **Step 4: Verify type and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

### Task 4: Image Queue, Persistence, and Downloads

**Files:**
- Modify: `App.tsx`
- Create: `services/productImageQueue.ts`
- Create: `services/productImageQueue.test.ts`
- Modify: `utils/db.ts`

**Interfaces:**
- Consumes: `createImageJobs()`, `generateImage()`, batch image provider settings.
- Produces: `runProductImageJobs()`, `saveProductBatchesToDB()`, `loadProductBatchesFromDB()`.

- [ ] **Step 1: Write failing queue tests**

Test that the queue sends the reference snapshot with every selected prompt, respects concurrency, retains successful jobs when one job fails, and returns clear per-job errors.

- [ ] **Step 2: Run RED test**

Run: `npm test -- services/productImageQueue.test.ts`

Expected: FAIL because the queue service does not exist.

- [ ] **Step 3: Implement queue and storage**

Bind the product image through a synthetic reference mention passed only to the adapter boundary. Persist batches in an IndexedDB `productBatches` store. Add single-image download and current-batch ZIP download.

- [ ] **Step 4: Run GREEN test and full suite**

Run: `npm test`

Expected: all tests pass.

### Task 5: Production Delivery

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: public production deployment and documented project URL.

- [ ] **Step 1: Verify locally**

Run: `npm test && npx tsc --noEmit && npm run build`

Expected: tests pass and build exits 0.

- [ ] **Step 2: Inspect the production UI**

Run a local Vite server and verify desktop/mobile screenshots with browser tooling. Check that reference upload, prompt generation controls, selection, settings, and result tiles do not overlap.

- [ ] **Step 3: Commit and push**

Merge `codex/product-workflow` into `main`, push `main`, and confirm the GitHub-connected Vercel project starts a production deployment.

- [ ] **Step 4: Verify public production**

Confirm the deployment is `Ready`, `chanpinshengtu.vercel.app` is a project domain, production functions exist, and the public URL does not require Vercel login.
