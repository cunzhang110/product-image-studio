# Task 2 Report: Template Preference Persistence and Batch Inheritance

## Status

Implemented and verified.

## Files

- `utils/db.ts`: Added prompt-template preference read/write functions using the existing `settings` object store.
- `utils/db.test.ts`: Added an IndexedDB regression test for missing, empty, and populated preferences.
- `App.tsx`: Loads the preference during hydration and applies it only to newly created batches.

## RED

Command:

```sh
npx vitest run utils/db.test.ts
```

Output:

```text
Test Files  1 failed (1)
Tests  1 failed | 1 passed (2)

FAIL  utils/db.test.ts > prompt template preference database > distinguishes a missing template preference from a saved empty template
TypeError: loadPromptTemplatePreference is not a function
```

This is the expected failure: the new persistence API had not yet been exported.

## GREEN

Command:

```sh
npx vitest run utils/db.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
```

Full verification command:

```sh
npx vitest run domain/productWorkflow.test.ts utils/db.test.ts && npx tsc --noEmit
```

Output:

```text
Test Files  2 passed (2)
Tests  17 passed (17)
```

`npx tsc --noEmit` completed successfully with no output.

## Commit

SHA: `16b145d8a588c566f66d945f7f052a3df2cd23f5`

## Self-review

- Existing persisted batches are assigned directly after hydration; their stored `promptTemplate` values are not overwritten.
- Preference loading uses `storedPreference ?? DEFAULT_PRODUCT_PROMPT_TEMPLATE`, so a saved empty string remains valid while a missing record receives the default.
- New batches and the replacement created after deleting the final batch both receive the current in-memory preference.
- Editing the active batch's prompt template updates and persists the preference without changing the UI layout.
- The preference uses a dedicated settings record ID and does not collide with the existing global settings record.

## Review Remediation

### Root Cause

- Batch and preference reads were coupled with `Promise.all`, so a preference read failure discarded a successfully loaded batch result.
- Hydration then completed with the initial in-memory batch, allowing the debounced `clear()`-then-save path to overwrite storage.
- The editable workspace rendered before hydration, allowing a late load result to replace user edits.

### RED

Command:

```sh
npx vitest run utils/workspaceHydration.test.ts
```

Result:

```text
Test Files  1 failed (1)
Tests  no tests

Error: Cannot find module './workspaceHydration'
```

This confirmed the missing, testable hydration policy before implementation.

### GREEN

Command:

```sh
npx vitest run utils/workspaceHydration.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  4 passed (4)
```

Covered decisions:

- A failed preference read retains successfully loaded batches and falls back only the preference.
- A failed batch read creates a temporary batch but disables automatic batch persistence for the session.
- The workspace is unavailable until hydration is complete, so late results cannot overwrite user edits.
- The replacement after deleting the final batch inherits the current preference.

Full verification:

```sh
npx vitest run domain/productWorkflow.test.ts utils/db.test.ts utils/workspaceHydration.test.ts && npx tsc --noEmit
npm test
```

Result:

```text
Targeted: 3 test files passed, 21 tests passed; tsc exited successfully with no output.
Full suite: 9 test files passed, 55 tests passed.
```

### Commit

Fix commit SHA: `ac28513346f011895727130385fcfbd036eade71`

## P2 Test Gap Remediation

### Coverage added

- Added `App.hydration.test.tsx`, a jsdom test that mounts the real `App` with `react-dom/client` and drives its hydration and debounced save effects.
- Hydration-pending state does not render the editable workspace or schedule a batch save.
- A preference-read failure keeps the stored batch visible and only saves that stored batch, never the initial default batch.
- A batch-read failure never calls `saveProductBatchesToDB`, even after the debounce window.
- A saved empty preference is inherited through the real "delete final batch" interaction.

### RED

After adding the mounted regression tests, the batch-read persistence guard was temporarily removed from `App.tsx`:

```ts
if (!hydrated) return;
```

Command:

```sh
npx vitest run App.hydration.test.tsx -t "does not save batches after the batch read fails"
```

Result:

```text
Test Files  1 failed (1)
Tests  1 failed | 3 skipped (4)

AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

The observed call contained the temporary default batch with the loaded preference, demonstrating that the mounted test catches the destructive save path.

### GREEN

Restored the production guard:

```ts
if (!hydrated || !canPersistBatches) return;
```

Commands:

```sh
npx vitest run App.hydration.test.tsx
npm test
npx tsc --noEmit
```

Results:

```text
App.hydration.test.tsx: 1 test file passed, 4 tests passed.
Full suite: 10 test files passed, 59 tests passed.
TypeScript: exited successfully with no output.
```

### Dependency change

- Added `jsdom@^26.1.0` as a development-only dependency for the mounted DOM test environment.
