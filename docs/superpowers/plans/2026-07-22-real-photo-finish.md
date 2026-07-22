# Real Photo Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add realistic-photography prompt constraints and optional browser-local photo finishing while preserving every original generated image.

**Architecture:** Store a batch-level `photoFinishLevel` and an optional `finishedResultUrl` beside each original `resultUrl`. A focused Canvas service applies conservative, dimension-preserving adjustments; App orchestration runs it after supplier completion and ResultGallery selects original or finished output without changing provider behavior.

**Tech Stack:** React 19, TypeScript 5.8, Canvas 2D, Vitest 4, jsdom, IndexedDB.

## Global Constraints

- Levels are `off`, `subtle`, and `natural`; new and legacy batches default to `subtle`.
- Never overwrite `resultUrl`; store local output in `finishedResultUrl`.
- Preserve pixel dimensions and aspect ratio; do not crop, scale, geometrically deform, or call an AI API.
- Retry and regeneration clear stale `finishedResultUrl`.
- Downloads prefer `finishedResultUrl` when present and otherwise use `resultUrl`.
- Use the user-facing name “实拍质感优化”; do not claim detector evasion.

---

### Task 1: Domain fields and realistic prompt rules

**Files:**
- Modify: `domain/productWorkflow.ts`
- Modify: `services/productPromptService.ts`
- Test: `domain/productWorkflow.test.ts`
- Test: `services/productPromptService.test.ts`

**Interfaces:**
- Produces `PhotoFinishLevel = "off" | "subtle" | "natural"`.
- Adds `ProductBatch.photoFinishLevel` and `ImageGeneration.finishedResultUrl?`.

- [ ] Add failing tests asserting new/normalized batches use `subtle`, copied batches preserve the level, and both prompt strategies include contact-shadow, realistic-lighting, material, perspective, and no-overprocessing constraints.
- [ ] Run `npx vitest run domain/productWorkflow.test.ts services/productPromptService.test.ts` and confirm failure.
- [ ] Add the fields, defaults, normalization, and a shared `REAL_PHOTO_RULES` instruction included by both prompt builders.
- [ ] Run the focused tests and confirm pass.
- [ ] Commit with `git commit -m "feat: add realistic photo prompt controls"`.

### Task 2: Dimension-preserving local finish service

**Files:**
- Create: `services/photoFinishService.ts`
- Create: `services/photoFinishService.test.ts`

**Interfaces:**
- Produces `applyPhotoFinish(dataUrl: string, level: PhotoFinishLevel): Promise<string>`.
- Produces `preferredImageUrl(job: ImageGeneration): string | undefined`.

- [ ] Add failing tests: `off` returns the same URL, preferred output selects finished then original, and Canvas output keeps input width/height.
- [ ] Run `npx vitest run services/photoFinishService.test.ts` and confirm failure.
- [ ] Implement image decode, same-size Canvas drawing, conservative tone adjustments, deterministic low-amplitude luminance grain, JPEG quality `0.94` for `subtle` and `0.92` for `natural`, and original-image fallback on decode/Canvas failure.
- [ ] Run the focused test and confirm pass.
- [ ] Commit with `git commit -m "feat: add local real photo finishing"`.

### Task 3: Workflow, controls, preview, retry, and downloads

**Files:**
- Modify: `App.tsx`
- Modify: `components/ResultGallery.tsx`
- Modify: `index.css`
- Modify: `App.multiBatch.test.tsx`
- Create: `components/ResultGallery.test.tsx`

**Interfaces:**
- App applies `applyPhotoFinish()` to newly completed jobs using the batch snapshot level.
- ResultGallery accepts `onRefinish(job)` and displays `preferredImageUrl(job)` with original/finished toggles.

- [ ] Add failing tests for automatic finish storage without overwriting original, retry clearing `finishedResultUrl`, original/finished toggle, re-finish action, and preferred single/ZIP download.
- [ ] Run `npx vitest run App.multiBatch.test.tsx components/ResultGallery.test.tsx` and confirm failure.
- [ ] Add the three-level execution setting, post-completion finishing, re-finish handler, retry cleanup, preview toggle, and preferred downloads.
- [ ] Add compact responsive styles and keep the existing 390px layout overflow-free.
- [ ] Run focused tests and confirm pass.
- [ ] Commit with `git commit -m "feat: integrate real photo finishing workflow"`.

### Task 4: Verification and delivery

**Files:**
- Modify after merge: `docs/CURRENT_STATE.md`

- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [ ] Verify desktop 1440×900 and mobile 390×844 locally: no horizontal overflow, result toggle works, and browser console has no warnings/errors.
- [ ] Merge to `main`, update `docs/CURRENT_STATE.md` with actual test count and feature state, then re-run verification.
- [ ] Push `main` to GitHub.
- [ ] Run `vercel --prod --yes`, inspect the returned deployment, and confirm status `Ready` with alias `chanpinshengtu.vercel.app`.
