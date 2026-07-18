# Generation Stop And Resume Design

## Goal

Add a reliable stop control to prompt generation and image generation. Stopping preserves completed work, prevents new work from being dispatched, and allows the user to continue only unfinished work later.

## User Experience

- While prompts, the master scene, or batch images are generating, the primary action area shows a red `停止生成` button.
- Clicking it immediately changes the batch to `已停止` and aborts the active browser requests where possible.
- Completed images remain visible and downloadable.
- Work that had not started, plus any request interrupted before a usable result arrived, becomes stopped work rather than failed work.
- A stopped batch shows `继续剩余任务`. Continuing does not regenerate completed images.
- If stopping happened during prompt generation, continuing restarts prompt generation.
- If stopping happened during master-scene generation, continuing retries the master scene and then follows the existing manual or automatic workflow.
- If stopping happened during derived image generation, continuing runs only stopped, queued, or failed image jobs.
- A request already accepted by an upstream provider may still complete or incur cost. The application ignores a late result after a confirmed stop and does not dispatch further requests.

## State Model

- Add `stopped` to the batch run phases.
- Add `stopped` to image job statuses.
- When stopping a queue, queued jobs become `stopped`; active jobs become `stopped` after their local request is aborted or their late result is discarded.
- Completed jobs are immutable during stop and resume.
- Batch status uses an orange `已停止` badge so it is distinct from blue generating, green completed, and red failed.

## Cancellation Architecture

`App.tsx` owns one `AbortController` for the currently active workflow. The signal is passed through the workflow coordinator, image queue, and provider request service.

The image queue checks the signal before claiming each job. It stops dispatching immediately when aborted and normalizes unfinished jobs to `stopped`. Provider fetches receive the same signal so the browser can cancel in-flight HTTP work where supported.

Workflow coordinators check cancellation between prompt generation, master-scene generation, and derived generation. Cancellation is handled as a normal stopped outcome, not as a generic failure toast.

## Resume Rules

Resume uses the persisted batch state as its source of truth:

1. Completed jobs and their result URLs are retained.
2. If no prompt plan exists, prompt generation restarts.
3. In anchored mode, an existing completed master scene is reused.
4. Remaining jobs are rebuilt only when necessary and dispatched without completed job IDs.
5. Manual anchored mode still pauses for master-scene approval; automatic mode continues without an approval pause.

## Reference Image Scope

This feature does not change reference-image selection or ordering. The separate reference-image defect will be diagnosed from the reported symptom and verified independently, so cancellation changes cannot silently alter product, style, or master-scene references.

## Error Handling

- Abort errors are displayed as `已停止`, never `失败`.
- Provider errors that occur before the user stops remain failures and are eligible for `继续剩余任务`.
- Late callbacks from an old run must not overwrite the stopped batch or a newer resumed run.
- Starting or resuming creates a fresh controller; only one workflow can own the active controller.

## Tests

- Queue cancellation prevents additional jobs from starting and marks unfinished jobs stopped.
- Completed jobs survive cancellation.
- Provider fetch receives and respects an abort signal.
- Automatic and manual workflow coordinators return `stopped` without converting aborts to failures.
- Resume skips completed images and reuses a completed anchor.
- UI exposes stop only while active, then exposes continue for a stopped batch.
- Existing prompt, reference ordering, payload optimization, provider, type-check, and production build tests remain green.
