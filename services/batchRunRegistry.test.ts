import { describe, expect, it } from "vitest";
import { BatchRunRegistry } from "./batchRunRegistry";

describe("BatchRunRegistry", () => {
  it("keeps controllers for different batches isolated", () => {
    const registry = new BatchRunRegistry();
    const a = registry.begin("A");
    const b = registry.begin("B");

    registry.stop("B");

    expect(a.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(true);
    expect(registry.has("A")).toBe(true);
    expect(registry.has("B")).toBe(false);
  });

  it("aborts only the prior controller when beginning the same batch again", () => {
    const registry = new BatchRunRegistry();
    const previous = registry.begin("A");
    const other = registry.begin("B");
    const replacement = registry.begin("A");

    expect(previous.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(replacement.signal.aborted).toBe(false);
    expect(registry.isCurrent("A", replacement)).toBe(true);
    expect(registry.isCurrent("B", other)).toBe(true);
  });

  it("does not let a stale finish remove a replacement controller", () => {
    const registry = new BatchRunRegistry();
    const previous = registry.begin("A");
    const replacement = registry.begin("A");

    registry.finish("A", previous);

    expect(registry.isCurrent("A", replacement)).toBe(true);
    expect(registry.has("A")).toBe(true);
    expect(replacement.signal.aborted).toBe(false);
  });

  it("finishes only the current controller", () => {
    const registry = new BatchRunRegistry();
    const controller = registry.begin("A");

    registry.finish("A", controller);

    expect(registry.isCurrent("A", controller)).toBe(false);
    expect(registry.has("A")).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it("aborts every controller and clears every batch on stopAll", () => {
    const registry = new BatchRunRegistry();
    const controllers = ["A", "B", "C"].map(batchId => registry.begin(batchId));

    registry.stopAll();

    expect(controllers.every(controller => controller.signal.aborted)).toBe(true);
    expect(registry.getRunningBatchIds()).toEqual(new Set());
  });

  it("returns unique batch IDs in isolated snapshots", () => {
    const snapshots: Set<string>[] = [];
    const registry = new BatchRunRegistry(batchIds => snapshots.push(batchIds));
    registry.begin("A");
    registry.begin("A");
    registry.begin("B");

    const runningBatchIds = registry.getRunningBatchIds();
    runningBatchIds.add("outside");

    expect([...runningBatchIds]).toEqual(["A", "B", "outside"]);
    expect([...registry.getRunningBatchIds()]).toEqual(["A", "B"]);
    expect([...snapshots.at(-1)!]).toEqual(["A", "B"]);
    expect(new Set([...snapshots.at(-1)!]).size).toBe(snapshots.at(-1)!.size);
  });
});
