import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nock from "nock";
import YAML from "yaml";
import { runScenario } from "../scenario-runner.js";
import { readScenarioResult } from "../scenario-store.js";
import type { Config } from "../../types.js";
import type { ScenarioConfig } from "../types.js";

const BASE_URL = "http://localhost:8799";
const UUID = "b3f1c2d4-1111-4222-8333-444455556666";
const SESSION = "demo-scn";

const config: Config = {
  server: { baseUrl: BASE_URL },
  openapi: { specPath: "./openapi.yaml" },
  auth: { profiles: {} },
  db: { resetCommand: "echo reset", resetWorkingDir: "." },
};

const flow = {
  version: 1,
  initialState: "project_list",
  states: {
    project_list: {
      route: "/projects",
      actions: {
        create_project: {
          to: "project_detail",
          manual: ["name", "visibility"],
          calls: [
            {
              operationId: "createProject",
              body: { name: "${manual.name}", visibility: "${manual.visibility}" },
              expect: { status: 201 },
              save: { currentProjectId: "$.body.id" },
              observe: { project: { id: "$.body.id", label: "$.body.name" } },
            },
          ],
        },
      },
    },
    project_detail: { route: "/projects/{projectId}", actions: {} },
  },
};

const openapi = {
  openapi: "3.0.0",
  paths: {
    "/projects": {
      get: { operationId: "listProjects" },
      post: { operationId: "createProject" },
    },
    "/projects/{projectId}": { get: { operationId: "getProject" } },
  },
};

function makeScenario(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    version: 1,
    ticket: "DEMO-1",
    title: "created project shows in list",
    params: { visibility: "private" },
    baseline: [{ operationId: "listProjects", save: { count: "$.body.total" } }],
    steps: [
      {
        action: "create_project",
        inputs: { "manual.name": "Made", "manual.visibility": "${params.visibility}" },
      },
    ],
    goal: [
      {
        name: "created project is fetchable with a uuid id",
        operationId: "getProject",
        params: { projectId: "${saved.currentProjectId}" },
        assert: { status: 200, body: { "$.body.id": { isUuid: true } } },
      },
      {
        name: "list count grew by one",
        operationId: "listProjects",
        assert: { status: 200, body: { "$.body.total": { equals: "${baseline.count + 1}" } } },
      },
    ],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-scenario-"));
  process.env.API_TRACKER_ROOT = tmpDir;
  await fs.writeFile(path.join(tmpDir, "config.yaml"), YAML.stringify(config), "utf-8");
  await fs.writeFile(path.join(tmpDir, "flow.yaml"), YAML.stringify(flow), "utf-8");
  await fs.writeFile(path.join(tmpDir, "openapi.yaml"), YAML.stringify(openapi), "utf-8");
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("runScenario", () => {
  it("is GREEN when steps walk the flow and every goal holds", async () => {
    nock(BASE_URL).get("/projects").reply(200, { projects: [{ id: "p1" }], total: 1 });
    nock(BASE_URL).post("/projects", { name: "Made", visibility: "private" }).reply(201, { id: UUID, name: "Made" });
    nock(BASE_URL).get(`/projects/${UUID}`).reply(200, { id: UUID, name: "Made" });
    nock(BASE_URL).get("/projects").reply(200, { projects: [{ id: "p1" }, { id: UUID }], total: 2 });

    const result = await runScenario({ config, scenario: makeScenario(), scenarioPath: "scenarios/demo.yaml", session: SESSION });

    expect(result.overall).toBe("green");
    expect(result.attempt).toBe(1);
    expect(result.baseline[0]).toMatchObject({ status: "passed", saved: ["count"] });
    expect(result.steps[0]).toMatchObject({ status: "passed", from: "project_list", to: "project_detail" });
    expect(result.goal.map((g) => g.status)).toEqual(["passed", "passed"]);

    // Result is persisted for browse/status.
    const persisted = await readScenarioResult(SESSION);
    expect(persisted!.overall).toBe("green");
  });

  it("is RED when a goal assertion fails, reporting expected vs actual", async () => {
    nock(BASE_URL).get("/projects").reply(200, { projects: [{ id: "p1" }], total: 1 });
    nock(BASE_URL).post("/projects", { name: "Made", visibility: "private" }).reply(201, { id: UUID, name: "Made" });
    nock(BASE_URL).get(`/projects/${UUID}`).reply(200, { id: UUID, name: "Made" });
    nock(BASE_URL).get("/projects").reply(200, { projects: [], total: 5 }); // count did NOT grow by one

    const result = await runScenario({ config, scenario: makeScenario(), scenarioPath: "scenarios/demo.yaml", session: SESSION });

    expect(result.overall).toBe("red");
    expect(result.steps[0].status).toBe("passed");
    expect(result.goal[0].status).toBe("passed");
    expect(result.goal[1]).toMatchObject({ status: "failed", error: { kind: "assert.body", path: "$.body.total", expected: 2, actual: 5 } });
  });

  it("blocks steps and leaves goals pending when a step fails", async () => {
    nock(BASE_URL).get("/projects").reply(200, { projects: [{ id: "p1" }], total: 1 });
    nock(BASE_URL).post("/projects").reply(500, { error: "boom" }); // create fails the guard

    const result = await runScenario({ config, scenario: makeScenario(), scenarioPath: "scenarios/demo.yaml", session: SESSION });

    expect(result.overall).toBe("red");
    expect(result.steps[0]).toMatchObject({ status: "failed", error: { kind: "UNEXPECTED_STATUS" } });
    expect(result.goal.map((g) => g.status)).toEqual(["pending", "pending"]);
  });

  it("increments the attempt counter across reruns of the same session", async () => {
    nock(BASE_URL).get("/projects").reply(200, { projects: [], total: 0 });
    nock(BASE_URL).post("/projects").reply(500, {});
    await runScenario({ config, scenario: makeScenario(), scenarioPath: "scenarios/demo.yaml", session: SESSION });

    nock(BASE_URL).get("/projects").reply(200, { projects: [], total: 0 });
    nock(BASE_URL).post("/projects").reply(500, {});
    const second = await runScenario({ config, scenario: makeScenario(), scenarioPath: "scenarios/demo.yaml", session: SESSION });

    expect(second.attempt).toBe(2);
  });
});
