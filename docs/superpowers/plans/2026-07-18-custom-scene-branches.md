# Custom Same-Scene Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve AI-random same-scene generation and add an editable wine-bottle branch map that controls each derived image in automatic and manual workflows.

**Architecture:** Persist branch mode and nodes on `ProductBatch`. The prompt model creates only the master prompt and scene bible for custom mode; deterministic domain helpers compile each node into a locked derived prompt. Existing workflow coordinators consume the resulting prompt list, while manual continuation rebuilds derived prompts from the latest nodes and reuses the accepted master.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 4, IndexedDB persistence, existing OpenRouter and image-provider services.

## Global Constraints

- Multi-scene creative behavior remains unchanged.
- AI-random same-scene behavior remains available and is the migration default.
- Custom mode starts with the five-node wine-bottle template.
- Custom output count is one master plus the current node count.
- The accepted master image is never regenerated solely because nodes changed.
- Product appearance and existing stop/resume semantics remain unchanged.

---

### Task 1: Persisted Branch Model And Prompt Compiler

**Files:**
- Modify: `domain/productWorkflow.ts`
- Modify: `domain/productWorkflow.test.ts`

**Interfaces:**
- `SameSceneBranchMode = "ai-random" | "custom-map"`
- `ExtensionNodeType = "camera" | "action" | "camera-action"`
- `SceneExtensionNode { id, type, instruction }`
- `createDefaultWineExtensionNodes(): SceneExtensionNode[]`
- `getPlannedImageCount(batch): number`
- `buildCustomBranchPrompt(sceneBible, node): string`
- `buildCustomAnchoredPrompts(batch, anchorPrompt, sceneBible): string[]`

- [ ] **Step 1: Write failing domain tests**

Test migration to `ai-random`, the five exact wine nodes, custom count calculation, and type-specific branch prompt allowances and locks.

- [ ] **Step 2: Verify RED**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: FAIL because branch types and helpers do not exist.

- [ ] **Step 3: Implement the minimal domain model**

Add persisted fields to new/normalized batches. Compile custom prompts in node order, including the master prompt first and explicit product identity locks in every derived prompt.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- domain/productWorkflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "feat: add custom same-scene branch model"
```

### Task 2: Custom Master Prompt Planning

**Files:**
- Modify: `App.tsx`
- Modify: `services/productPromptService.test.ts`

**Interfaces:**
- `requestPromptPlan(batch, signal)` sends `count: 1` for `custom-map` and the existing count for `ai-random`.
- Existing `generateProductPromptPlan` returns a valid anchored plan with zero `anglePrompts` when count is one.

- [ ] **Step 1: Add a failing count-one anchored-plan test**

Assert the request asks for one master and zero random views and that parsing accepts an empty `anglePrompts` array.

- [ ] **Step 2: Verify RED or missing coverage**

Run: `npm test -- services/productPromptService.test.ts`

Expected: the new behavior is either RED because parsing rejects it or demonstrates the service already supports it; in the latter case, retain the regression test and proceed with the App integration.

- [ ] **Step 3: Pass the effective planning count from App**

Use one for custom master planning so OpenRouter does not invent random branches. Keep all other request paths unchanged.

- [ ] **Step 4: Run prompt tests and type-check**

Run: `npm test -- services/productPromptService.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx services/productPromptService.test.ts
git commit -m "feat: plan only the custom master scene"
```

### Task 3: Automatic And Manual Custom Workflows

**Files:**
- Modify: `services/productBatchWorkflow.ts`
- Modify: `services/productBatchWorkflow.test.ts`

**Interfaces:**
- `preparePrompts` uses custom branch compilation when `sameSceneBranchMode === "custom-map"`.
- `continueManualAnchoredBatch` recompiles derived prompts from the latest nodes before creating jobs.
- `resumeProductBatch` uses the latest persisted nodes and skips completed jobs by ID/prompt position where possible.

- [ ] **Step 1: Write failing workflow tests**

Test automatic custom generation, manual pause plus node edit before continuation, master reuse, latest node order, and preservation of existing AI-random tests.

- [ ] **Step 2: Verify RED**

Run: `npm test -- services/productBatchWorkflow.test.ts`

Expected: FAIL because custom nodes are not compiled into jobs.

- [ ] **Step 3: Implement custom workflow preparation**

Build prompt variants from the master prompt and nodes. On manual continuation, retain the completed anchor and replace only derived variants/jobs. Keep random flow untouched.

- [ ] **Step 4: Verify workflow and full tests**

Run: `npm test -- services/productBatchWorkflow.test.ts && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/productBatchWorkflow.ts services/productBatchWorkflow.test.ts
git commit -m "feat: run custom same-scene branches"
```

### Task 4: Branch Map Editor

**Files:**
- Create: `components/SceneExtensionEditor.tsx`
- Modify: `components/ProductSetup.tsx`
- Modify: `App.tsx`
- Modify: `index.css`

**Interfaces:**
- `SceneExtensionEditor { nodes, onChange, disabled }`
- Product setup exposes `AI 随机延伸` and `自定义思维导图` only under same-scene generation.
- Switching to custom mode populates defaults only when no nodes exist.

- [ ] **Step 1: Build the editor with established controls**

Render a master root and connected child list. Each child has a type select, textarea, copy, up/down, and delete icon controls. Add `添加延伸节点` and `恢复酒瓶模板` commands.

- [ ] **Step 2: Integrate quantity and validation copy**

Hide prompt count in custom mode, show `预计生成 N 张（主图 1 张 + 分支 M 张）`, and update setup/execution buttons to use the planned count.

- [ ] **Step 3: Add start validation**

Block empty custom maps and empty node instructions with clear Chinese errors. Disable editing during an automatic active run; allow editing after a manual master pause.

- [ ] **Step 4: Add responsive styling**

Use compact square controls, stable node dimensions, visible connectors, and a single-column mobile layout without nested cards or overlap.

- [ ] **Step 5: Verify TypeScript, tests, and build**

Run: `npx tsc --noEmit && npm test && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/SceneExtensionEditor.tsx components/ProductSetup.tsx App.tsx index.css
git commit -m "feat: add editable scene branch map"
```

### Task 5: Review, Browser Verification, And Deployment

**Files:**
- No source changes expected unless verification finds a defect.

**Interfaces:**
- Production remains `https://chanpinshengtu.vercel.app`.

- [ ] **Step 1: Request focused code review**

Review migration, prompt locking, manual node edits, resume behavior, and regressions in multi-scene/random modes. Fix all critical and important findings with regression tests.

- [ ] **Step 2: Run final verification**

Run: `npm test && npx tsc --noEmit && npm run build && git diff --check`

Expected: all tests, type-check, production build, and whitespace checks PASS.

- [ ] **Step 3: Verify desktop and mobile UI**

Run the production preview and inspect random/custom switching, five defaults, node edit/copy/reorder/delete, planned count, manual-awaiting-master editing, and mobile layout.

- [ ] **Step 4: Merge, push, and deploy**

Merge the isolated feature branch into `main`, push `origin/main`, deploy Vercel production, and confirm deployment status `Ready` with the `chanpinshengtu.vercel.app` alias.
