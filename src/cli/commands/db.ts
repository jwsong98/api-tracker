import { Command } from "commander";
import { loadConfig } from "../../storage/config-loader.js";
import { resetDatabase } from "../../core/db-resetter.js";

export function dbCommand(): Command {
  const cmd = new Command("db").description("Database operations");

  cmd
    .command("reset")
    .description("Reset database to seed state")
    .action(async () => {
      try {
        const config = await loadConfig();
        const result = await resetDatabase(config);
        console.log(JSON.stringify(result, null, 2));
      } catch (err: unknown) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      }
    });

  return cmd;
}
