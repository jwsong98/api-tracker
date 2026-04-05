import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { getActiveSession } from "../../core/session-manager.js";
import { getTrackerRoot } from "../../storage/file-store.js";
import {
  collectSessionData,
  collectAllSessionsData,
  generateSessionHtml,
  generateAllSessionsHtml,
} from "../../visualization/html-generator.js";

export function visualizeCommand(): Command {
  const cmd = new Command("visualize")
    .description("Visualize API call graph in browser")
    .option("--session <name>", "Session name to visualize")
    .option("--all", "Visualize all sessions")
    .action(async (opts: { session?: string; all?: boolean }) => {
      try {
        // Check .api-tracker directory exists
        const trackerRoot = getTrackerRoot();
        if (!fs.existsSync(trackerRoot)) {
          console.log(
            JSON.stringify({ error: "No .api-tracker directory found in current directory" }),
          );
          return;
        }

        // Conflict check
        if (opts.session && opts.all) {
          console.log(
            JSON.stringify({ error: "--session and --all cannot be used together" }),
          );
          return;
        }

        let html: string;
        let sessionLabel: string;

        if (opts.all) {
          const data = await collectAllSessionsData();
          html = generateAllSessionsHtml(data);
          sessionLabel = "all";
        } else {
          const sessionName = opts.session ?? (await getActiveSession());
          if (!sessionName) {
            console.log(
              JSON.stringify({
                error: "No active session found. Use --session <name> or --all",
              }),
            );
            return;
          }

          try {
            const data = await collectSessionData(sessionName);
            html = generateSessionHtml(data);
          } catch (err: unknown) {
            console.log(JSON.stringify({ error: (err as Error).message }));
            return;
          }
          sessionLabel = sessionName;
        }

        // Write to temp file
        const filePath = path.join(os.tmpdir(), `api-tracker-visualize-${Date.now()}.html`);
        fs.writeFileSync(filePath, html, "utf-8");

        // Open in browser (fire-and-forget)
        const openCmd =
          process.platform === "darwin"
            ? `open "${filePath}"`
            : process.platform === "linux"
              ? `xdg-open "${filePath}"`
              : `start "${filePath}"`;
        exec(openCmd, () => {});

        console.log(JSON.stringify({ file: filePath, session: sessionLabel }));
      } catch (err: unknown) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      }
    });

  return cmd;
}
