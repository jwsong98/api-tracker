import { diff } from "deep-diff";
import type { EdgeResponse } from "../types.js";

export function diffResponses(
  original: EdgeResponse,
  actual: EdgeResponse,
): { match: boolean; diff: any } {
  const left = { status: original.status, body: original.body };
  const right = { status: actual.status, body: actual.body };
  const result = diff(left, right);
  return {
    match: result == null,
    diff: result ?? null,
  };
}

export function formatDiff(
  original: EdgeResponse,
  actual: EdgeResponse,
  diffResult: any,
): string {
  if (diffResult == null) return "No differences";

  const lines: string[] = [];

  if (original.status !== actual.status) {
    lines.push(`Status: ${original.status} → ${actual.status}`);
  }

  for (const change of diffResult) {
    const path = change.path?.join(".") ?? "(root)";
    switch (change.kind) {
      case "E":
        lines.push(`Changed ${path}: ${JSON.stringify(change.lhs)} → ${JSON.stringify(change.rhs)}`);
        break;
      case "N":
        lines.push(`Added ${path}: ${JSON.stringify(change.rhs)}`);
        break;
      case "D":
        lines.push(`Deleted ${path}: ${JSON.stringify(change.lhs)}`);
        break;
      case "A":
        lines.push(`Array ${path}[${change.index}]: ${change.item?.kind ?? "changed"}`);
        break;
    }
  }

  return lines.join("\n");
}
