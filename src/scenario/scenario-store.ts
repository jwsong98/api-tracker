import { readJson, writeJson, listFiles, readYaml } from "../storage/file-store.js";
import { listSessions } from "../core/session-manager.js";
import type { Edge } from "../types.js";
import type { ScenarioConfig, ScenarioResult } from "./types.js";

/**
 * Resolve a scenario CLI argument to a tracker-root-relative path. A bare name
 * ("defect-inspect") maps to "scenarios/defect-inspect.yaml"; a path with a
 * slash or extension is used as-is (with ".yaml" appended when extensionless).
 */
export function resolveScenarioPath(arg: string): string {
  let p = arg;
  if (!/\.(ya?ml)$/i.test(p)) p = `${p}.yaml`;
  if (!p.includes("/")) p = `scenarios/${p}`;
  return p;
}

export async function loadScenario(path: string): Promise<ScenarioConfig> {
  return readYaml<ScenarioConfig>(path);
}

export async function listScenarioPaths(): Promise<string[]> {
  const files = await listFiles("scenarios");
  return files.filter((f) => /\.(ya?ml)$/i.test(f)).map((f) => `scenarios/${f}`);
}

export async function readScenarioResult(session: string): Promise<ScenarioResult | null> {
  return readJson<ScenarioResult>(`sessions/${session}/scenario-result.json`);
}

export async function writeScenarioResult(session: string, result: ScenarioResult): Promise<void> {
  await writeJson(`sessions/${session}/scenario-result.json`, result);
}

/** The most recently finished scenario result across all sessions, if any. */
export async function findLatestScenarioResult(): Promise<ScenarioResult | null> {
  const sessions = await listSessions();
  let latest: ScenarioResult | null = null;
  for (const s of sessions) {
    const result = await readScenarioResult(s.name);
    if (!result) continue;
    if (!latest || result.finishedAt > latest.finishedAt) latest = result;
  }
  return latest;
}

/** A scenario file joined with its most recent run result (null = never run). */
export interface ScenarioOverview {
  path: string;
  config: ScenarioConfig | null;
  result: ScenarioResult | null;
}

/**
 * List every scenario file joined with its latest run result. Used by
 * `scenario browse` to render the ticket board. A scenario whose YAML fails to
 * parse is still listed (config null) so it stays visible.
 */
export async function listScenarioOverviews(): Promise<ScenarioOverview[]> {
  const paths = await listScenarioPaths();

  // Index the latest result per scenarioPath across all sessions.
  const sessions = await listSessions();
  const latestByPath = new Map<string, ScenarioResult>();
  for (const s of sessions) {
    const result = await readScenarioResult(s.name);
    if (!result) continue;
    const current = latestByPath.get(result.scenarioPath);
    if (!current || result.finishedAt > current.finishedAt) {
      latestByPath.set(result.scenarioPath, result);
    }
  }

  const overviews: ScenarioOverview[] = [];
  for (const path of paths) {
    let config: ScenarioConfig | null = null;
    try {
      config = await loadScenario(path);
    } catch {
      config = null;
    }
    overviews.push({ path, config, result: latestByPath.get(path) ?? null });
  }
  return overviews;
}

/** Load a session's recorded edges (for the scenario browser's edge drill-in). */
export async function loadSessionEdges(session: string): Promise<Edge[]> {
  const files = await listFiles(`sessions/${session}/edges`);
  const edges: Edge[] = [];
  for (const file of files) {
    const edge = await readJson<Edge>(`sessions/${session}/edges/${file}`);
    if (edge) edges.push(edge);
  }
  return edges.sort((a, b) => a.edgeId - b.edgeId);
}
