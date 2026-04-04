import { Command } from "commander";
import { loadConfig } from "../../storage/config-loader.js";
import { getActiveSession } from "../../core/session-manager.js";
import { replayToNode } from "../../core/replayer.js";
import { formatDiff } from "../../output/diff.js";

export function replayCommand(): Command {
  const cmd = new Command("replay")
    .description("Replay edges to restore state at a target node")
    .requiredOption("--to <nodeId>", "Target node ID", parseInt)
    .option("--session <name>", "Session name")
    .action(async (opts) => {
      try {
        const config = await loadConfig();

        const sessionName = opts.session ?? (await getActiveSession());
        if (!sessionName) {
          console.log(JSON.stringify({ error: "No active session. Run 'session start' first." }));
          return;
        }

        const result = await replayToNode({
          session: sessionName,
          targetNode: opts.to,
          config,
        });

        if (result.status === "success") {
          console.log(
            JSON.stringify(
              {
                status: "success",
                ready: true,
                targetNode: result.targetNode,
                dbReset: result.dbReset,
                replayed: result.replayed,
                bindingUpdates: result.bindingUpdates,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(
            JSON.stringify(
              {
                status: "diverged",
                ready: false,
                targetNode: result.targetNode,
                dbReset: result.dbReset,
                divergedAt: result.divergedAt,
                diff: result.diff,
                replayed: result.replayed,
                bindingUpdates: result.bindingUpdates,
              },
              null,
              2,
            ),
          );
        }
      } catch (err: unknown) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      }
    });

  return cmd;
}
