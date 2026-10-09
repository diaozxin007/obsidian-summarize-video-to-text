import { Notice } from "obsidian";
import { ApiError } from "./api";

export function showErrorNotice(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const ref = error instanceof ApiError && error.requestId ? ` (ref ${error.requestId.slice(0, 8)})` : "";
  const content = document.createDocumentFragment();
  content.append(`Summarize Video: ${message}${ref}`);
  if (error instanceof ApiError && error.actionUrl) {
    const link = document.createElement("a");
    link.href = error.actionUrl;
    link.textContent = error.actionLabel ?? "Open website";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    content.append(" ", link);
  }
  new Notice(content, 12000);
}
