# Reference Fidelity And Stop Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the uploaded product exactly by removing the style image from image-generation requests, and add reliable stop/resume behavior across prompt and image workflows.

**Architecture:** Request preparation owns reference-role enforcement, while a shared `AbortSignal` flows from `App.tsx` through workflow, queue, prompt, and provider services. Persisted `stopped` states make resume deterministic: completed work is reused and only unfinished work is dispatched.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, browser Fetch/AbortController, Vercel.

## Global Constraints

- Style references are used only for prompt generation and are never sent to an image-generation provider.
- Master images receive the product reference only; derived images receive product then master scene.
- Completed images survive stop and resume and are never regenerated.
- Abort outcomes display as stopped, not failed.
- Existing Muzhi master-scene compression remains active.

---

### Task 1: Product-First Reference Requests

**Files:**
- Modify: `services/productImageQueue.test.ts`
- Modify: `services/productImageQueue.ts`
- Modify: `services/geminiService.ts`
- Test: `services/productImageQueue.test.ts`

**Interfaces:**
- `buildJobReferences(job: ImageGeneration): ReferenceImageItem[]` returns product only for standard/anchor jobs and product plus anchor for derived jobs.
- `generateImage(..., referencePrompt?: string, signal?: AbortSignal): Promise<string>` sends the role-aware prompt to providers.

- [ ] **Step 1: Write failing reference-set tests**

Add tests asserting standard and anchor jobs return only `产品参考图`, while derived jobs return `产品参考图`, `主场景图` and never `风格参考图`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- services/productImageQueue.test.ts`

Expected: FAIL because current standard/anchor reference sets include the style image.

- [ ] **Step 3: Implement product-first request preparation**

Change `buildJobReferences` so style snapshots remain stored on jobs but are excluded from provider requests. Keep anchor optimization in `prepareJobReferencesForRequest` for derived jobs.

Change Muzhi prompt construction to call `buildMuzhiReferencePrompt(referencePrompt || prompt, referencedImages)`, ensuring the product-preservation text reaches the provider instead of being used only for mention matching.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- services/productImageQueue.test.ts && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/productImageQueue.ts services/productImageQueue.test.ts services/geminiService.ts
git commit -m "fix: preserve product reference in image requests"
```

### Task 2: Cancellation State And Queue

**Files:**
- Modify: `domain/productWorkflow.ts`
- Modify: `domain/productWorkflow.test.ts`
- Modify: `services/productImageQueue.ts`
- Modify: `services/productImageQueue.test.ts`

**Interfaces:**
- `ImageJobStatus` adds `stopped`.
- `BatchRunPhase` adds `stopped`.
- `runProductImageJobs(..., onUpdate?, signal?: AbortSignal)` stops claiming jobs and returns unfinished jobs with `status: "stopped"`.
- `isGenerationAbort(error: unknown): boolean` identifies browser abort outcomes.

- [ ] **Step 1: Write failing state and queue tests**

Test that `getBatchDisplayStatus` returns orange `已停止`. Test a concurrency-one queue where the first worker aborts the controller: only one worker call occurs, the first and remaining jobs become stopped, and an already-completed input job is preserved.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- domain/productWorkflow.test.ts services/productImageQueue.test.ts`

Expected: type/test failures because stopped states and queue signals do not exist.

- [ ] **Step 3: Implement stop-aware state and queue**

Extend domain unions and normalization. Update queue initialization to preserve completed jobs, check `signal.aborted` before claiming work, classify abort exceptions as stopped, and normalize undispatched jobs to stopped after workers settle.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- domain/productWorkflow.test.ts services/productImageQueue.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts services/productImageQueue.ts services/productImageQueue.test.ts
git commit -m "feat: add stoppable image queue state"
```

### Task 3: Abort Provider And Prompt Requests

**Files:**
- Modify: `services/geminiService.ts`
- Modify: `services/productPromptService.ts`
- Modify: `services/productPromptService.test.ts`
- Modify: `App.tsx`

**Interfaces:**
- `generateProductPromptPlan(input, signal?: AbortSignal)` and `generateProductPrompts(input, signal?: AbortSignal)` pass the signal to Fetch.
- `generateImage(..., referencePrompt?, signal?)` passes the signal through task creation, polling, image download, and Muzhi direct generation.
- Abortable waits reject promptly instead of sleeping until the next poll.

- [ ] **Step 1: Write a failing prompt-request signal test**

Add a test that stubs `fetch`, passes an `AbortSignal`, and asserts the request receives that exact signal.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- services/productPromptService.test.ts`

Expected: FAIL because prompt service functions do not accept a signal.

- [ ] **Step 3: Thread AbortSignal through network helpers**

Pass signals in every relevant `RequestInit`. Add an abortable delay for provider polling/rate-limit waits and pass the signal to image URL downloads. Preserve abort identity in service error mapping.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- services/productPromptService.test.ts && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/geminiService.ts services/productPromptService.ts services/productPromptService.test.ts
git commit -m "feat: abort active provider requests"
```

### Task 4: Stop-Aware Workflow And Resume

**Files:**
- Modify: `services/productBatchWorkflow.ts`
- Modify: `services/productBatchWorkflow.test.ts`

**Interfaces:**
- Workflow dependencies accept `signal: AbortSignal` for prompt plans and queues.
- Existing workflow functions accept an optional signal and return `runPhase: "stopped"` on cancellation.
- `resumeProductBatch(input, dependencies, onUpdate, signal)` reuses completed images and runs only unfinished work.

- [ ] **Step 1: Write failing workflow tests**

Cover cancellation during prompt generation, cancellation after a completed anchor, automatic resume of derived jobs, and manual resume that preserves the anchor and approval semantics.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- services/productBatchWorkflow.test.ts`

Expected: FAIL because workflows do not accept cancellation or resume.

- [ ] **Step 3: Implement cancellation checkpoints and resume selection**

Check the signal between phases, convert aborts to a stopped batch, and filter completed job IDs before dispatch. Reuse a completed anchor and its result URL for derived jobs. Restart prompt planning only when no usable prompt plan exists.

- [ ] **Step 4: Run workflow and full tests**

Run: `npm test -- services/productBatchWorkflow.test.ts && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/productBatchWorkflow.ts services/productBatchWorkflow.test.ts
git commit -m "feat: resume unfinished product workflows"
```

### Task 5: Stop And Continue Controls

**Files:**
- Modify: `App.tsx`
- Modify: `index.css`

**Interfaces:**
- One `AbortController` ref owns the current run.
- `handleStopGeneration()` aborts and persists stopped state.
- `handleResumeGeneration()` creates a fresh controller and resumes unfinished work.

- [ ] **Step 1: Add controller lifecycle and stale-run protection**

Create a fresh controller for every start/resume, pass it through all request paths, and update state only when the callback still belongs to the current controller.

- [ ] **Step 2: Add execution-panel controls**

Show a red `停止生成` button during prompt, anchor, and image phases. Show `继续剩余任务` for stopped batches. Keep download available when completed results exist.

- [ ] **Step 3: Style stable controls**

Add a restrained danger button style matching existing dimensions, with no layout shift when controls change.

- [ ] **Step 4: Verify TypeScript, tests, and production build**

Run: `npx tsc --noEmit && npm test && npm run build`

Expected: type-check, all tests, and Vite production build PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx index.css
git commit -m "feat: add generation stop and continue controls"
```

### Task 6: Browser Verification And Deployment

**Files:**
- No source changes expected unless verification reveals a defect.

**Interfaces:**
- Production URL remains `https://chanpinshengtu.vercel.app`.

- [ ] **Step 1: Start the local production preview**

Run: `npm run build && npm run preview -- --host 127.0.0.1`

Expected: Vite reports a reachable local preview URL.

- [ ] **Step 2: Verify stop/resume and reference payload in browser**

Using mocked network responses, confirm the master request contains one product image and no style image; confirm stop prevents the next queued request; confirm continue skips completed images.

- [ ] **Step 3: Push main and deploy Vercel production**

Run: `git push origin main` and the repository's existing production deployment command.

Expected: remote main advances and Vercel reports Ready.

- [ ] **Step 4: Smoke-test production**

Open `https://chanpinshengtu.vercel.app`, verify the new controls render, the latest asset is served, and no console/runtime errors appear.
