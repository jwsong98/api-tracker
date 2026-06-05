import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nock from "nock";
import YAML from "yaml";
import { createSession } from "../../core/session-manager.js";
import { readJson } from "../../storage/file-store.js";
import { createFlowSessionState } from "../flow-session-store.js";
import { buildActionView, describeAvailableActions, runFlowAction } from "../flow-runtime.js";
import { loadOpenApiOperations } from "../openapi-index.js";
import type { Config } from "../../types.js";
import type { FlowConfig, FlowSessionState } from "../types.js";

const BASE_URL = "http://localhost:8765";

const config: Config = {
  server: { baseUrl: BASE_URL },
  openapi: { specPath: "./openapi.yaml" },
  auth: { profiles: {} },
  db: { resetCommand: "echo reset", resetWorkingDir: "." },
};

const flow: FlowConfig = {
  version: 1,
  initialState: "project_list",
  states: {
    project_list: {
      route: "/projects",
      actions: {
        load_projects: {
          to: "project_list",
          calls: [
            {
              id: "listProjects",
              operationId: "listProjects",
              expect: { status: 200 },
              observe: {
                project: {
                  id: "$.body.projects[*].id",
                  label: "$.body.projects[*].name",
                },
              },
            },
          ],
        },
        open_project_detail: {
          to: "project_detail",
          requires: {
            project: { observedAs: "project" },
          },
          calls: [
            {
              id: "getProject",
              operationId: "getProject",
              params: {
                projectId: "${project.id}",
              },
              expect: { status: 200 },
              save: { currentProjectId: "$.body.id" },
            },
          ],
        },
        create_project: {
          to: "project_detail",
          manual: ["name", "visibility"],
          calls: [
            {
              id: "createProject",
              operationId: "createProject",
              body: {
                name: "${manual.name}",
                visibility: "${manual.visibility}",
              },
              expect: { status: 201 },
              save: { currentProjectId: "$.body.id" },
              observe: {
                project: {
                  id: "$.body.id",
                  label: "$.body.name",
                },
              },
            },
          ],
        },
      },
    },
    project_detail: {
      route: "/projects/:projectId",
      load: [
        {
          id: "listMembers",
          operationId: "listMembers",
          params: { projectId: "${currentProjectId}" },
          expect: { status: 200 },
          observe: {
            member: { id: "$.body.members[*].id", label: "$.body.members[*].name" },
          },
        },
      ],
      actions: {},
    },
  },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-flow-"));
  process.env.API_TRACKER_ROOT = tmpDir;
  await fs.writeFile(path.join(tmpDir, "config.yaml"), YAML.stringify(config), "utf-8");
  await fs.writeFile(
    path.join(tmpDir, "openapi.yaml"),
    YAML.stringify({
      openapi: "3.0.0",
      paths: {
        "/projects": {
          get: { operationId: "listProjects" },
          post: { operationId: "createProject" },
        },
        "/projects/{projectId}": {
          get: { operationId: "getProject" },
        },
        "/projects/{projectId}/members": {
          get: { operationId: "listMembers" },
        },
      },
    }),
    "utf-8",
  );
  await createSession({ name: "flow-test" });
  await createFlowSessionState("flow-test", flow);
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("runFlowAction", () => {
  it("observes resources and allows a later action to use only observed IDs", async () => {
    nock(BASE_URL)
      .get("/projects")
      .reply(200, {
        projects: [
          { id: "p1", name: "Demo" },
          { id: "p2", name: "Internal" },
        ],
      });

    const listResult = await runFlowAction({
      config,
      flow,
      session: "flow-test",
      actionId: "load_projects",
    });

    expect(listResult.to).toBe("project_list");
    expect(listResult.calls[0].observed).toEqual(["project"]);

    const stateAfterList = await readJson<FlowSessionState>("sessions/flow-test/flow-state.json");
    expect(stateAfterList!.observed.project.map((item) => item.id)).toEqual(["p1", "p2"]);

    const operations = await loadOpenApiOperations(config.openapi.specPath);
    const view = buildActionView(flow, stateAfterList!, "open_project_detail", operations);
    expect(view.inputs.observed[0]).toMatchObject({ input: "project", observedAs: "project" });
    expect(view.inputs.observed[0].candidates[0]).toMatchObject({ id: "p1", label: "Demo" });

    nock(BASE_URL).get("/projects/p1").reply(200, { id: "p1", name: "Demo" });
    nock(BASE_URL).get("/projects/p1/members").reply(200, { members: [] });

    const detailResult = await runFlowAction({
      config,
      flow,
      session: "flow-test",
      actionId: "open_project_detail",
      inputs: { project: "p1" },
    });

    expect(detailResult.from).toBe("project_list");
    expect(detailResult.to).toBe("project_detail");
    expect(detailResult.calls[0].path).toBe("/projects/p1");
  });

  it("auto-loads the destination screen, pooling data from another API", async () => {
    nock(BASE_URL)
      .get("/projects")
      .reply(200, { projects: [{ id: "p1", name: "Demo" }] });

    await runFlowAction({ config, flow, session: "flow-test", actionId: "load_projects" });

    nock(BASE_URL).get("/projects/p1").reply(200, { id: "p1", name: "Demo" });
    nock(BASE_URL)
      .get("/projects/p1/members")
      .reply(200, { members: [{ id: "m1", name: "Alice" }, { id: "m2", name: "Bob" }] });

    const detailResult = await runFlowAction({
      config,
      flow,
      session: "flow-test",
      actionId: "open_project_detail",
      inputs: { project: "p1" },
    });

    // The transition call and the screen's load call are reported separately.
    expect(detailResult.calls[0].path).toBe("/projects/p1");
    expect(detailResult.loaded[0]).toMatchObject({
      operationId: "listMembers",
      path: "/projects/p1/members",
      observed: ["member"],
    });

    // Members loaded by the screen land in the shared observed pool.
    const state = await readJson<FlowSessionState>("sessions/flow-test/flow-state.json");
    expect(state!.currentState).toBe("project_detail");
    expect(state!.observed.member.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(state!.saved.currentProjectId).toBe("p1");
  });

  it("blocks unobserved IDs", async () => {
    await expect(
      runFlowAction({
        config,
        flow,
        session: "flow-test",
        actionId: "open_project_detail",
        inputs: { project: "p999" },
      }),
    ).rejects.toThrow('Input "project" value "p999" was not observed');
  });

  it("guides the user to a producer action when required input is missing", async () => {
    await expect(
      runFlowAction({
        config,
        flow,
        session: "flow-test",
        actionId: "open_project_detail",
      }),
    ).rejects.toThrow("load_projects");
  });

  it("uses manual values for create/update request bodies", async () => {
    nock(BASE_URL)
      .post("/projects", { name: "Demo", visibility: "private" })
      .reply(201, { id: "p-created", name: "Demo" });
    nock(BASE_URL).get("/projects/p-created/members").reply(200, { members: [] });

    const result = await runFlowAction({
      config,
      flow,
      session: "flow-test",
      actionId: "create_project",
      values: { name: "Demo", visibility: "private" },
    });

    expect(result.to).toBe("project_detail");
    expect(result.calls[0]).toMatchObject({
      operationId: "createProject",
      path: "/projects",
      status: 201,
      observed: ["project"],
    });

    const state = await readJson<FlowSessionState>("sessions/flow-test/flow-state.json");
    expect(state!.observed.project[0]).toMatchObject({ id: "p-created", label: "Demo" });
  });

  it("blocks manual actions when a declared manual value is missing", async () => {
    await expect(
      runFlowAction({
        config,
        flow,
        session: "flow-test",
        actionId: "create_project",
        values: { name: "Demo" },
      }),
    ).rejects.toThrow('Missing manual value "visibility"');
  });

  it("does not transition state when an expected status does not match", async () => {
    nock(BASE_URL).get("/projects").reply(500, { error: "boom" });

    await expect(
      runFlowAction({
        config,
        flow,
        session: "flow-test",
        actionId: "load_projects",
      }),
    ).rejects.toThrow("expected status 200, got 500");

    const state = await readJson<FlowSessionState>("sessions/flow-test/flow-state.json");
    expect(state!.currentState).toBe("project_list");
    expect(state!.history[0]).toMatchObject({ action: "load_projects", ok: false });
  });
});

describe("agent contract (envelope)", () => {
  it("describes every available action with its observed and manual inputs", async () => {
    const state = await readJson<FlowSessionState>("sessions/flow-test/flow-state.json");
    const operations = await loadOpenApiOperations(config.openapi.specPath);
    const views = describeAvailableActions(flow, state!, operations);

    const create = views.find((v) => v.id === "create_project");
    expect(create).toMatchObject({ to: "project_detail" });
    expect(create!.inputs.manual.map((m) => m.name)).toEqual(["name", "visibility"]);

    const open = views.find((v) => v.id === "open_project_detail");
    expect(open!.inputs.observed).toEqual([
      { input: "project", observedAs: "project", candidates: [] },
    ]);
  });

  it("raises a coded FlowError for guard failures", async () => {
    await expect(
      runFlowAction({
        config,
        flow,
        session: "flow-test",
        actionId: "open_project_detail",
        inputs: { project: "p999" },
      }),
    ).rejects.toMatchObject({ code: "INPUT_NOT_OBSERVED", details: { input: "project", requestedId: "p999" } });
  });
});
