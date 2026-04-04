import { describe, it, expect } from "vitest";
import {
  resolveTemplate,
  resolveRequest,
  inferRefs,
  extractBindings,
} from "../binding-engine.js";
import type { Bindings } from "../../types.js";

const bindings: Bindings = {
  "node.1.response.id": {
    value: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    origin: "edge.1",
    jsonPath: "id",
  },
  "node.1.response.name": {
    value: "홍길동",
    origin: "edge.1",
    jsonPath: "name",
  },
  "node.2.response.orgId": {
    value: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    origin: "edge.2",
    jsonPath: "orgId",
  },
};

describe("resolveTemplate", () => {
  it("should replace $ref(node.1.response.id) with binding value", () => {
    const { resolved, refs } = resolveTemplate(
      "/api/users/$ref(node.1.response.id)",
      bindings,
    );
    expect(resolved).toBe(
      "/api/users/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("node.1.response.id");
    expect(refs[0].value).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(refs[0].boundAs).toBeNull();
  });

  it("should throw on missing binding reference", () => {
    expect(() =>
      resolveTemplate("/api/users/$ref(node.99.response.id)", bindings),
    ).toThrow("Binding not found for $ref(node.99.response.id)");
  });
});

describe("resolveRequest", () => {
  it("should resolve $ref() in body object", () => {
    const { resolved, refs } = resolveRequest(
      {
        path: "/api/orgs",
        body: { userId: "$ref(node.1.response.id)", name: "test" },
      },
      bindings,
    );
    expect(resolved.body).toEqual({
      userId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      name: "test",
    });
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("node.1.response.id");
  });

  it("should resolve $ref() in both path and body", () => {
    const { resolved, refs } = resolveRequest(
      {
        path: "/api/users/$ref(node.1.response.id)",
        body: { orgId: "$ref(node.2.response.orgId)" },
      },
      bindings,
    );
    expect(resolved.path).toBe(
      "/api/users/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    );
    expect(resolved.body).toEqual({
      orgId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    });
    expect(refs).toHaveLength(2);
  });
});

describe("inferRefs", () => {
  it("should match UUID found in bindings", () => {
    const refs = inferRefs(
      { path: "/api/users/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" },
      bindings,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("auto:node.1.response.id");
    expect(refs[0].value).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  });

  it("should mark UUID not in bindings as unknown", () => {
    const refs = inferRefs(
      { path: "/api/users/11111111-2222-4333-a444-555555555555" },
      bindings,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("unknown");
    expect(refs[0].value).toBe("11111111-2222-4333-a444-555555555555");
  });

  it("should infer UUIDs from body as well", () => {
    const refs = inferRefs(
      {
        path: "/api/orgs",
        body: { userId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" },
      },
      bindings,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("auto:node.1.response.id");
  });
});

describe("extractBindings", () => {
  it("should extract UUIDs from nested response body", () => {
    const response = {
      id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      data: {
        userId: "11111111-2222-4333-a444-555555555555",
        name: "홍길동",
      },
    };
    const result = extractBindings(1, 1, response);

    expect(result["node.1.response.id"]).toEqual({
      value: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      origin: "edge.1",
      jsonPath: "id",
    });
    expect(result["node.1.response.data.userId"]).toEqual({
      value: "11111111-2222-4333-a444-555555555555",
      origin: "edge.1",
      jsonPath: "data.userId",
    });
    expect(result["node.1.response.data.name"]).toEqual({
      value: "홍길동",
      origin: "edge.1",
      jsonPath: "data.name",
    });
  });

  it("should handle arrays with recursive traversal", () => {
    const response = {
      items: [
        { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "item1" },
        { id: "11111111-2222-4333-a444-555555555555", name: "item2" },
      ],
    };
    const result = extractBindings(2, 3, response);

    expect(result["node.3.response.items.[0].id"]).toEqual({
      value: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      origin: "edge.2",
      jsonPath: "items.[0].id",
    });
    expect(result["node.3.response.items.[1].id"]).toEqual({
      value: "11111111-2222-4333-a444-555555555555",
      origin: "edge.2",
      jsonPath: "items.[1].id",
    });
  });

  it("should exclude null, boolean, and empty strings", () => {
    const response = {
      id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      active: true,
      deleted: false,
      extra: null,
      emptyStr: "",
    };
    const result = extractBindings(1, 1, response);

    expect(result["node.1.response.id"]).toBeDefined();
    expect(result["node.1.response.active"]).toBeUndefined();
    expect(result["node.1.response.deleted"]).toBeUndefined();
    expect(result["node.1.response.extra"]).toBeUndefined();
    expect(result["node.1.response.emptyStr"]).toBeUndefined();
  });

  it("should register numeric IDs", () => {
    const response = { id: 42, name: "test" };
    const result = extractBindings(1, 1, response);
    expect(result["node.1.response.id"]).toEqual({
      value: 42,
      origin: "edge.1",
      jsonPath: "id",
    });
  });
});
