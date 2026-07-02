/**
 * Scenario = a scripted walk over the flow.yaml state machine (steps) plus
 * acceptance assertions (goal). Written before implementation as an executable
 * spec: `scenario run` fails (RED) until the ticket is implemented, then passes
 * (GREEN). See docs/scenario-loop-design.md.
 */

/** A standalone OpenAPI call used by baseline (setup) and goal (assertion). */
export interface ScenarioRequest {
  operationId: string;
  auth?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  /** Persist response values into the scenario context: key -> "$.body.path". */
  save?: Record<string, string>;
  /** Baseline/simple status expectation (goal uses `assert` instead). */
  expect?: { status?: number };
}

/**
 * A step navigates the flow by running one flow action. Inputs are keyed by
 * `observed.<name>` (selects an observed candidate — literal id, `${...}`
 * template, or a `{ index }` / `{ label }` selector) or `manual.<name>` (a
 * manual request value, any JSON, `${...}` templated). Assertions live in
 * `goal`, not on steps — a step passes iff its flow action succeeds (guards +
 * the action's own expects from flow.yaml).
 */
export interface ScenarioStep {
  action: string;
  inputs?: Record<string, unknown>;
}

/** An observed-candidate selector for a step's `observed.<name>` input. */
export interface ObservedSelector {
  index?: number;
  label?: string;
}

/** A single acceptance assertion: run a call, assert its response. */
export interface ScenarioGoal {
  name: string;
  operationId: string;
  auth?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  save?: Record<string, string>;
  assert?: ScenarioAssert;
}

export interface ScenarioAssert {
  status?: number;
  /** JSONPath ("$.body...") -> matcher spec (literal = equals, or matcher object). */
  body?: Record<string, unknown>;
}

export interface ScenarioConfig {
  version: 1;
  ticket: string;
  title?: string;
  description?: string;
  /** Base flow.yaml path (tracker-root relative). Default "flow.yaml". */
  flow?: string;
  /** Default params, overridable via `--param name=json`. Read as `${params.*}`. */
  params?: Record<string, unknown>;
  baseline?: ScenarioRequest[];
  steps: ScenarioStep[];
  goal?: ScenarioGoal[];
}

// ── Result (sessions/<name>/scenario-result.json) ──

export type StepStatus = "passed" | "failed" | "pending";

export interface ScenarioFailure {
  kind: string;
  message: string;
  [key: string]: unknown;
}

export interface ScenarioCallResult {
  name?: string;
  operationId: string;
  status: "passed" | "failed";
  httpStatus?: number;
  saved: string[];
  error?: ScenarioFailure;
}

export interface ScenarioStepResult {
  id: number;
  action: string;
  status: StepStatus;
  from?: string;
  to?: string;
  error?: ScenarioFailure;
}

export interface ScenarioGoalResult {
  id: number;
  name: string;
  operationId: string;
  status: StepStatus;
  httpStatus?: number;
  error?: ScenarioFailure;
}

export interface ScenarioResult {
  ticket: string;
  title?: string;
  scenarioPath: string;
  session: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  overall: "green" | "red";
  baseline: ScenarioCallResult[];
  steps: ScenarioStepResult[];
  goal: ScenarioGoalResult[];
}
