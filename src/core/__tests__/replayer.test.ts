import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import nock from "nock";
import { writeJson, readJson } from "../../storage/file-store.js";
import { replayToNode } from "../replayer.js";
import type {
  Config,
  SessionMeta,
  GraphData,
  Bindings,
  Edge,
} from "../../types.js";
import YAML from "yaml";

const BASE_URL = "http://localhost:9877";

const testConfig: Config = {
  server: { baseUrl: BASE_URL },
  openapi: { specPath: "./openapi.yaml" },
  auth: {
    profiles: {
      admin: {
        endpoint: "/auth/login",
        method: "POST",
        credentials: { email: "admin@test.com", password: "test1234" },
        tokenPath: "$.accessToken",
        note: "admin",
      },
    },
  },
  db: { resetCommand: "echo reset", resetWorkingDir: "." },
};

const TEST_ROOT = path.join(process.cwd(), ".test-replayer-" + process.pid);

vi.mock("../db-resetter.js", () => ({
  resetDatabase: vi.fn().mockResolvedValue({ success: true, output: "mocked reset" }),
}));

async function seedSession(
  sessionName: string,
  opts: {
    meta: SessionMeta;
    graph: GraphData;
    bindings: Bindings;
    edges: Edge[];
  },
) {
  await writeJson(`sessions/${sessionName}/meta.json`, opts.meta);
  await writeJson(`sessions/${sessionName}/graph.json`, opts.graph);
  await writeJson(`sessions/${sessionName}/bindings.json`, opts.bindings);
  for (const edge of opts.edges) {
    const file = String(edge.edgeId).padStart(3, "0");
    await writeJson(`sessions/${sessionName}/edges/${file}.json`, edge);
  }
}

function makeEdge(
  overrides: Partial<Edge> & { edgeId: number; fromNode: number; toNode: number },
): Edge {
  return {
    timestamp: new Date().toISOString(),
    request: {
      method: "POST",
      path: "/api/users",
      headers: {},
      body: { name: "홍길동" },
      template: { path: "/api/users", body: { name: "홍길동" } },
    },
    response: {
      status: 201,
      headers: { "content-type": "application/json" },
      body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
    },
    refs: [],
    warnings: [],
    authProfile: "",
    ...overrides,
  };
}

beforeEach(async () => {
  process.env.API_TRACKER_ROOT = TEST_ROOT;
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(TEST_ROOT, { recursive: true });
  await fs.writeFile(
    path.join(TEST_ROOT, "config.yaml"),
    YAML.stringify(testConfig),
    "utf-8",
  );
  await writeJson("auth.json", {
    admin: { token: "test-token", expiresAt: "", note: "admin" },
  });
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

describe("replayToNode", () => {
  it("should replay 2 edges successfully with matching responses", async () => {
    const edge1 = makeEdge({
      edgeId: 1,
      fromNode: 0,
      toNode: 1,
      request: {
        method: "POST",
        path: "/api/users",
        headers: {},
        body: { name: "홍길동" },
        template: { path: "/api/users", body: { name: "홍길동" } },
      },
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    const edge2 = makeEdge({
      edgeId: 2,
      fromNode: 1,
      toNode: 2,
      request: {
        method: "GET",
        path: "/api/users/aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        headers: {},
        body: undefined,
        template: {
          path: "/api/users/$ref(node.1.response.id)",
          body: undefined,
        },
      },
      response: {
        status: 200,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    await seedSession("test-replay", {
      meta: {
        name: "test-replay",
        status: "active",
        createdAt: new Date().toISOString(),
        continueFrom: null,
        lastNodeId: 2,
        edgeCount: 2,
      },
      graph: {
        nodes: [
          { id: 0, label: "seed" },
          { id: 1, label: "POST /api/users → 201" },
          { id: 2, label: "GET /api/users/... → 200" },
        ],
        edges: [
          { id: 1, from: 0, to: 1, file: "001.json" },
          { id: 2, from: 1, to: 2, file: "002.json" },
        ],
      },
      bindings: {},
      edges: [edge1, edge2],
    });

    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" });

    nock(BASE_URL)
      .get("/api/users/aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee")
      .reply(200, { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" });

    const result = await replayToNode({
      session: "test-replay",
      targetNode: 2,
      config: testConfig,
    });

    expect(result.status).toBe("success");
    expect(result.dbReset).toBe(true);
    expect(result.replayed).toHaveLength(2);
    expect(result.replayed[0].match).toBe(true);
    expect(result.replayed[1].match).toBe(true);
    expect(result.divergedAt).toBeUndefined();
  });

  it("should return diverged when 2nd edge response differs", async () => {
    const edge1 = makeEdge({
      edgeId: 1,
      fromNode: 0,
      toNode: 1,
      request: {
        method: "POST",
        path: "/api/users",
        headers: {},
        body: { name: "홍길동" },
        template: { path: "/api/users", body: { name: "홍길동" } },
      },
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    const edge2 = makeEdge({
      edgeId: 2,
      fromNode: 1,
      toNode: 2,
      request: {
        method: "GET",
        path: "/api/users/aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        headers: {},
        body: undefined,
        template: {
          path: "/api/users/$ref(node.1.response.id)",
          body: undefined,
        },
      },
      response: {
        status: 200,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    await seedSession("test-diverge", {
      meta: {
        name: "test-diverge",
        status: "active",
        createdAt: new Date().toISOString(),
        continueFrom: null,
        lastNodeId: 2,
        edgeCount: 2,
      },
      graph: {
        nodes: [
          { id: 0, label: "seed" },
          { id: 1, label: "POST /api/users → 201" },
          { id: 2, label: "GET /api/users/... → 200" },
        ],
        edges: [
          { id: 1, from: 0, to: 1, file: "001.json" },
          { id: 2, from: 1, to: 2, file: "002.json" },
        ],
      },
      bindings: {},
      edges: [edge1, edge2],
    });

    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" });

    // 2nd edge: different status
    nock(BASE_URL)
      .get("/api/users/aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee")
      .reply(400, { error: "Bad Request" });

    const result = await replayToNode({
      session: "test-diverge",
      targetNode: 2,
      config: testConfig,
    });

    expect(result.status).toBe("diverged");
    expect(result.divergedAt).toBe(2);
    expect(result.diff).not.toBeNull();
    expect(result.replayed).toHaveLength(2);
    expect(result.replayed[0].match).toBe(true);
    expect(result.replayed[1].match).toBe(false);
    expect(result.replayed[1].originalStatus).toBe(200);
    expect(result.replayed[1].actualStatus).toBe(400);
  });

  it("should succeed with bindingUpdates when UUID changes on replay (structural match)", async () => {
    // Edge response has UUID "aaa". On replay, server returns "bbb".
    // Structural comparison: same keys + same types → match.
    // bindingUpdates should record the UUID change.
    const edge1 = makeEdge({
      edgeId: 1,
      fromNode: 0,
      toNode: 1,
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    await seedSession("test-uuid-change", {
      meta: {
        name: "test-uuid-change",
        status: "active",
        createdAt: new Date().toISOString(),
        continueFrom: null,
        lastNodeId: 1,
        edgeCount: 1,
      },
      graph: {
        nodes: [
          { id: 0, label: "seed" },
          { id: 1, label: "POST /api/users → 201" },
        ],
        edges: [{ id: 1, from: 0, to: 1, file: "001.json" }],
      },
      bindings: {
        "node.1.response.id": {
          value: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
          origin: "edge.1",
          jsonPath: "id",
        },
        "node.1.response.name": {
          value: "홍길동",
          origin: "edge.1",
          jsonPath: "name",
        },
      },
      edges: [edge1],
    });

    const newUuid = "11111111-2222-4333-9444-555555555555";
    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: newUuid, name: "홍길동" });

    const result = await replayToNode({
      session: "test-uuid-change",
      targetNode: 1,
      config: testConfig,
    });

    expect(result.status).toBe("success");
    expect(result.divergedAt).toBeUndefined();
    // bindingUpdates should show the UUID was updated
    expect(result.bindingUpdates["node.1.response.id"]).toEqual({
      old: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
      new: newUuid,
    });
  });

  it("should throw error for non-existent targetNode", async () => {
    await seedSession("test-nonode", {
      meta: {
        name: "test-nonode",
        status: "active",
        createdAt: new Date().toISOString(),
        continueFrom: null,
        lastNodeId: 0,
        edgeCount: 0,
      },
      graph: {
        nodes: [{ id: 0, label: "seed" }],
        edges: [],
      },
      bindings: {},
      edges: [],
    });

    await expect(
      replayToNode({
        session: "test-nonode",
        targetNode: 99,
        config: testConfig,
      }),
    ).rejects.toThrow("Node 99 does not exist");
  });

  it("should update bindings.json after successful replay", async () => {
    const edge1 = makeEdge({
      edgeId: 1,
      fromNode: 0,
      toNode: 1,
      response: {
        status: 201,
        headers: {},
        body: { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" },
      },
    });

    await seedSession("test-bindings-write", {
      meta: {
        name: "test-bindings-write",
        status: "active",
        createdAt: new Date().toISOString(),
        continueFrom: null,
        lastNodeId: 1,
        edgeCount: 1,
      },
      graph: {
        nodes: [
          { id: 0, label: "seed" },
          { id: 1, label: "POST /api/users → 201" },
        ],
        edges: [{ id: 1, from: 0, to: 1, file: "001.json" }],
      },
      bindings: {},
      edges: [edge1],
    });

    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", name: "홍길동" });

    const result = await replayToNode({
      session: "test-bindings-write",
      targetNode: 1,
      config: testConfig,
    });

    expect(result.status).toBe("success");

    const bindings = await readJson<Bindings>("sessions/test-bindings-write/bindings.json");
    expect(bindings).not.toBeNull();
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
});
