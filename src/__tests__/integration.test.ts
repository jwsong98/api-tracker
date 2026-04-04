import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import nock from "nock";
import YAML from "yaml";
import { createSession } from "../core/session-manager.js";
import { login } from "../core/auth-manager.js";
import { resolveRequest, inferRefs, extractBindings } from "../core/binding-engine.js";
import { detectUnreachable } from "../detection/unreachable.js";
import { callWithAuth } from "../core/http-caller.js";
import { recordEdge } from "../core/recorder.js";
import { replayToNode } from "../core/replayer.js";
import { readJson } from "../storage/file-store.js";
import type { Config, Bindings, SessionMeta } from "../types.js";

const BASE_URL = "http://localhost:3000";
const TEST_ROOT = path.join(process.cwd(), ".test-integration-" + process.pid);

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
        note: "테스트 관리자",
      },
    },
  },
  db: { resetCommand: "echo 'db reset done'", resetWorkingDir: "" },
};

beforeAll(async () => {
  process.env.API_TRACKER_ROOT = TEST_ROOT;
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(TEST_ROOT, { recursive: true });

  // Write config.yaml
  await fs.writeFile(
    path.join(TEST_ROOT, "config.yaml"),
    YAML.stringify(testConfig),
    "utf-8",
  );
});

afterAll(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

describe("Integration: full flow", () => {
  it("should complete session → auth → call → call(template) → replay → replay(diverged)", async () => {
    // ── 1. 세션 시작 ──
    const meta = await createSession({ name: "test-flow" });
    expect(meta.name).toBe("test-flow");
    expect(meta.status).toBe("active");
    expect(meta.lastNodeId).toBe(0);

    const savedMeta = await readJson<SessionMeta>("sessions/test-flow/meta.json");
    expect(savedMeta).not.toBeNull();
    expect(savedMeta!.name).toBe("test-flow");

    // ── 2. 인증 ──
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "test-token-123" });

    const authResult = await login("admin");
    expect(authResult.token).toBe("test-token-123");

    // Verify token is cached
    const authCache = await readJson<Record<string, any>>("auth.json");
    expect(authCache).not.toBeNull();
    expect(authCache!["admin"].token).toBe("test-token-123");

    // ── 3. 첫 번째 호출: POST /api/users ──
    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "uuid-aaa-111", name: "홍길동" });

    const call1Body = { name: "홍길동" };
    const call1Path = "/api/users";
    let bindings = (await readJson<Bindings>("sessions/test-flow/bindings.json")) ?? {};

    const { resolved: resolved1, refs: refs1 } = resolveRequest(
      { path: call1Path, body: call1Body },
      bindings,
    );
    const inferred1 = inferRefs(resolved1, bindings);
    const allRefs1 = [...refs1, ...inferred1];
    const warnings1 = detectUnreachable(allRefs1);

    const response1 = await callWithAuth({
      method: "POST",
      url: `${BASE_URL}${resolved1.path}`,
      body: resolved1.body,
      authProfile: "admin",
    });
    expect(response1.status).toBe(201);
    expect(response1.body.id).toBe("uuid-aaa-111");

    const record1 = await recordEdge({
      session: "test-flow",
      method: "POST",
      path: resolved1.path,
      body: resolved1.body,
      authProfile: "admin",
      templatePath: call1Path,
      templateBody: call1Body,
      refs: allRefs1,
      response: response1,
      warnings: warnings1,
    });

    expect(record1.edgeId).toBe(1);
    expect(record1.fromNode).toBe(0);
    expect(record1.toNode).toBe(1);

    // Edge 001 기록 확인
    const edge1 = await readJson<any>("sessions/test-flow/edges/001.json");
    expect(edge1).not.toBeNull();
    expect(edge1!.response.body.id).toBe("uuid-aaa-111");

    // bindings에 node.1.response.id 등록 확인
    bindings = (await readJson<Bindings>("sessions/test-flow/bindings.json")) ?? {};
    expect(bindings["node.1.response.id"]).toBeDefined();
    expect(bindings["node.1.response.id"].value).toBe("uuid-aaa-111");

    // ── 4. 두 번째 호출: GET /api/users/$ref(node.1.response.id) ──
    nock(BASE_URL)
      .get("/api/users/uuid-aaa-111")
      .reply(200, { id: "uuid-aaa-111", name: "홍길동", status: "active" });

    const call2Path = "/api/users/$ref(node.1.response.id)";
    const { resolved: resolved2, refs: refs2 } = resolveRequest(
      { path: call2Path, body: undefined },
      bindings,
    );

    // Template resolution check
    expect(resolved2.path).toBe("/api/users/uuid-aaa-111");
    expect(refs2.length).toBeGreaterThan(0);
    expect(refs2[0].source).toBe("node.1.response.id");

    const inferred2 = inferRefs(resolved2, bindings);
    const allRefs2 = [...refs2, ...inferred2];
    const warnings2 = detectUnreachable(allRefs2);

    const response2 = await callWithAuth({
      method: "GET",
      url: `${BASE_URL}${resolved2.path}`,
      body: undefined,
      authProfile: "admin",
    });
    expect(response2.status).toBe(200);

    const record2 = await recordEdge({
      session: "test-flow",
      method: "GET",
      path: resolved2.path,
      body: undefined,
      authProfile: "admin",
      templatePath: call2Path,
      templateBody: undefined,
      refs: allRefs2,
      response: response2,
      warnings: warnings2,
    });

    expect(record2.edgeId).toBe(2);
    expect(record2.toNode).toBe(2);

    // Edge 002 기록 확인
    const edge2 = await readJson<any>("sessions/test-flow/edges/002.json");
    expect(edge2).not.toBeNull();

    // refs에 명시적 참조 기록 확인
    expect(edge2!.refs.some((r: any) => r.source === "node.1.response.id")).toBe(true);

    // ── 5. Replay --to node.2 (UUID 변경, 구조 동일 → 성공) ──
    nock.cleanAll();

    // POST /api/users → 새 UUID
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "test-token-123" });

    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "uuid-bbb-222", name: "홍길동" });

    // GET /api/users/uuid-bbb-222 → 치환된 URL
    nock(BASE_URL)
      .get("/api/users/uuid-bbb-222")
      .reply(200, { id: "uuid-bbb-222", name: "홍길동", status: "active" });

    const replayResult = await replayToNode({
      session: "test-flow",
      targetNode: 2,
      config: testConfig,
    });

    expect(replayResult.status).toBe("success");
    expect(replayResult.dbReset).toBe(true);
    expect(replayResult.replayed).toHaveLength(2);
    expect(replayResult.replayed[0].match).toBe(true);
    expect(replayResult.replayed[1].match).toBe(true);

    // 바인딩 갱신 확인: uuid-aaa-111 → uuid-bbb-222
    expect(replayResult.bindingUpdates["node.1.response.id"]).toEqual({
      old: "uuid-aaa-111",
      new: "uuid-bbb-222",
    });

    // 최종 bindings 갱신 확인
    const updatedBindings = await readJson<Bindings>("sessions/test-flow/bindings.json");
    expect(updatedBindings!["node.1.response.id"].value).toBe("uuid-bbb-222");

    // ── 6. Replay 분기 감지 (status 400) ──
    nock.cleanAll();

    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "test-token-123" });

    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(400, { error: "Bad Request" });

    const divergeResult = await replayToNode({
      session: "test-flow",
      targetNode: 1,
      config: testConfig,
    });

    expect(divergeResult.status).toBe("diverged");
    expect(divergeResult.divergedAt).toBe(1);
    expect(divergeResult.diff).not.toBeNull();

    // diff에 status 차이 포함
    const statusDiff = (divergeResult.diff as any[]).find(
      (d: any) => d.path?.includes("status"),
    );
    expect(statusDiff).toBeDefined();
    expect(statusDiff.lhs).toBe(201);
    expect(statusDiff.rhs).toBe(400);
  });
});
