import type { SessionMeta, GraphData, Bindings } from "../types.js";
import { readJson, writeJson, listDirs, exists } from "../storage/file-store.js";

const SESSION_NAME_RE = /^[a-zA-Z0-9-]+$/;

function validateName(name: string): void {
  if (!SESSION_NAME_RE.test(name)) {
    throw new Error(
      `Invalid session name "${name}": only alphanumeric characters and hyphens are allowed`,
    );
  }
}

export async function createSession(options: {
  name: string;
  continueFrom?: string;
}): Promise<SessionMeta> {
  const { name, continueFrom } = options;
  validateName(name);

  if (await exists(`sessions/${name}/meta.json`)) {
    throw new Error(`Session "${name}" already exists`);
  }

  let seedLabel = "seed";
  let bindings: Bindings = {};

  if (continueFrom) {
    const sourceMeta = await readJson<SessionMeta>(`sessions/${continueFrom}/meta.json`);
    if (!sourceMeta) {
      throw new Error(`Source session "${continueFrom}" not found`);
    }
    seedLabel = `continue:${continueFrom}`;

    const sourceBindings = await readJson<Bindings>(`sessions/${continueFrom}/bindings.json`);
    if (sourceBindings) {
      bindings = sourceBindings;
    }
  }

  const meta: SessionMeta = {
    name,
    status: "active",
    createdAt: new Date().toISOString(),
    continueFrom: continueFrom ?? null,
    lastNodeId: 0,
    edgeCount: 0,
  };

  const graph: GraphData = {
    nodes: [{ id: 0, label: seedLabel }],
    edges: [],
  };

  await writeJson(`sessions/${name}/meta.json`, meta);
  await writeJson(`sessions/${name}/graph.json`, graph);
  await writeJson(`sessions/${name}/bindings.json`, bindings);

  return meta;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const dirs = await listDirs("sessions");
  const results: SessionMeta[] = [];
  for (const dir of dirs) {
    const meta = await readJson<SessionMeta>(`sessions/${dir}/meta.json`);
    if (meta) {
      results.push(meta);
    }
  }
  return results;
}

export async function getSession(name: string): Promise<SessionMeta> {
  const meta = await readJson<SessionMeta>(`sessions/${name}/meta.json`);
  if (!meta) {
    throw new Error(`Session "${name}" not found`);
  }
  return meta;
}

export async function updateSessionMeta(
  name: string,
  updates: Partial<SessionMeta>,
): Promise<void> {
  const meta = await getSession(name);
  const updated = { ...meta, ...updates };
  await writeJson(`sessions/${name}/meta.json`, updated);
}

export async function getActiveSession(): Promise<string | null> {
  const sessions = await listSessions();
  const active = sessions
    .filter((s) => s.status === "active")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return active.length > 0 ? active[0].name : null;
}
