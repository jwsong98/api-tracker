import { Command } from "commander";
import { initProject } from "../../core/initializer.js";
import { formatOutput } from "../../output/formatter.js";

export function initCommand(): Command {
  return new Command("init")
    .description("Create example .api-tracker config, OpenAPI, and flow files")
    .option("--force", "Overwrite existing example files")
    .option("--human", "Human-readable output")
    .addHelpText(
      "after",
      `

Creates:
  .api-tracker/config.yaml
  .api-tracker/openapi.yaml
  .api-tracker/flow.yaml

The generated flow starts at login, demonstrates observed IDs with project list/detail,
and demonstrates manual POST/PATCH inputs with --value.

Next:
  $ api-tracker flow validate
  $ api-tracker flow start --session qa-flow
  $ api-tracker flow actions --session qa-flow
`,
    )
    .action(async (opts) => {
      const result = await initProject({ force: opts.force });
      console.log(formatOutput(result, { human: opts.human }));
    });
}
