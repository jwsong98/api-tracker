import { Command } from "commander";
import { loadConfig } from "../../storage/config-loader.js";
import { formatOutput } from "../../output/formatter.js";
import { validateScenario, ScenarioError } from "../../scenario/scenario-loader.js";
import { runScenario } from "../../scenario/scenario-runner.js";
import {
  findLatestScenarioResult,
  listScenarioOverviews,
  loadScenario,
  loadSessionEdges,
  readScenarioResult,
  resolveScenarioPath,
} from "../../scenario/scenario-store.js";
import { browseScenarios, renderChecklist } from "../scenario-browser.js";
import { expandScenario } from "../../scenario/scenario-expand.js";
import { loadFlowConfig } from "../../flow/flow-loader.js";
import { loadOpenApiOperations } from "../../flow/openapi-index.js";
import type { FlowConfig, OpenApiOperation } from "../../flow/types.js";
import type { ScenarioConfig, ScenarioResult } from "../../scenario/types.js";

function sanitizeSession(ticket: string): string {
  const name = ticket.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || "scenario";
}

function parseParams(values: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index === -1) throw new Error(`Invalid --param "${value}": expected name=json`);
    const key = value.slice(0, index);
    const raw = value.slice(index + 1);
    try {
      result[key] = JSON.parse(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

function collect(value: string, acc: string[]): string[] {
  acc.push(value);
  return acc;
}

export function scenarioCommand(): Command {
  const scenario = new Command("scenario")
    .description("Run a ticket scenario (executable spec) over the flow state machine")
    .addHelpText(
      "after",
      `
Typical loop:
  $ api-tracker scenario validate defect-inspect
  $ api-tracker scenario run defect-inspect --human      # RED before implementing
  # ...implement...
  $ api-tracker scenario run defect-inspect --human      # GREEN when done

A scenario walks flow.yaml actions (steps) then asserts acceptance (goal).
Server-generated ids/timestamps: use \${saved.*} for late-binding, structural
matchers ({ isUuid: true }, { after: "\${run.startedAt}" }), or a baseline +
\${baseline.x + 1} offset. See docs/scenario-loop-design.md.
`,
    );

  scenario
    .command("validate")
    .description("Validate a scenario against its flow and OpenAPI spec (no HTTP)")
    .argument("<file>", "Scenario name or path under scenarios/")
    .option("--human", "Human-readable output")
    .action(async (file: string, _opts, command: Command) => {
      const human = Boolean(command.optsWithGlobals().human);
      await emit({ human }, async () => {
        const config = await loadConfig();
        const scenarioConfig = await loadScenario(resolveScenarioPath(file));
        await validateScenario(scenarioConfig, config);
        return { ok: true, ticket: scenarioConfig.ticket };
      });
    });

  scenario
    .command("run")
    .description("Run a scenario: baseline → steps → goal. Exit code 1 when RED.")
    .argument("<file>", "Scenario name or path under scenarios/")
    .option("--session <name>", "Session name (default: derived from ticket)")
    .option("--param <name=json>", "Scenario param, read as ${params.name} (repeatable)", collect, [])
    .option("--human", "Human-readable checklist output")
    .action(async (file: string, opts: { session?: string; param: string[] }, command: Command) => {
      const human = Boolean(command.optsWithGlobals().human);
      const scenarioPath = resolveScenarioPath(file);
      try {
        const config = await loadConfig();
        const scenarioConfig: ScenarioConfig = await loadScenario(scenarioPath);
        await validateScenario(scenarioConfig, config);
        const session = opts.session ?? sanitizeSession(scenarioConfig.ticket);
        const result = await runScenario({
          config,
          scenario: scenarioConfig,
          scenarioPath,
          session,
          params: parseParams(opts.param),
        });
        console.log(human ? renderChecklist(result) : formatOutput(result));
        if (result.overall === "red") process.exitCode = 1;
      } catch (err) {
        emitError(err, human);
        process.exitCode = 1;
      }
    });

  scenario
    .command("status")
    .description("Show the latest scenario result")
    .option("--session <name>", "Session name (default: most recent run)")
    .option("--human", "Human-readable checklist output")
    .action(async (opts: { session?: string }, command: Command) => {
      const human = Boolean(command.optsWithGlobals().human);
      const result = opts.session
        ? await readScenarioResult(opts.session)
        : await findLatestScenarioResult();
      if (!result) {
        console.log(formatOutput({ ok: false, error: { message: "No scenario result found. Run 'scenario run' first." } }));
        process.exitCode = 1;
        return;
      }
      console.log(human ? renderChecklist(result) : formatOutput(result));
      if (result.overall === "red") process.exitCode = 1;
    });

  scenario
    .command("browse")
    .description("Interactive scenario board → checklist → recorded edges")
    .action(async () => {
      const overviews = await listScenarioOverviews();
      // Preload the OpenAPI ops + every referenced flow once, so the detail view
      // can statically expand each step/goal into its API calls without a run.
      const config = await loadConfig();
      let operations: Map<string, OpenApiOperation> | null = null;
      try {
        operations = await loadOpenApiOperations(config.openapi.specPath);
      } catch {
        operations = null;
      }
      const flowCache = new Map<string, FlowConfig | null>();
      const getFlow = async (flowPath: string): Promise<FlowConfig | null> => {
        if (!flowCache.has(flowPath)) {
          try {
            flowCache.set(flowPath, await loadFlowConfig(flowPath));
          } catch {
            flowCache.set(flowPath, null);
          }
        }
        return flowCache.get(flowPath) ?? null;
      };
      for (const o of overviews) {
        if (o.config) await getFlow(o.config.flow ?? "flow.yaml");
      }
      const expandFor = (scenario: ScenarioConfig) => {
        const flow = flowCache.get(scenario.flow ?? "flow.yaml");
        if (!flow || !operations) return null;
        return expandScenario(scenario, flow, operations);
      };
      await browseScenarios(overviews, loadSessionEdges, expandFor);
    });

  return scenario;
}

async function emit(opts: { human?: boolean }, build: () => Promise<unknown>): Promise<void> {
  try {
    console.log(formatOutput(await build(), { human: opts.human }));
  } catch (err) {
    emitError(err, opts.human);
    process.exitCode = 1;
  }
}

function emitError(err: unknown, human?: boolean): void {
  const error =
    err instanceof ScenarioError
      ? { message: err.message, ...err.details }
      : { message: (err as Error).message };
  console.log(formatOutput({ ok: false, error }, { human }));
}
