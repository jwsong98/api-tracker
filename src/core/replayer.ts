import type {
  Config,
  SessionMeta,
  GraphData,
  Edge,
  Bindings,
  EdgeResponse,
} from "../types.js";
import { readJson, writeJson } from "../storage/file-store.js";
import { resolveRequest, extractBindings } from "./binding-engine.js";
import { callWithAuth } from "./http-caller.js";
import { resetDatabase } from "./db-resetter.js";
import { diffResponses } from "../output/diff.js";

export type ReplayResult = {
  status: "success" | "diverged";
  dbReset: boolean;
  targetNode: number;
  replayed: Array<{
    edgeId: number;
    originalStatus: number;
    actualStatus: number;
    match: boolean;
  }>;
  bindingUpdates: Record<string, { old: string; new: string }>;
  divergedAt?: number;
  diff?: any;
};

/** Build path from Node 0 to targetNode by backtracking parent edges. */
function buildPath(graph: GraphData, targetNode: number): number[] {
  if (targetNode === 0) return [];

  // Map: toNode -> edge
  const parentMap = new Map<number, { id: number; from: number }>();
  for (const edge of graph.edges) {
    parentMap.set(edge.to, { id: edge.id, from: edge.from });
  }

  const edgeIds: number[] = [];
  let current = targetNode;
  while (current !== 0) {
    const parent = parentMap.get(current);
    if (!parent) {
      throw new Error(`No path found to node ${targetNode}: node ${current} has no parent edge`);
    }
    edgeIds.push(parent.id);
    current = parent.from;
  }

  return edgeIds.reverse();
}

/** Collect all edges across chained sessions, from the root session forward. */
async function collectChainedEdges(
  sessionName: string,
  edgeIdsInSession: number[],
): Promise<Array<{ session: string; edgeId: number }>> {
  const meta = await readJson<SessionMeta>(`sessions/${sessionName}/meta.json`);
  if (!meta) throw new Error(`Session "${sessionName}" not found`);

  if (meta.continueFrom) {
    // Get all edges from the source session first
    const sourceGraph = await readJson<GraphData>(
      `sessions/${meta.continueFrom}/graph.json`,
    );
    if (!sourceGraph) {
      throw new Error(`Source session "${meta.continueFrom}" graph not found`);
    }
    const sourceEdgeIds = sourceGraph.edges.map((e) => e.id);
    const parentEdges = await collectChainedEdges(meta.continueFrom, sourceEdgeIds);
    const currentEdges = edgeIdsInSession.map((id) => ({
      session: sessionName,
      edgeId: id,
    }));
    return [...parentEdges, ...currentEdges];
  }

  return edgeIdsInSession.map((id) => ({ session: sessionName, edgeId: id }));
}

function edgeFileName(edgeId: number): string {
  return String(edgeId).padStart(3, "0");
}

export async function replayToNode(options: {
  session: string;
  targetNode: number;
  config: Config;
}): Promise<ReplayResult> {
  const { session, targetNode, config } = options;

  // 1. Load graph and compute path
  const graph = await readJson<GraphData>(`sessions/${session}/graph.json`);
  if (!graph) throw new Error(`Session "${session}" graph not found`);

  const nodeExists = graph.nodes.some((n) => n.id === targetNode);
  if (!nodeExists) {
    throw new Error(`Node ${targetNode} does not exist in session "${session}"`);
  }

  const edgeIdsInSession = buildPath(graph, targetNode);

  // 2. Chain session handling
  const allEdges = await collectChainedEdges(session, edgeIdsInSession);

  // 3. DB reset
  const dbResult = await resetDatabase(config);
  if (!dbResult.success) {
    throw new Error(`DB reset failed: ${dbResult.output}`);
  }

  // 4. Sequential replay
  // Load original bindings for comparison (to detect binding changes)
  const originalBindings: Bindings =
    (await readJson<Bindings>(`sessions/${session}/bindings.json`)) ?? {};
  let bindings: Bindings = {};
  const replayed: ReplayResult["replayed"] = [];
  const bindingUpdates: Record<string, { old: string; new: string }> = {};

  for (const { session: edgeSession, edgeId } of allEdges) {
    const edgeFile = `sessions/${edgeSession}/edges/${edgeFileName(edgeId)}.json`;
    const edge = await readJson<Edge>(edgeFile);
    if (!edge) throw new Error(`Edge file not found: ${edgeFile}`);

    // a. Resolve template with current bindings
    const { resolved } = resolveRequest(
      { path: edge.request.template.path, body: edge.request.template.body },
      bindings,
    );

    // b. HTTP call
    const url = `${config.server.baseUrl}${resolved.path}`;
    const actual = await callWithAuth({
      method: edge.request.method,
      url,
      body: resolved.body,
      authProfile: edge.authProfile || undefined,
    });

    // c. Diff
    const originalResponse: EdgeResponse = edge.response;
    const actualResponse: EdgeResponse = {
      status: actual.status,
      headers: actual.headers,
      body: actual.body,
    };
    const { match, diff } = diffResponses(originalResponse, actualResponse);

    replayed.push({
      edgeId,
      originalStatus: originalResponse.status,
      actualStatus: actual.status,
      match,
    });

    if (!match) {
      // f. Diverged - stop immediately
      return {
        status: "diverged",
        dbReset: true,
        targetNode,
        replayed,
        bindingUpdates,
        divergedAt: edgeId,
        diff,
      };
    }

    // e. Extract bindings from new response and update
    const newBindings = extractBindings(edge.edgeId, edge.toNode, actual.body);
    for (const [key, entry] of Object.entries(newBindings)) {
      // Compare against original session bindings or previously replayed bindings
      const oldValue = originalBindings[key] ?? bindings[key];
      if (oldValue && String(oldValue.value) !== String(entry.value)) {
        bindingUpdates[key] = {
          old: String(oldValue.value),
          new: String(entry.value),
        };
      }
      bindings[key] = entry;
    }
  }

  // 5. Write updated bindings
  await writeJson(`sessions/${session}/bindings.json`, bindings);

  return {
    status: "success",
    dbReset: true,
    targetNode,
    replayed,
    bindingUpdates,
  };
}
