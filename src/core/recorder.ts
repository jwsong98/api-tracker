import type { Edge, Ref, SessionMeta, GraphData, Bindings } from "../types.js";
import { readJson, writeJson } from "../storage/file-store.js";
import { extractBindings } from "./binding-engine.js";

export async function recordEdge(options: {
  session: string;
  method: string;
  path: string;
  body?: any;
  authProfile?: string;
  templatePath: string;
  templateBody?: any;
  refs: Ref[];
  response: { status: number; headers: Record<string, string>; body: any };
  warnings: string[];
}): Promise<{ edgeId: number; fromNode: number; toNode: number; newBindings: Bindings }> {
  const { session } = options;
  const prefix = `sessions/${session}`;

  // 1. Read current meta
  const meta = await readJson<SessionMeta>(`${prefix}/meta.json`);
  if (!meta) throw new Error(`Session "${session}" not found`);

  // 2. Compute IDs
  const edgeId = meta.edgeCount + 1;
  const fromNode = meta.lastNodeId;
  const toNode = meta.lastNodeId + 1;

  // 3. Build Edge object
  const edge: Edge = {
    edgeId,
    fromNode,
    toNode,
    timestamp: new Date().toISOString(),
    request: {
      method: options.method,
      path: options.path,
      headers: {},
      body: options.body,
      template: {
        path: options.templatePath,
        body: options.templateBody,
      },
    },
    response: options.response,
    refs: options.refs,
    warnings: options.warnings,
    authProfile: options.authProfile ?? "",
  };

  // 4. Save edge file (3-digit zero-padded)
  const edgeFile = String(edgeId).padStart(3, "0");
  await writeJson(`${prefix}/edges/${edgeFile}.json`, edge);

  // 5. Update graph.json
  const graph = await readJson<GraphData>(`${prefix}/graph.json`) ?? { nodes: [], edges: [] };
  const nodeLabel = `${options.method} ${options.path} → ${options.response.status}`;
  graph.nodes.push({ id: toNode, label: nodeLabel });
  graph.edges.push({ id: edgeId, from: fromNode, to: toNode, file: `${edgeFile}.json` });
  await writeJson(`${prefix}/graph.json`, graph);

  // 6. Extract and merge bindings
  const newBindings = extractBindings(edgeId, toNode, options.response.body);
  const bindings = await readJson<Bindings>(`${prefix}/bindings.json`) ?? {};
  Object.assign(bindings, newBindings);
  await writeJson(`${prefix}/bindings.json`, bindings);

  // 7. Update meta
  meta.lastNodeId = toNode;
  meta.edgeCount = edgeId;
  await writeJson(`${prefix}/meta.json`, meta);

  return { edgeId, fromNode, toNode, newBindings };
}
