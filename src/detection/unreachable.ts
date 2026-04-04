import type { Ref } from "../types.js";

export function detectUnreachable(refs: Ref[]): string[] {
  return refs
    .filter((ref) => ref.source === "unknown")
    .map((ref) => `UNREACHABLE_SUSPECT: '${ref.value}' has no known source in previous responses`);
}
