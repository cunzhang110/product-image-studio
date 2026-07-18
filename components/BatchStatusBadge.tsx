import React from "react";
import type { BatchDisplayStatus } from "../domain/productWorkflow";

export const BatchStatusBadge: React.FC<{ status: BatchDisplayStatus }> = ({ status }) => (
  <span className={`batch-status ${status.tone}`}>{status.label}</span>
);
