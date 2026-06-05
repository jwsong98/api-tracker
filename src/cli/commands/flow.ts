import { Command } from "commander";
import { createSession, getActiveSession, getSession } from "../../core/session-manager.js";
import { formatOutput } from "../../output/formatter.js";
import { loadConfig } from "../../storage/config-loader.js";
import { createFlowSessionState, getFlowSessionState } from "../../flow/flow-session-store.js";
import { loadFlowConfig, validateFlowConfig } from "../../flow/flow-loader.js";
import {
  buildActionView,
  describeAvailableActions,
  runFlowAction,
  runScreenLoad,
  stateRef,
} from "../../flow/flow-runtime.js";
import { loadOpenApiOperations } from "../../flow/openapi-index.js";
import { FlowError } from "../../flow/flow-errors.js";
import { generateMermaid } from "../../flow/flow-visualize.js";
import { runInteractive } from "../../flow/flow-interactive.js";

export function flowCommand(): Command {
  const flow = new Command("flow")
    .description("Run guarded route-based API flow actions")
    .addHelpText(
      "after",
      `

Typical flow:
  $ api-tracker flow validate
  $ api-tracker flow start --session qa-flow
  $ api-tracker flow start --session login-flow --state login
  $ api-tracker flow actions --session qa-flow
  $ api-tracker flow run load_projects --session qa-flow
  $ api-tracker flow inputs open_project_detail --session qa-flow
  $ api-tracker flow run open_project_detail --session qa-flow --input project:p1

Concepts:
  --input selects a value observed from an earlier API response.
  --value passes a manual value for create/update request bodies.
`,
    );

  flow
    .command("validate")
    .description("Validate flow.yaml and OpenAPI operationId references")
    .option("--human", "Human-readable output")
    .action(async (opts) => {
      const config = await loadConfig();
      const flowConfig = await loadFlowConfig();
      await validateFlowConfig(flowConfig, config);
      console.log(formatOutput({ ok: true }, { human: opts.human }));
    });

  flow
    .command("visualize")
    .description("Output a Mermaid stateDiagram from flow.yaml")
    .option("--session <name>", "Highlight current state in the diagram")
    .action(async (opts) => {
      const flowConfig = await loadFlowConfig();
      let currentState: string | undefined;
      if (opts.session) {
        const state = await getFlowSessionState(opts.session);
        currentState = state.currentState;
      }
      console.log(generateMermaid(flowConfig, currentState));
    });

  flow
    .command("explore")
    .description("Interactively navigate the flow state machine in the terminal")
    .action(async () => {
      const flowConfig = await loadFlowConfig();
      runInteractive(flowConfig);
    });

  flow
    .command("start")
    .description("Create a tracking session and initialize flow-state.json")
    .requiredOption("--session <name>", "Session name")
    .option("--state <state>", "Override flow.yaml initialState for this session")
    .option("--continue-from <session>", "Continue from existing session")
    .option("--human", "Human-readable output")
    .action(async (opts) => {
      const config = await loadConfig();
      const flowConfig = await loadFlowConfig();
      const meta = await createSession({
        name: opts.session,
        continueFrom: opts.continueFrom,
      });
      await createFlowSessionState(meta.name, flowConfig, opts.state);
      // Auto-load the initial screen's data (no-op if it declares no `load`).
      const { loaded, state } = await runScreenLoad({
        config,
        flow: flowConfig,
        session: meta.name,
      });
      console.log(formatOutput({ session: meta.name, flow: state, loaded }, { human: opts.human }));
    });

  flow
    .command("state")
    .description("Show the current flow state, observed values, saved values, and history")
    .option("--session <name>", "Session name")
    .option("--human", "Human-readable output")
    .action(async (opts) => {
      const session = opts.session ?? (await requireActiveSession());
      await getSession(session);
      const state = await getFlowSessionState(session);
      console.log(formatOutput({ session, flow: state }, { human: opts.human }));
    });

  flow
    .command("actions")
    .description("List actions allowed from the current state")
    .option("--session <name>", "Session name")
    .option("--human", "Human-readable output")
    .action(async (opts) => {
      await emitAgentJson(opts, async () => {
        const session = opts.session ?? (await requireActiveSession());
        const config = await loadConfig();
        const flowConfig = await loadFlowConfig();
        const state = await getFlowSessionState(session);
        const operations = await loadOpenApiOperations(config.openapi.specPath);
        return {
          ok: true,
          state: stateRef(flowConfig, state.currentState),
          actions: describeAvailableActions(flowConfig, state, operations),
        };
      });
    });

  flow
    .command("inputs")
    .description("Show observed input candidates and manual values required by an action")
    .argument("<action>", "Action id")
    .option("--session <name>", "Session name")
    .option("--human", "Human-readable output")
    .action(async (action: string, opts) => {
      await emitAgentJson(opts, async () => {
        const session = opts.session ?? (await requireActiveSession());
        const config = await loadConfig();
        const flowConfig = await loadFlowConfig();
        const state = await getFlowSessionState(session);
        const operations = await loadOpenApiOperations(config.openapi.specPath);
        return {
          ok: true,
          state: stateRef(flowConfig, state.currentState),
          action: buildActionView(flowConfig, state, action, operations),
        };
      });
    });

  flow
    .command("run")
    .description("Run one allowed action after validating observed and manual inputs")
    .argument("<action>", "Action id")
    .option("--session <name>", "Session name")
    .option("--input <name:id>", "Required observed input (repeatable)", collect, [])
    .option("--value <name=json>", "Manual value for request templates (repeatable)", collect, [])
    .option("--human", "Human-readable output")
    .addHelpText(
      "after",
      `

Examples:
  # Select an observed project from a previous list action.
  $ api-tracker flow run open_project_detail --session qa-flow --input project:p1

  # Pass manual values for a POST/PUT body. JSON is accepted.
  $ api-tracker flow run create_project --session qa-flow --value name='"Demo"' --value visibility='"private"'
  $ api-tracker flow run update_project --session qa-flow --input project:p1 --value patch='{"name":"Renamed"}'

YAML body templates can reference manual values with \${manual.name} or \${manual.patch}.
`,
    )
    .action(async (action: string, opts) => {
      await emitAgentJson(opts, async () => {
        const session = opts.session ?? (await requireActiveSession());
        const config = await loadConfig();
        const flowConfig = await loadFlowConfig();
        const result = await runFlowAction({
          config,
          flow: flowConfig,
          session,
          actionId: action,
          inputs: parseInputs(opts.input),
          values: parseValues(opts.value),
        });
        return {
          ok: true,
          state: stateRef(flowConfig, result.to),
          action: result.action,
          from: result.from,
          to: result.to,
          calls: result.calls,
          loaded: result.loaded,
          changed: {
            observed: [
              ...new Set([...result.calls, ...result.loaded].flatMap((c) => c.observed)),
            ],
            saved: [
              ...new Set([...result.calls, ...result.loaded].flatMap((c) => c.saved)),
            ],
          },
        };
      });
    });

  return flow;
}

/**
 * Run an agent-facing command, emitting its payload as JSON. FlowError guard
 * failures are surfaced as `{ ok: false, error: { code, message, ...details } }`
 * with a non-zero exit code, so an agent can react without parsing stderr text.
 */
async function emitAgentJson(
  opts: { human?: boolean },
  build: () => Promise<unknown>,
): Promise<void> {
  try {
    console.log(formatOutput(await build(), { human: opts.human }));
  } catch (err) {
    if (err instanceof FlowError) {
      console.log(
        formatOutput(
          { ok: false, error: { code: err.code, message: err.message, ...err.details } },
          { human: opts.human },
        ),
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

async function requireActiveSession(): Promise<string> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error("No active session. Run 'flow start --session <name>' first.");
  }
  return session;
}

function collect(value: string, acc: string[]): string[] {
  acc.push(value);
  return acc;
}

function parseInputs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf(":");
    if (index === -1) {
      throw new Error(`Invalid --input "${value}": expected name:id`);
    }
    result[value.slice(0, index)] = value.slice(index + 1);
  }
  return result;
}

function parseValues(values: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index === -1) {
      throw new Error(`Invalid --value "${value}": expected name=json`);
    }
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
