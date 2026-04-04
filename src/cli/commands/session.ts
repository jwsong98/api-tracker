import { Command } from "commander";
import {
  createSession,
  listSessions,
  getSession,
} from "../../core/session-manager.js";
import { readJson } from "../../storage/file-store.js";
import type { GraphData } from "../../types.js";

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
    .action(async () => {
      const sessions = await listSessions();
      console.log(JSON.stringify({ sessions }));
    });

  session
    .command("show")
    .requiredOption("--name <name>", "Session name")
    .action(async (opts: { name: string }) => {
      const meta = await getSession(opts.name);
      const graph = await readJson<GraphData>(`sessions/${opts.name}/graph.json`);
      console.log(JSON.stringify({ meta, graph }));
    });

  return session;
}
