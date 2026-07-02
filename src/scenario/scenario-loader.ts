import type { Config } from "../types.js";
import { loadFlowConfig } from "../flow/flow-loader.js";
import { loadOpenApiOperations } from "../flow/openapi-index.js";
import type { FlowConfig, OpenApiOperation } from "../flow/types.js";
import type { ScenarioConfig } from "./types.js";

export class ScenarioError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ScenarioError";
    this.details = details;
  }
}

function validateShape(scenario: ScenarioConfig): void {
  if (scenario.version !== 1) throw new ScenarioError("scenario version must be 1");
  if (!scenario.ticket || typeof scenario.ticket !== "string") {
    throw new ScenarioError("scenario must define a ticket");
  }
  if (!Array.isArray(scenario.steps)) throw new ScenarioError("scenario must define steps[]");
  for (const [i, step] of scenario.steps.entries()) {
    if (!step.action || typeof step.action !== "string") {
      throw new ScenarioError(`steps[${i}] must define an action`);
    }
    for (const key of Object.keys(step.inputs ?? {})) {
      if (!key.startsWith("observed.") && !key.startsWith("manual.")) {
        throw new ScenarioError(
          `steps[${i}] input "${key}" must be prefixed with "observed." or "manual."`,
          { step: i, key },
        );
      }
    }
  }
}

/**
 * Dry-check the scenario against its flow and OpenAPI spec without any HTTP:
 * every step's action must be reachable by walking the state machine from the
 * initial state, its observed inputs must match the action's `requires`, and all
 * baseline/goal operationIds must exist in the spec.
 */
export async function validateScenario(scenario: ScenarioConfig, config: Config): Promise<void> {
  validateShape(scenario);
  const flow = await loadFlowConfig(scenario.flow ?? "flow.yaml");
  const operations = await loadOpenApiOperations(config.openapi.specPath);
  validatePath(scenario, flow);
  validateRequests(scenario, operations);
}

function validatePath(scenario: ScenarioConfig, flow: FlowConfig): void {
  let current = flow.initialState;
  for (const [i, step] of scenario.steps.entries()) {
    const state = flow.states[current];
    const action = state?.actions?.[step.action];
    if (!action) {
      const allowed = Object.keys(state?.actions ?? {});
      throw new ScenarioError(
        `steps[${i}] action "${step.action}" is not available from state "${current}". Allowed: ${allowed.join(", ")}`,
        { step: i, action: step.action, state: current, allowed },
      );
    }
    for (const key of Object.keys(step.inputs ?? {})) {
      if (!key.startsWith("observed.")) continue;
      const name = key.slice("observed.".length);
      if (!action.requires?.[name]) {
        const allowed = Object.keys(action.requires ?? {});
        throw new ScenarioError(
          `steps[${i}] observed input "${name}" is not required by action "${step.action}". Required: ${allowed.join(", ")}`,
          { step: i, action: step.action, input: name, allowed },
        );
      }
    }
    current = action.to;
  }
}

function validateRequests(scenario: ScenarioConfig, operations: Map<string, OpenApiOperation>): void {
  const check = (where: string, operationId: string | undefined) => {
    if (!operationId) throw new ScenarioError(`${where} is missing operationId`);
    if (!operations.has(operationId)) {
      throw new ScenarioError(`${where} references unknown operationId "${operationId}"`, { operationId });
    }
  };
  scenario.baseline?.forEach((call, i) => check(`baseline[${i}]`, call.operationId));
  scenario.goal?.forEach((goal, i) => check(`goal[${i}] "${goal.name}"`, goal.operationId));
}
