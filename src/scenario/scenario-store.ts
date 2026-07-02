import { readJson, writeJson, listFiles, readYaml } from "../storage/file-store.js";
import { listSessions } from "../core/session-manager.js";
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
