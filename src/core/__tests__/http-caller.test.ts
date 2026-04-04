import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nock from "nock";
import { callApi, callWithAuth } from "../http-caller.js";
import YAML from "yaml";
import type { Config } from "../../types.js";

const BASE_URL = "http://localhost:9876";

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
        note: "admin user",
      },
    },
  },
  db: { resetCommand: "echo reset", resetWorkingDir: "." },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-http-"));
  process.env.API_TRACKER_ROOT = tmpDir;
  await fs.writeFile(
    path.join(tmpDir, "config.yaml"),
    YAML.stringify(testConfig),
    "utf-8",
  );
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("callApi", () => {
  it("should perform a basic GET and return 200", async () => {
    nock(BASE_URL).get("/api/users").reply(200, { users: [] });

    const res = await callApi({ method: "GET", url: `${BASE_URL}/api/users` });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [] });
  });

  it("should POST with body and return response", async () => {
    nock(BASE_URL)
      .post("/api/users", { name: "홍길동" })
      .reply(201, { id: "abc-123", name: "홍길동" });

    const res = await callApi({
      method: "POST",
      url: `${BASE_URL}/api/users`,
      body: { name: "홍길동" },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "abc-123", name: "홍길동" });
  });
});

describe("callWithAuth", () => {
  it("should retry on 401 and succeed on second attempt", async () => {
    // Pre-cache a token
    await fs.writeFile(
      path.join(tmpDir, "auth.json"),
      JSON.stringify({ admin: { token: "old-token", expiresAt: "", note: "admin" } }),
      "utf-8",
    );

    // First call returns 401
    nock(BASE_URL)
      .get("/api/data")
      .matchHeader("Authorization", "Bearer old-token")
      .reply(401, { error: "Unauthorized" });

    // refreshOnUnauthorized will call login
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "new-token" });

    // Retry with new token
    nock(BASE_URL)
      .get("/api/data")
      .matchHeader("Authorization", "Bearer new-token")
      .reply(200, { data: "success" });

    const res = await callWithAuth({
      method: "GET",
      url: `${BASE_URL}/api/data`,
      authProfile: "admin",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "success" });
  });

  it("should return 401 when retry also fails", async () => {
    // Pre-cache a token
    await fs.writeFile(
      path.join(tmpDir, "auth.json"),
      JSON.stringify({ admin: { token: "old-token", expiresAt: "", note: "admin" } }),
      "utf-8",
    );

    // First call returns 401
    nock(BASE_URL)
      .get("/api/data")
      .matchHeader("Authorization", "Bearer old-token")
      .reply(401, { error: "Unauthorized" });

    // refreshOnUnauthorized calls login
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "still-bad-token" });

    // Retry also returns 401
    nock(BASE_URL)
      .get("/api/data")
      .matchHeader("Authorization", "Bearer still-bad-token")
      .reply(401, { error: "Still Unauthorized" });

    const res = await callWithAuth({
      method: "GET",
      url: `${BASE_URL}/api/data`,
      authProfile: "admin",
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Still Unauthorized" });
  });
});
