import type { Ref, Bindings } from "../types.js";

const REF_PATTERN = /\$ref\(([^)]+)\)/g;
const UUID_V4_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

// ── a) 템플릿 치환 ──

export function resolveTemplate(
  template: string,
  bindings: Bindings,
): { resolved: string; refs: Ref[] } {
  const refs: Ref[] = [];
  const resolved = template.replace(REF_PATTERN, (_, key: string) => {
    const entry = bindings[key];
    if (!entry) {
      throw new Error(`Binding not found for $ref(${key})`);
    }
    refs.push({ value: entry.value, source: key, boundAs: null });
    return String(entry.value);
  });
  return { resolved, refs };
}

export function resolveRequest(
  request: { path: string; body?: any },
  bindings: Bindings,
): { resolved: { path: string; body?: any }; refs: Ref[] } {
  const allRefs: Ref[] = [];

  const pathResult = resolveTemplate(request.path, bindings);
  allRefs.push(...pathResult.refs);

  let resolvedBody = request.body;
  if (request.body != null && typeof request.body === "object") {
    const bodyStr = JSON.stringify(request.body);
    const bodyResult = resolveTemplate(bodyStr, bindings);
    allRefs.push(...bodyResult.refs);
    resolvedBody = JSON.parse(bodyResult.resolved);
  } else if (typeof request.body === "string") {
    const bodyResult = resolveTemplate(request.body, bindings);
    allRefs.push(...bodyResult.refs);
    resolvedBody = bodyResult.resolved;
  }

  return {
    resolved: { path: pathResult.resolved, body: resolvedBody },
    refs: allRefs,
  };
}

// ── b) 자동 추론 ──

export function inferRefs(
  request: { path: string; body?: any },
  bindings: Bindings,
): Ref[] {
  const refs: Ref[] = [];
  const text =
    request.body != null
      ? request.path + " " + (typeof request.body === "string" ? request.body : JSON.stringify(request.body))
      : request.path;

  const uuids = text.match(UUID_V4_PATTERN);
  if (!uuids) return refs;

  const seen = new Set<string>();
  for (const uuid of uuids) {
    const lower = uuid.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    let matched = false;
    for (const [key, entry] of Object.entries(bindings)) {
      if (typeof entry.value === "string" && entry.value.toLowerCase() === lower) {
        refs.push({ value: uuid, source: `auto:${key}`, boundAs: null });
        matched = true;
        break;
      }
    }
    if (!matched) {
      refs.push({ value: uuid, source: "unknown", boundAs: null });
    }
  }

  return refs;
}

// ── c) 바인딩 등록 ──

function isNumericId(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isUuidV4(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shouldRegister(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return false;
  if (typeof value === "string" && value === "") return false;
  if (isUuidV4(value) || isNumericId(value)) return true;
  // Register other non-empty string values too (like names)
  if (typeof value === "string") return true;
  return false;
}

export function extractBindings(
  edgeId: number,
  toNode: number,
  responseBody: any,
): Record<string, { value: any; origin: string; jsonPath: string }> {
  const result: Record<string, { value: any; origin: string; jsonPath: string }> = {};

  function walk(obj: unknown, pathParts: string[]): void {
    if (obj == null || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const item = obj[i];
        const itemPath = [...pathParts, `[${i}]`];
        if (item != null && typeof item === "object") {
          walk(item, itemPath);
        } else if (shouldRegister(item)) {
          const jsonPath = itemPath.join(".");
          const key = `node.${toNode}.response.${jsonPath}`;
          result[key] = { value: item, origin: `edge.${edgeId}`, jsonPath };
        }
      }
    } else {
      for (const [k, v] of Object.entries(obj)) {
        const childPath = [...pathParts, k];
        if (v != null && typeof v === "object") {
          walk(v, childPath);
        } else if (shouldRegister(v)) {
          const jsonPath = childPath.join(".");
          const key = `node.${toNode}.response.${jsonPath}`;
          result[key] = { value: v, origin: `edge.${edgeId}`, jsonPath };
        }
      }
    }
  }

  walk(responseBody, []);
  return result;
}
