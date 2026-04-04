import { describe, it, expect, beforeEach } from "vitest";
import { recordEdge } from "../recorder.js";
import { readJson, writeJson, getTrackerRoot } from "../../storage/file-store.js";
import type { SessionMeta, GraphData, Bindings, Edge } from "../../types.js";
import fs from "node:fs/promises";
import path from "node:path";

const TEST_ROOT = path.join(process.cwd(), ".test-recorder-" + process.pid);

beforeEach(async () => {
  process.env.API_TRACKER_ROOT = TEST_ROOT;
  await fs.rm(TEST_ROOT, { recursive: true, force: true });

  // Seed session
  const meta: SessionMeta = {
    name: "test-session",
    status: "active",
    createdAt: new Date().toISOString(),
    continueFrom: null,
    lastNodeId: 0,
    edgeCount: 0,
  };
  const graph: GraphData = {
    nodes: [{ id: 0, label: "seed" }],
    edges: [],
  };
  const bindings: Bindings = {};

  await writeJson("sessions/test-session/meta.json", meta);
  await writeJson("sessions/test-session/graph.json", graph);
  await writeJson("sessions/test-session/bindings.json", bindings);
});

describe("recordEdge", () => {
  it("should create edges/001.json", async () => {
    const result = await recordEdge({
      session: "test-session",
      method: "POST",
      path: "/api/users",
      body: { name: "홍길동" },
      authProfile: "admin",
      templatePath: "/api/users",
      templateBody: { name: "홍길동" },
      refs: [],
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
      warnings: [],
    });

    expect(result.edgeId).toBe(1);
    expect(result.fromNode).toBe(0);
    expect(result.toNode).toBe(1);

    const edge = await readJson<Edge>("sessions/test-session/edges/001.json");
    expect(edge).not.toBeNull();
    expect(edge!.edgeId).toBe(1);
    expect(edge!.fromNode).toBe(0);
    expect(edge!.toNode).toBe(1);
    expect(edge!.request.method).toBe("POST");
    expect(edge!.response.status).toBe(201);
  });

  it("should add node and edge to graph.json", async () => {
    await recordEdge({
      session: "test-session",
      method: "POST",
      path: "/api/users",
      body: { name: "홍길동" },
      templatePath: "/api/users",
      templateBody: { name: "홍길동" },
      refs: [],
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee" },
      },
      warnings: [],
    });

    const graph = await readJson<GraphData>("sessions/test-session/graph.json");
    expect(graph!.nodes).toHaveLength(2);
    expect(graph!.nodes[1]).toEqual({ id: 1, label: "POST /api/users → 201" });
    expect(graph!.edges).toHaveLength(1);
    expect(graph!.edges[0]).toEqual({ id: 1, from: 0, to: 1, file: "001.json" });
  });

  it("should add new bindings to bindings.json", async () => {
    await recordEdge({
      session: "test-session",
      method: "POST",
      path: "/api/users",
      templatePath: "/api/users",
      refs: [],
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
      warnings: [],
    });

    const bindings = await readJson<Bindings>("sessions/test-session/bindings.json");
    expect(bindings!["node.1.response.id"]).toEqual({
      value: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      origin: "edge.1",
      jsonPath: "id",
    });
    expect(bindings!["node.1.response.name"]).toEqual({
      value: "홍길동",
      origin: "edge.1",
      jsonPath: "name",
    });
  });

  it("should update meta.json lastNodeId and edgeCount", async () => {
    await recordEdge({
      session: "test-session",
      method: "POST",
      path: "/api/users",
      templatePath: "/api/users",
      refs: [],
      response: { status: 201, headers: {}, body: {} },
      warnings: [],
    });

    const meta = await readJson<SessionMeta>("sessions/test-session/meta.json");
    expect(meta!.lastNodeId).toBe(1);
    expect(meta!.edgeCount).toBe(1);
  });

  it("should record second edge with correct IDs", async () => {
    // First edge
    await recordEdge({
      session: "test-session",
      method: "POST",
      path: "/api/users",
      templatePath: "/api/users",
      refs: [],
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee" },
      },
      warnings: [],
    });

    // Second edge
    const result = await recordEdge({
      session: "test-session",
      method: "GET",
      path: "/api/users/aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      templatePath: "/api/users/$ref(node.1.response.id)",
      refs: [],
      response: {
        status: 200,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
      warnings: [],
    });

    expect(result.edgeId).toBe(2);
    expect(result.fromNode).toBe(1);
    expect(result.toNode).toBe(2);

    const edge = await readJson<Edge>("sessions/test-session/edges/002.json");
    expect(edge).not.toBeNull();
    expect(edge!.edgeId).toBe(2);
    expect(edge!.fromNode).toBe(1);
    expect(edge!.toNode).toBe(2);
  });
});
