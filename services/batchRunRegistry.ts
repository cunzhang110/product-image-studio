export class BatchRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly onChange?: (batchIds: Set<string>) => void) {}

  begin(batchId: string) {
    this.controllers.get(batchId)?.abort();
    const controller = new AbortController();
    this.controllers.set(batchId, controller);
    this.emit();
    return controller;
  }

  isCurrent(batchId: string, controller: AbortController) {
    return this.controllers.get(batchId) === controller;
  }

  finish(batchId: string, controller: AbortController) {
    if (!this.isCurrent(batchId, controller)) return;
    this.controllers.delete(batchId);
    this.emit();
  }

  stop(batchId: string) {
    this.controllers.get(batchId)?.abort();
    this.controllers.delete(batchId);
    this.emit();
  }

  stopAll() {
    [...this.controllers.values()].forEach(controller => controller.abort());
    this.controllers.clear();
    this.emit();
  }

  has(batchId: string) {
    return this.controllers.has(batchId);
  }

  getRunningBatchIds() {
    return new Set(this.controllers.keys());
  }

  private emit() {
    this.onChange?.(this.getRunningBatchIds());
  }
}
