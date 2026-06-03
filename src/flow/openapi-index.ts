import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { getTrackerRoot } from "../storage/file-store.js";
import type { OpenApiFieldSchema, OpenApiOperation } from "./types.js";

const METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Follow a single `$ref` like "#/components/schemas/Foo" within the spec. */
function resolveRef(spec: AnyRecord, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = spec;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** Resolve `$ref` chains, guarding against cycles. */
function deref(spec: AnyRecord, schema: unknown, seen = new Set<string>()): unknown {
  if (!isRecord(schema)) return schema;
  const ref = schema.$ref;
  if (typeof ref === "string") {
    if (seen.has(ref)) return {};
    seen.add(ref);
    return deref(spec, resolveRef(spec, ref), seen);
  }
  return schema;
}

/** Collect top-level object properties of a (possibly `allOf`-composed) schema. */
function extractBodyFields(spec: AnyRecord, rawSchema: unknown): OpenApiFieldSchema[] {
  const properties: AnyRecord = {};
  const required = new Set<string>();

  const merge = (node: unknown): void => {
    const schema = deref(spec, node);
    if (!isRecord(schema)) return;
    if (Array.isArray(schema.allOf)) {
      for (const part of schema.allOf) merge(part);
    }
    if (isRecord(schema.properties)) {
      Object.assign(properties, schema.properties);
    }
    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (typeof name === "string") required.add(name);
      }
    }
  };
  merge(rawSchema);

  return Object.entries(properties).map(([name, rawProp]) => {
    const prop = deref(spec, rawProp);
    const propRecord = isRecord(prop) ? prop : {};
    const itemsType =
      propRecord.type === "array"
        ? (deref(spec, propRecord.items) as AnyRecord | undefined)?.type
        : undefined;
    return {
      name,
      in: "body" as const,
      type: typeof propRecord.type === "string" ? propRecord.type : undefined,
      required: required.has(name),
      enum: Array.isArray(propRecord.enum) ? propRecord.enum : undefined,
      format: typeof propRecord.format === "string" ? propRecord.format : undefined,
      description: typeof propRecord.description === "string" ? propRecord.description : undefined,
      itemsType: typeof itemsType === "string" ? itemsType : undefined,
    };
  });
}

/** Extract path/query/header parameters, merging path-level and operation-level lists. */
function extractParamFields(
  spec: AnyRecord,
  pathItemParams: unknown,
  operationParams: unknown,
): OpenApiFieldSchema[] {
  const raw = [
    ...(Array.isArray(pathItemParams) ? pathItemParams : []),
    ...(Array.isArray(operationParams) ? operationParams : []),
  ];
  const fields: OpenApiFieldSchema[] = [];
  for (const entry of raw) {
    const param = deref(spec, entry);
    if (!isRecord(param) || typeof param.name !== "string") continue;
    const location =
      param.in === "path" || param.in === "query" || param.in === "header" ? param.in : "query";
    const schema = isRecord(deref(spec, param.schema)) ? (deref(spec, param.schema) as AnyRecord) : {};
    fields.push({
      name: param.name,
      in: location,
      type: typeof schema.type === "string" ? schema.type : undefined,
      required: typeof param.required === "boolean" ? param.required : location === "path",
      enum: Array.isArray(schema.enum) ? schema.enum : undefined,
      format: typeof schema.format === "string" ? schema.format : undefined,
      description: typeof param.description === "string" ? param.description : undefined,
    });
  }
  return fields;
}

/** Pull the application/json (or first available) request body schema for an operation. */
function requestBodySchema(spec: AnyRecord, operation: AnyRecord): unknown {
  const requestBody = deref(spec, operation.requestBody);
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) return undefined;
  const content = requestBody.content as AnyRecord;
  const media = content["application/json"] ?? Object.values(content)[0];
  if (!isRecord(media)) return undefined;
  return media.schema;
}

export async function loadOpenApiOperations(specPath: string): Promise<Map<string, OpenApiOperation>> {
  const resolvedPath = path.isAbsolute(specPath)
    ? specPath
    : path.join(getTrackerRoot(), specPath);
  const raw = await fs.readFile(resolvedPath, "utf-8");
  const spec = specPath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  const paths = spec?.paths;
  if (paths == null || typeof paths !== "object") {
    throw new Error("OpenAPI spec does not contain a paths object");
  }

  const result = new Map<string, OpenApiOperation>();
  for (const [apiPath, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!isRecord(pathItem)) continue;
    const pathItemParams = pathItem.parameters;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      if (!isRecord(operation)) continue;
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || operationId.length === 0) continue;
      if (result.has(operationId)) {
        throw new Error(`Duplicate OpenAPI operationId "${operationId}"`);
      }
      const bodyFields = extractBodyFields(spec, requestBodySchema(spec, operation));
      const paramFields = extractParamFields(spec, pathItemParams, operation.parameters);
      result.set(operationId, {
        operationId,
        method: method.toUpperCase(),
        path: apiPath,
        ...(bodyFields.length > 0 ? { bodyFields } : {}),
        ...(paramFields.length > 0 ? { paramFields } : {}),
      });
    }
  }

  return result;
}
