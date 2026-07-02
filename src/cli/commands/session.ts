import { Command } from "commander";
import {
  createSession,
  listSessions,
  getSession,
} from "../../core/session-manager.js";
import { readJson, listFiles } from "../../storage/file-store.js";
import { browseEdges, browseInteractive } from "../session-browser.js";
import type { GraphData, Edge, SessionMeta } from "../../types.js";

const STATUS_COLOR: Record<string, string> = {
  active: "\x1b[32m",
  completed: "\x1b[34m",
  diverged: "\x1b[33m",
};

function printSessionList(sessions: SessionMeta[]): void {
  if (sessions.length === 0) {
    console.log("(no sessions)");
    return;
  }
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const nameWidth = Math.max(...sorted.map((s) => s.name.length), 4);
  console.log(
    `\n  ${"NAME".padEnd(nameWidth)}  STATUS     EDGES  CREATED`,
  );
  console.log(`  ${"─".repeat(nameWidth + 32)}`);
  for (const s of sorted) {
    const color = STATUS_COLOR[s.status] ?? "";
    const status = `${color}${s.status.padEnd(9)}\x1b[0m`;
    const created = new Date(s.createdAt).toLocaleString();
    console.log(
      `  \x1b[1m${s.name.padEnd(nameWidth)}\x1b[0m  ${status}  ${String(s.edgeCount).padStart(5)}  ${created}`,
    );
  }
  console.log();
}

async function loadEdges(name: string): Promise<Edge[]> {
  const edgeFiles = await listFiles(`sessions/${name}/edges`);
  const edges: Edge[] = [];
  for (const f of edgeFiles) {
    const edge = await readJson<Edge>(`sessions/${name}/edges/${f}`);
    if (edge) edges.push(edge);
  }
  return edges.sort((a, b) => a.edgeId - b.edgeId);
}

export function sessionCommand(): Command {
  const session = new Command("session").description("Manage tracking sessions");

  session
    .command("start")
    .requiredOption("--name <name>", "Session name")
    .option("--continue-from <session>", "Continue from existing session")
    .action(async (opts: { name: string; continueFrom?: string }) => {
      const meta = await createSession({
        name: opts.name,
        continueFrom: opts.continueFrom,
      });
      console.log(
        JSON.stringify({
          session: meta.name,
          status: meta.status,
          continueFrom: meta.continueFrom,
        }),
      );
    });

  session
    .command("list")
    .option("--json", "Raw JSON output")
    .action(async (opts: { json?: boolean }) => {
      const sessions = await listSessions();
      if (opts.json) {
        console.log(JSON.stringify({ sessions }));
      } else {
        printSessionList(sessions);
      }
    });

  session
    .command("show")
    .requiredOption("--name <name>", "Session name")
    .option("--json", "Raw JSON output")
    .action(async (opts: { name: string; json?: boolean }) => {
      if (opts.json) {
        const meta = await getSession(opts.name);
        const graph = await readJson<GraphData>(`sessions/${opts.name}/graph.json`);
        console.log(JSON.stringify({ meta, graph }));
      } else {
        const edges = await loadEdges(opts.name);
        await browseEdges(edges, opts.name);
      }
    });

  session
    .command("browse")
    .description("Interactive session picker → step-by-step edge explorer")
    .action(async () => {
      const sessions = await listSessions();
      await browseInteractive(sessions, loadEdges);
    });

  return session;
}
