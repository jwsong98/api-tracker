import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson, readYaml } from "../file-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-test-"));
  process.env.API_TRACKER_ROOT = tmpDir;
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeJson → readJson round-trip", () => {
  it("should write and read back the same data", async () => {
    const data = { hello: "world", count: 42, nested: { a: [1, 2, 3] } };
    await writeJson("test.json", data);
    const result = await readJson("test.json");
    expect(result).toEqual(data);
  });
});

describe("readJson non-existent file", () => {
  it("should return null for missing files", async () => {
    const result = await readJson("does-not-exist.json");
    expect(result).toBeNull();
  });
});

describe("writeJson nested directory creation", () => {
  it("should auto-create nested directories", async () => {
    const data = { ok: true };
    await writeJson("a/b/c/deep.json", data);
    const result = await readJson("a/b/c/deep.json");
    expect(result).toEqual(data);
  });
});

describe("readYaml", () => {
  it("should parse a YAML file", async () => {
    const yamlContent = `server:\n  baseUrl: "http://localhost:8080"\n`;
    await fs.writeFile(path.join(tmpDir, "config.yaml"), yamlContent, "utf-8");
    const result = await readYaml<{ server: { baseUrl: string } }>("config.yaml");
    expect(result.server.baseUrl).toBe("http://localhost:8080");
  });

  it("should throw for missing YAML file", async () => {
    await expect(readYaml("missing.yaml")).rejects.toThrow("not found");
  });
});
