import { describe, it, expect } from "vitest";
import { evaluateAssertion, normalizeSpec } from "../matchers.js";

function run(matches: unknown[], spec: unknown, path = "$.x") {
  return evaluateAssertion(matches, normalizeSpec(spec), path);
}

describe("normalizeSpec", () => {
  it("treats a bare literal as equals", () => {
    expect(normalizeSpec("REGISTERED")).toEqual({ matcher: "equals", expected: "REGISTERED" });
  });

  it("selects a one-key matcher object", () => {
    expect(normalizeSpec({ isUuid: true })).toEqual({ matcher: "isUuid", expected: true });
  });

  it("treats a multi-key object as an equals target", () => {
    const spec = { a: 1, b: 2 };
    expect(normalizeSpec(spec)).toEqual({ matcher: "equals", expected: spec });
  });
});

describe("evaluateAssertion", () => {
  it("equals passes and fails with actual", () => {
    expect(run(["REGISTERED"], "REGISTERED")).toBeNull();
    expect(run(["DRAFT"], "REGISTERED")).toMatchObject({ matcher: "equals", expected: "REGISTERED", actual: "DRAFT" });
  });

  it("isUuid checks the shape of a server-generated id", () => {
    expect(run(["b3f1c2d4-1111-4222-8333-444455556666"], { isUuid: true })).toBeNull();
    expect(run(["not-a-uuid"], { isUuid: true })).not.toBeNull();
  });

  it("after compares timestamps relative to run start", () => {
    expect(run(["2026-07-02T10:00:01Z"], { after: "2026-07-02T10:00:00Z" })).toBeNull();
    expect(run(["2026-07-02T09:59:59Z"], { after: "2026-07-02T10:00:00Z" })).not.toBeNull();
  });

  it("contains checks membership across a [*] match set", () => {
    expect(run(["a", "b", "c"], { contains: "b" })).toBeNull();
    expect(run(["a", "b"], { contains: "z" })).not.toBeNull();
  });

  it("exists distinguishes present from absent paths", () => {
    expect(run(["v"], { exists: true })).toBeNull();
    expect(run([], { exists: true })).not.toBeNull();
    expect(run([], { exists: false })).toBeNull();
  });

  it("minLength and length measure arrays", () => {
    expect(run([[1, 2, 3]], { minLength: 1 })).toBeNull();
    expect(run([[]], { minLength: 1 })).not.toBeNull();
    expect(run([[1, 2]], { length: 2 })).toBeNull();
  });

  it("numeric comparisons support baseline-relative counts", () => {
    expect(run([6], { gt: 5 })).toBeNull();
    expect(run([6], { equals: 6 })).toBeNull();
    expect(run([5], { gt: 5 })).not.toBeNull();
  });
});
