import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../../storage/file-store.js";
import {
  collectSessionData,
  collectAllSessionsData,
  generateSessionHtml,
  generateAllSessionsHtml,
} from "../html-generator.js";
import type { SessionMeta, GraphData, Edge } from "../../types.js";

const TEST_ROOT = path.join(process.cwd(), ".test-visualize-" + process.pid);
let originalRoot: string | undefined;

// ── Fixture Data ──

const userCrudMeta: SessionMeta = {
  name: "user-crud",
  status: "active",
  createdAt: "2026-04-05T10:00:00Z",
  continueFrom: null,
  lastNodeId: 2,
  edgeCount: 2,
};

const userCrudGraph: GraphData = {
  nodes: [
    { id: 0, label: "seed" },
    { id: 1, label: "POST /api/users → 201" },
    { id: 2, label: "GET /api/users/{id} → 200" },
  ],
  edges: [
    { id: 1, from: 0, to: 1, file: "001.json" },
    { id: 2, from: 1, to: 2, file: "002.json" },
  ],
};

const userCrudEdge1: Edge = {
  edgeId: 1,
  fromNode: 0,
  toNode: 1,
  timestamp: "2026-04-05T10:01:00Z",
  request: {
    method: "POST",
    path: "/api/users",
    headers: { Authorization: "Bearer test-token" },
    body: { name: "홍길동" },
    template: { path: "/api/users", body: { name: "홍길동" } },
  },
  response: {
    status: 201,
    headers: { "content-type": "application/json" },
    body: { id: "uuid-aaa", name: "홍길동" },
  },
  refs: [{ value: "uuid-aaa", source: "response.new", boundAs: "node.1.response.id" }],
  warnings: [],
  authProfile: "admin",
};

const userCrudEdge2: Edge = {
  edgeId: 2,
  fromNode: 1,
  toNode: 2,
  timestamp: "2026-04-05T10:02:00Z",
  request: {
    method: "GET",
    path: "/api/users/uuid-aaa",
    headers: { Authorization: "Bearer test-token" },
    body: null,
    template: { path: "/api/users/$ref(node.1.response.id)", body: null },
  },
  response: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { id: "uuid-aaa", name: "홍길동", status: "active" },
  },
  refs: [{ value: "uuid-aaa", source: "node.1.response.id", boundAs: null }],
  warnings: [],
  authProfile: "admin",
};

const userDeleteMeta: SessionMeta = {
  name: "user-delete",
  status: "active",
  createdAt: "2026-04-05T11:00:00Z",
  continueFrom: "user-crud",
  lastNodeId: 1,
  edgeCount: 1,
};

const userDeleteGraph: GraphData = {
  nodes: [
    { id: 0, label: "continue:user-crud" },
    { id: 1, label: "DELETE /api/users/{id} → 204" },
  ],
  edges: [{ id: 1, from: 0, to: 1, file: "001.json" }],
};

const userDeleteEdge1: Edge = {
  edgeId: 1,
  fromNode: 0,
  toNode: 1,
  timestamp: "2026-04-05T11:01:00Z",
  request: {
    method: "DELETE",
    path: "/api/users/uuid-aaa",
    headers: { Authorization: "Bearer test-token" },
    body: null,
    template: { path: "/api/users/$ref(node.1.response.id)", body: null },
  },
  response: {
    status: 204,
    headers: {},
    body: null,
  },
  refs: [],
  warnings: [],
  authProfile: "admin",
};

// ── Setup / Teardown ──

beforeEach(async () => {
  originalRoot = process.env.API_TRACKER_ROOT;
  process.env.API_TRACKER_ROOT = TEST_ROOT;
  await fs.rm(TEST_ROOT, { recursive: true, force: true });

  // Write user-crud session
  await writeJson("sessions/user-crud/meta.json", userCrudMeta);
  await writeJson("sessions/user-crud/graph.json", userCrudGraph);
  await writeJson("sessions/user-crud/edges/001.json", userCrudEdge1);
  await writeJson("sessions/user-crud/edges/002.json", userCrudEdge2);

  // Write user-delete session
  await writeJson("sessions/user-delete/meta.json", userDeleteMeta);
  await writeJson("sessions/user-delete/graph.json", userDeleteGraph);
  await writeJson("sessions/user-delete/edges/001.json", userDeleteEdge1);
});

afterEach(async () => {
  if (originalRoot !== undefined) {
    process.env.API_TRACKER_ROOT = originalRoot;
  } else {
    delete process.env.API_TRACKER_ROOT;
  }
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

// ── Tests ──

describe("collectSessionData", () => {
  it("should collect single session data with meta, graph, edges", async () => {
    const data = await collectSessionData("user-crud");

    expect(data.meta).toEqual(userCrudMeta);
    expect(data.graph).toEqual(userCrudGraph);
    expect(data.edges).toHaveLength(2);
    // edges sorted by edgeId order
    expect(data.edges[0].edgeId).toBe(1);
    expect(data.edges[1].edgeId).toBe(2);
  });
});

describe("collectAllSessionsData", () => {
  it("should collect all sessions with continueFrom links", async () => {
    const data = await collectAllSessionsData();

    expect(data.sessions).toHaveLength(2);

    // continueFrom link: user-crud → user-delete
    expect(data.continueFromLinks).toHaveLength(1);
    expect(data.continueFromLinks[0]).toEqual({
      parentSession: "user-crud",
      parentLastNodeId: 2,
      childSession: "user-delete",
    });
  });
});

describe("generateSessionHtml", () => {
  it("should generate valid single session HTML", async () => {
    const data = await collectSessionData("user-crud");
    const html = generateSessionHtml(data);

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);

    // DOCTYPE
    expect(html).toContain("<!DOCTYPE html>");

    // vis.js CDN
    expect(html).toContain("unpkg.com/vis-network");

    // Node data
    expect(html).toContain("seed");
    expect(html).toContain("POST /api/users");

    // Edge data embedded in script
    expect(html).toContain("edgeLookup");

    // Session name
    expect(html).toContain("user-crud");

    // Detail panel
    expect(html).toContain('id="detail"');
  });
});

describe("generateAllSessionsHtml", () => {
  it("should generate HTML with all sessions and continueFrom links", async () => {
    const data = await collectAllSessionsData();
    const html = generateAllSessionsHtml(data);

    // Both sessions' nodes present
    expect(html).toContain("seed");
    expect(html).toContain("POST /api/users");
    expect(html).toContain("DELETE /api/users");

    // continueFrom dashed edge
    expect(html).toContain("dashes");

    // Session legend
    expect(html).toContain("legend");
    expect(html).toContain("user-crud");
    expect(html).toContain("user-delete");
  });
});

describe("error handling", () => {
  it("should throw for nonexistent session", async () => {
    await expect(collectSessionData("nonexistent")).rejects.toThrow();
  });
});

describe("node color mapping", () => {
  it("should assign correct colors to HTTP method nodes", async () => {
    const data = await collectSessionData("user-crud");
    const html = generateSessionHtml(data);

    // POST → green
    expect(html).toContain("#4CAF50");
    // GET → blue
    expect(html).toContain("#2196F3");
    // seed → grey
    expect(html).toContain("#9E9E9E");
  });

  it("should assign red color to DELETE nodes", async () => {
    const deleteData = await collectSessionData("user-delete");
    const deleteHtml = generateSessionHtml(deleteData);

    // DELETE → red
    expect(deleteHtml).toContain("#F44336");
    // continue:user-crud seed → grey
    expect(deleteHtml).toContain("#9E9E9E");
  });
});
