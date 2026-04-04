import { describe, it, expect } from "vitest";
import { diffResponses, formatDiff } from "../diff.js";
import type { EdgeResponse } from "../../types.js";

describe("diffResponses", () => {
  it("should return match:true for identical responses", () => {
    const response: EdgeResponse = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "abc", name: "홍길동" },
    };
    const result = diffResponses(response, response);
    expect(result.match).toBe(true);
    expect(result.diff).toBeNull();
  });

  it("should return match:false when status code differs", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc" },
    };
    const actual: EdgeResponse = {
      status: 400,
      headers: {},
      body: { id: "abc" },
    };
    const result = diffResponses(original, actual);
    expect(result.match).toBe(false);
    expect(result.diff).not.toBeNull();

    const statusDiff = result.diff.find(
      (d: any) => d.path?.includes("status"),
    );
    expect(statusDiff).toBeDefined();
    expect(statusDiff.lhs).toBe(200);
    expect(statusDiff.rhs).toBe(400);
  });

  it("should return match:true when body values differ but structure is same", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc", name: "홍길동" },
    };
    const actual: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "xyz", name: "김철수" },
    };
    const result = diffResponses(original, actual);
    expect(result.match).toBe(true);
    expect(result.diff).toBeNull();
  });

  it("should return match:false when body structure differs (missing key)", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc", name: "홍길동" },
    };
    const actual: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc" },
    };
    const result = diffResponses(original, actual);
    expect(result.match).toBe(false);
    expect(result.diff).not.toBeNull();
  });

  it("should return match:false when body value type differs", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc", count: 5 },
    };
    const actual: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc", count: "five" },
    };
    const result = diffResponses(original, actual);
    expect(result.match).toBe(false);
    expect(result.diff).not.toBeNull();
  });

  it("should ignore header differences", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: { date: "Mon, 01 Jan 2026 00:00:00 GMT" },
      body: { ok: true },
    };
    const actual: EdgeResponse = {
      status: 200,
      headers: { date: "Tue, 02 Jan 2026 00:00:00 GMT" },
      body: { ok: true },
    };
    const result = diffResponses(original, actual);
    expect(result.match).toBe(true);
    expect(result.diff).toBeNull();
  });
});

describe("formatDiff", () => {
  it("should return 'No differences' for matching responses", () => {
    const response: EdgeResponse = {
      status: 200,
      headers: {},
      body: { id: "abc" },
    };
    const text = formatDiff(response, response, null);
    expect(text).toBe("No differences");
  });

  it("should format status code difference", () => {
    const original: EdgeResponse = { status: 200, headers: {}, body: {} };
    const actual: EdgeResponse = { status: 400, headers: {}, body: {} };
    const { diff } = diffResponses(original, actual);
    const text = formatDiff(original, actual, diff);
    expect(text).toContain("Status: 200 → 400");
  });

  it("should format changed body fields when structure differs", () => {
    const original: EdgeResponse = {
      status: 200,
      headers: {},
      body: { name: "홍길동" },
    };
    const actual: EdgeResponse = {
      status: 200,
      headers: {},
      body: { name: "홍길동", extra: true },
    };
    const { diff } = diffResponses(original, actual);
    const text = formatDiff(original, actual, diff);
    expect(text).toContain("Changed");
  });
});
