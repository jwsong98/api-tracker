import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initProject } from "../initializer.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-init-"));
  process.env.API_TRACKER_ROOT = path.join(tmpDir, ".api-tracker");
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates example config, OpenAPI, and flow files", async () => {
    const result = await initProject();

    expect(result.created.sort()).toEqual(["config.yaml", "flow.yaml", "openapi.yaml"]);
    expect(result.skipped).toEqual([]);

    const flow = await fs.readFile(path.join(result.root, "flow.yaml"), "utf-8");
    expect(flow).toContain("initialState: login");
    expect(flow).toContain("create_project:");
    expect(flow).toContain('name: "${manual.name}"');
    expect(flow).toContain("open_project_detail:");

    const openapi = await fs.readFile(path.join(result.root, "openapi.yaml"), "utf-8");
    expect(openapi).toContain("operationId: createProject");
    expect(openapi).toContain("operationId: updateProject");
  });

  it("skips existing files by default", async () => {
    await initProject();
    await fs.writeFile(path.join(process.env.API_TRACKER_ROOT!, "flow.yaml"), "custom", "utf-8");

    const result = await initProject();

    expect(result.created).toEqual([]);
    expect(result.skipped.sort()).toEqual(["config.yaml", "flow.yaml", "openapi.yaml"]);
    await expect(
      fs.readFile(path.join(process.env.API_TRACKER_ROOT!, "flow.yaml"), "utf-8"),
    ).resolves.toBe("custom");
  });

  it("overwrites existing files when force is true", async () => {
    await initProject();
    await fs.writeFile(path.join(process.env.API_TRACKER_ROOT!, "flow.yaml"), "custom", "utf-8");

    const result = await initProject({ force: true });

    expect(result.created.sort()).toEqual(["config.yaml", "flow.yaml", "openapi.yaml"]);
    expect(result.skipped).toEqual([]);
    const flow = await fs.readFile(path.join(process.env.API_TRACKER_ROOT!, "flow.yaml"), "utf-8");
    expect(flow).toContain("initialState: login");
  });
});
