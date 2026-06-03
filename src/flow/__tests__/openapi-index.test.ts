import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { loadOpenApiOperations } from "../openapi-index.js";
import { describeManualFields } from "../flow-runtime.js";
import type { FlowConfig, FlowSessionState } from "../types.js";

const SPEC = {
  openapi: "3.0.0",
  paths: {
    "/projects": {
      post: {
        operationId: "createProject",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProject" },
            },
          },
        },
      },
    },
    "/projects/{projectId}": {
      parameters: [
        { name: "projectId", in: "path", required: true, schema: { type: "string" } },
      ],
      get: {
        operationId: "getProject",
        parameters: [
          { name: "expand", in: "query", schema: { type: "string", enum: ["members", "tasks"] } },
        ],
      },
    },
  },
  components: {
    schemas: {
      CreateProject: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Project name" },
          visibility: { type: "string", enum: ["public", "private"] },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tracker-openapi-"));
  process.env.API_TRACKER_ROOT = tmpDir;
  await fs.writeFile(path.join(tmpDir, "openapi.yaml"), YAML.stringify(SPEC), "utf-8");
});

afterEach(async () => {
  delete process.env.API_TRACKER_ROOT;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadOpenApiOperations schema extraction", () => {
  it("extracts body fields from a $ref'd request body schema", async () => {
    const ops = await loadOpenApiOperations("./openapi.yaml");
    const create = ops.get("createProject");
    expect(create?.bodyFields).toEqual([
      { name: "name", in: "body", type: "string", required: true, enum: undefined, format: undefined, description: "Project name", itemsType: undefined },
      { name: "visibility", in: "body", type: "string", required: false, enum: ["public", "private"], format: undefined, description: undefined, itemsType: undefined },
      { name: "tags", in: "body", type: "array", required: false, enum: undefined, format: undefined, description: undefined, itemsType: "string" },
    ]);
  });

  it("merges path-level and operation-level parameters", async () => {
    const ops = await loadOpenApiOperations("./openapi.yaml");
    const get = ops.get("getProject");
    expect(get?.paramFields).toEqual([
      { name: "projectId", in: "path", type: "string", required: true, enum: undefined, format: undefined, description: undefined },
      { name: "expand", in: "query", type: "string", required: false, enum: ["members", "tasks"], format: undefined, description: undefined },
    ]);
  });

  it("leaves schemaless operations without field info", async () => {
    const ops = await loadOpenApiOperations("./openapi.yaml");
    const create = ops.get("createProject");
    expect(create?.paramFields).toBeUndefined();
  });
});

describe("describeManualFields", () => {
  const flow: FlowConfig = {
    version: 1,
    initialState: "list",
    states: {
      list: {
        route: "/projects",
        actions: {
          create_project: {
            to: "list",
            manual: ["name", "visibility", "note"],
            calls: [{ operationId: "createProject", body: {} }],
          },
        },
      },
    },
  };
  const state = { currentState: "list", saved: {}, observed: {}, history: [] } as FlowSessionState;

  it("types manual keys that map to schema fields and degrades unknown keys", async () => {
    const ops = await loadOpenApiOperations("./openapi.yaml");
    const fields = describeManualFields(flow, state.currentState, "create_project", ops);
    expect(fields).toEqual([
      { name: "name", type: "string", required: true, enum: undefined, format: undefined, description: "Project name", itemsType: undefined, fromOperation: "createProject" },
      { name: "visibility", type: "string", required: false, enum: ["public", "private"], format: undefined, description: undefined, itemsType: undefined, fromOperation: "createProject" },
      { name: "note", required: true },
    ]);
  });
});
