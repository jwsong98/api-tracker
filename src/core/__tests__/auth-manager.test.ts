import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nock from "nock";
import { login, getToken, refreshOnUnauthorized, getAuthStatus } from "../auth-manager.js";
import { writeJson, readJson } from "../../storage/file-store.js";
import type { AuthCache, Config } from "../../types.js";

const BASE_URL = "http://localhost:9999";

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
      user: {
        endpoint: "/auth/login",
        method: "POST",
        credentials: { email: "user@test.com", password: "test1234" },
        tokenPath: "$.data.token",
        note: "normal user",
      },
    },
  },
  db: { resetCommand: "echo reset", resetWorkingDir: "." },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-auth-"));
  process.env.API_TRACKER_ROOT = tmpDir;
  // Write config.yaml so loadConfig works
  const YAML = await import("yaml");
  await fs.writeFile(path.join(tmpDir, "config.yaml"), YAML.stringify(testConfig), "utf-8");
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("login", () => {
  it("should login and cache token in auth.json", async () => {
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", expiresAt: "2026-12-31T00:00:00Z" });

    const result = await login("admin");

    expect(result.token).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(result.expiresAt).toBe("2026-12-31T00:00:00Z");

    const cache = await readJson<AuthCache>("auth.json");
    expect(cache!.admin.token).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(cache!.admin.note).toBe("admin user");
  });

  it("should extract nested tokenPath", async () => {
    nock(BASE_URL)
      .post("/auth/login", { email: "user@test.com", password: "test1234" })
      .reply(200, { data: { token: "nested-token-value" } });

    const result = await login("user");
    expect(result.token).toBe("nested-token-value");
  });

  it("should throw on unknown profile", async () => {
    await expect(login("nonexistent")).rejects.toThrow('Auth profile "nonexistent" not found');
  });

  it("should throw on login API failure (401)", async () => {
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(401, "Unauthorized");

    await expect(login("admin")).rejects.toThrow(/Login failed.*401/);
  });
});

describe("getToken", () => {
  it("should return cached token", async () => {
    const cache: AuthCache = {
      admin: { token: "cached-token", expiresAt: "", note: "admin" },
    };
    await writeJson("auth.json", cache);

    const token = await getToken("admin");
    expect(token).toBe("cached-token");
  });

  it("should auto-login when no cached token", async () => {
    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "auto-login-token" });

    const token = await getToken("admin");
    expect(token).toBe("auto-login-token");
  });
});

describe("refreshOnUnauthorized", () => {
  it("should force re-login and return new token", async () => {
    // Pre-cache old token
    await writeJson("auth.json", {
      admin: { token: "old-token", expiresAt: "", note: "admin" },
    });

    nock(BASE_URL)
      .post("/auth/login", { email: "admin@test.com", password: "test1234" })
      .reply(200, { accessToken: "new-refreshed-token" });

    const token = await refreshOnUnauthorized("admin");
    expect(token).toBe("new-refreshed-token");

    const cache = await readJson<AuthCache>("auth.json");
    expect(cache!.admin.token).toBe("new-refreshed-token");
  });
});

describe("getAuthStatus", () => {
  it("should return full auth cache", async () => {
    const cache: AuthCache = {
      admin: { token: "t1", expiresAt: "", note: "admin" },
      user: { token: "t2", expiresAt: "", note: "user" },
    };
    await writeJson("auth.json", cache);

    const status = await getAuthStatus();
    expect(status).toEqual(cache);
  });

  it("should return empty object when no auth.json", async () => {
    const status = await getAuthStatus();
    expect(status).toEqual({});
  });
});
