import type { EdgeResponse } from "../types.js";

/**
 * Compare two values structurally: same key structure and same value types.
 * Returns true if structures match (values may differ).
 */
function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;

  if (typeA !== "object") return true; // primitives: same type is enough

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).sort();
  const keysB = Object.keys(objB).sort();

  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!structurallyEqual(objA[keysA[i]], objB[keysB[i]])) return false;
  }
  return true;
}

export function diffResponses(
  original: EdgeResponse,
  actual: EdgeResponse,
): { match: boolean; diff: any } {
  // Status must match exactly
  if (original.status !== actual.status) {
    return {
      match: false,
      diff: [{ kind: "E", path: ["status"], lhs: original.status, rhs: actual.status }],
    };
  }

  // Body: structural comparison (key structure + value types)
  if (!structurallyEqual(original.body, actual.body)) {
    return {
      match: false,
      diff: [{ kind: "E", path: ["body"], lhs: original.body, rhs: actual.body }],
    };
  }

  return { match: true, diff: null };
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
