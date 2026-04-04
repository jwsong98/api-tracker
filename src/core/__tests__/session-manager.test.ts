import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSession,
  listSessions,
  getSession,
  updateSessionMeta,
  getActiveSession,
} from "../session-manager.js";
import { readJson } from "../../storage/file-store.js";
import type { SessionMeta, GraphData, Bindings } from "../../types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-session-"));
  process.env.API_TRACKER_ROOT = tmpDir;
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("createSession", () => {
  it("should create meta.json, graph.json, bindings.json", async () => {
    const meta = await createSession({ name: "test-session" });

    expect(meta.name).toBe("test-session");
    expect(meta.status).toBe("active");
    expect(meta.lastNodeId).toBe(0);
    expect(meta.edgeCount).toBe(0);
    expect(meta.continueFrom).toBeNull();

    const savedMeta = await readJson<SessionMeta>("sessions/test-session/meta.json");
    expect(savedMeta).toEqual(meta);

    const graph = await readJson<GraphData>("sessions/test-session/graph.json");
    expect(graph!.nodes).toEqual([{ id: 0, label: "seed" }]);
    expect(graph!.edges).toEqual([]);

    const bindings = await readJson<Bindings>("sessions/test-session/bindings.json");
    expect(bindings).toEqual({});
  });

  it("should throw on duplicate session name", async () => {
    await createSession({ name: "dup" });
    await expect(createSession({ name: "dup" })).rejects.toThrow("already exists");
  });

  it("should throw on invalid session name", async () => {
    await expect(createSession({ name: "bad name!" })).rejects.toThrow("only alphanumeric");
  });
});

describe("createSession with continueFrom", () => {
  it("should copy bindings from source session", async () => {
    await createSession({ name: "source" });

    // Write some bindings to the source session
    const { writeJson } = await import("../../storage/file-store.js");
    const sourceBindings: Bindings = {
      "node.1.response.id": {
        value: "abc-123",
        origin: "edge.001",
        jsonPath: "$.id",
      },
    };
    await writeJson("sessions/source/bindings.json", sourceBindings);

    const meta = await createSession({ name: "continued", continueFrom: "source" });

    expect(meta.continueFrom).toBe("source");

    const graph = await readJson<GraphData>("sessions/continued/graph.json");
    expect(graph!.nodes[0].label).toBe("continue:source");

    const bindings = await readJson<Bindings>("sessions/continued/bindings.json");
    expect(bindings).toEqual(sourceBindings);
  });

  it("should throw when source session does not exist", async () => {
    await expect(
      createSession({ name: "orphan", continueFrom: "nonexistent" }),
    ).rejects.toThrow("not found");
  });
});

describe("listSessions", () => {
  it("should return all sessions", async () => {
    await createSession({ name: "session-a" });
    await createSession({ name: "session-b" });

    const sessions = await listSessions();
    const names = sessions.map((s) => s.name).sort();
    expect(names).toEqual(["session-a", "session-b"]);
  });

  it("should return empty array when no sessions", async () => {
    const sessions = await listSessions();
    expect(sessions).toEqual([]);
  });
});

describe("getSession", () => {
  it("should return session meta", async () => {
    await createSession({ name: "my-session" });
    const meta = await getSession("my-session");
    expect(meta.name).toBe("my-session");
  });

  it("should throw for non-existent session", async () => {
    await expect(getSession("nope")).rejects.toThrow("not found");
  });
});

describe("updateSessionMeta", () => {
  it("should update specific fields", async () => {
    await createSession({ name: "upd" });
    await updateSessionMeta("upd", { lastNodeId: 5, edgeCount: 3 });

    const meta = await getSession("upd");
    expect(meta.lastNodeId).toBe(5);
    expect(meta.edgeCount).toBe(3);
    expect(meta.status).toBe("active");
  });
});

describe("getActiveSession", () => {
  it("should return the most recent active session", async () => {
    await createSession({ name: "old" });
    // Slight delay to ensure different createdAt
    await new Promise((r) => setTimeout(r, 10));
    await createSession({ name: "new" });

    const active = await getActiveSession();
    expect(active).toBe("new");
  });

  it("should return null when no active sessions", async () => {
    const active = await getActiveSession();
    expect(active).toBeNull();
  });
});
