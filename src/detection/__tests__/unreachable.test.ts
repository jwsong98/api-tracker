import { describe, it, expect } from "vitest";
import { detectUnreachable } from "../unreachable.js";
import type { Ref } from "../../types.js";

describe("detectUnreachable", () => {
  it("should return warnings for refs with unknown source", () => {
    const refs: Ref[] = [
      { value: "org-001", source: "unknown", boundAs: null },
    ];
    const warnings = detectUnreachable(refs);
    expect(warnings).toEqual([
      "UNREACHABLE_SUSPECT: 'org-001' has no known source in previous responses",
    ]);
  });

  it("should return empty array when all refs have known sources", () => {
    const refs: Ref[] = [
      { value: "a1b2c3", source: "node.1.response.id", boundAs: null },
      { value: "f47ac10b", source: "auto:node.2.response.orgId", boundAs: null },
    ];
    const warnings = detectUnreachable(refs);
    expect(warnings).toEqual([]);
  });

  it("should only warn for unknown refs in a mixed list", () => {
    const refs: Ref[] = [
      { value: "a1b2c3", source: "node.1.response.id", boundAs: null },
      { value: "unknown-val", source: "unknown", boundAs: null },
      { value: "f47ac10b", source: "auto:node.2.response.orgId", boundAs: null },
    ];
    const warnings = detectUnreachable(refs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unknown-val");
  });
});
