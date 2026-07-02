import { callWithAuth } from "../core/http-caller.js";
import { recordEdge } from "../core/recorder.js";
import { resetSession } from "../core/session-manager.js";
import { loadFlowConfig } from "../flow/flow-loader.js";
import { loadOpenApiOperations } from "../flow/openapi-index.js";
import {
  createFlowSessionState,
  getFlowSessionState,
} from "../flow/flow-session-store.js";
import { renderCall, runFlowAction, runScreenLoad } from "../flow/flow-runtime.js";
import { selectJsonPath, selectOne } from "../flow/json-path.js";
import { FlowError } from "../flow/flow-errors.js";
import type { Config } from "../types.js";
import type {
  FlowActionConfig,
  FlowConfig,
  FlowSessionState,
  OpenApiOperation,
} from "../flow/types.js";
import { resolveDeep } from "./scenario-template.js";
import { evaluateAssertion, normalizeSpec } from "./matchers.js";
import { readScenarioResult, writeScenarioResult } from "./scenario-store.js";
import type {
  ObservedSelector,
  ScenarioAssert,
  ScenarioCallResult,
  ScenarioConfig,
  ScenarioFailure,
  ScenarioGoalResult,
  ScenarioRequest,
  ScenarioResult,
  ScenarioStep,
  ScenarioStepResult,
  StepStatus,
} from "./types.js";

function toFailure(err: unknown): ScenarioFailure {
  if (err instanceof FlowError) {
    return { kind: err.code, message: err.message, ...err.details };
  }
  return { kind: "error", message: (err as Error).message };
}

/**
 * Execute a standalone OpenAPI call (baseline or goal) and assert its response.
 * Returns a structured failure instead of throwing on assertion mismatch, so the
 * runner can record a per-item verdict. Templates in params/body/assert are
 * resolved against `ctx`; matched `save` values land in `savePool`.
 */
async function executeStandaloneCall(opts: {
  config: Config;
  flow: FlowConfig;
  session: string;
  operations: Map<string, OpenApiOperation>;
  request: ScenarioRequest | { operationId: string; auth?: string; params?: Record<string, unknown>; body?: unknown; save?: Record<string, string> };
  assert?: ScenarioAssert;
  expectStatus?: number;
  ctx: Record<string, unknown>;
  savePool: Record<string, unknown>;
}): Promise<{ httpStatus: number; saved: string[]; failure?: ScenarioFailure }> {
  const { config, flow, session, operations, request, assert, expectStatus, ctx, savePool } = opts;

  const operation = operations.get(request.operationId);
  if (!operation) throw new Error(`Unknown operationId "${request.operationId}"`);

  const resolvedParams = resolveDeep(request.params ?? {}, ctx) as Record<string, unknown>;
  const resolvedBody = request.body == null ? undefined : resolveDeep(request.body, ctx);
  const rendered = renderCall(operation, { params: resolvedParams, body: resolvedBody, headers: {} }, {});
  const authProfile = request.auth ?? flow.defaultAuth;

  const response = await callWithAuth({
    method: operation.method,
    url: `${config.server.baseUrl}${rendered.path}`,
    headers: rendered.headers,
    body: rendered.body,
    authProfile,
  });

  await recordEdge({
    session,
    method: operation.method,
    path: rendered.path,
    body: rendered.body,
    authProfile,
    templatePath: operation.path,
    templateBody: request.body,
    refs: [],
    response,
    warnings: [],
  });

  const expected = assert?.status ?? expectStatus;
  if (expected != null && response.status !== expected) {
    return {
      httpStatus: response.status,
      saved: [],
      failure: {
        kind: "status",
        message: `expected status ${expected}, got ${response.status}`,
        expected,
        actual: response.status,
      },
    };
  }

  const root = { body: response.body };
  for (const [path, spec] of Object.entries(assert?.body ?? {})) {
    try {
      const normalized = normalizeSpec(resolveDeep(spec, ctx));
      const matches = selectJsonPath(root, path);
      const mf = evaluateAssertion(matches, normalized, path);
      if (mf) {
        return {
          httpStatus: response.status,
          saved: [],
          failure: {
            kind: "assert.body",
            message: `${path}: expected ${mf.matcher} ${JSON.stringify(mf.expected)}, got ${JSON.stringify(mf.actual)}`,
            ...mf,
          },
        };
      }
    } catch (err) {
      return {
        httpStatus: response.status,
        saved: [],
        failure: { kind: "assert.body", message: (err as Error).message, path },
      };
    }
  }

  const saved: string[] = [];
  for (const [key, p] of Object.entries(request.save ?? {})) {
    const value = selectOne(root, p);
    if (value !== undefined) {
      savePool[key] = value;
      saved.push(key);
    }
  }
  return { httpStatus: response.status, saved };
}

/** Split a step's inputs into flow observed selections and manual values. */
function resolveStepInputs(
  step: ScenarioStep,
  action: FlowActionConfig,
  flowState: FlowSessionState,
  ctx: Record<string, unknown>,
): { inputs: Record<string, string>; values: Record<string, unknown> } {
  const inputs: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(step.inputs ?? {})) {
    if (key.startsWith("manual.")) {
      values[key.slice("manual.".length)] = resolveDeep(raw, ctx);
    } else {
      const name = key.slice("observed.".length);
      inputs[name] = resolveObservedSelection(raw, name, action, flowState, ctx);
    }
  }
  return { inputs, values };
}

/**
 * Resolve an `observed.<name>` input to a concrete candidate id. A string (or
 * `${...}` template) is the id itself; a `{ index }` / `{ label }` object picks
 * from the candidates the flow has observed so far for this input's bucket.
 */
function resolveObservedSelection(
  raw: unknown,
  name: string,
  action: FlowActionConfig,
  flowState: FlowSessionState,
  ctx: Record<string, unknown>,
): string {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const sel = raw as ObservedSelector;
    const bucket = action.requires?.[name]?.observedAs;
    const candidates = (bucket && flowState.observed[bucket]) || [];
    if (typeof sel.index === "number") {
      const candidate = candidates[sel.index];
      if (!candidate) {
        throw new Error(`observed.${name}: no candidate at index ${sel.index} (have ${candidates.length})`);
      }
      return candidate.id;
    }
    if (sel.label != null) {
      const wanted = String(resolveDeep(sel.label, ctx));
      const candidate = candidates.find((c) => c.label === wanted);
      if (!candidate) throw new Error(`observed.${name}: no candidate with label "${wanted}"`);
      return candidate.id;
    }
    throw new Error(`observed.${name}: selector must specify index or label`);
  }
  return String(resolveDeep(raw, ctx));
}

/**
 * Run a scenario end to end: baseline setup → scripted step walk over the flow
 * state machine → goal assertions. Each `scenario run` resets its session for a
 * clean attempt; the attempt counter carries across runs via the prior result.
 * Returns the persisted result; overall is "green" only if setup, every step,
 * and every goal passed.
 */
export async function runScenario(opts: {
  config: Config;
  scenario: ScenarioConfig;
  scenarioPath: string;
  session: string;
  params?: Record<string, unknown>;
}): Promise<ScenarioResult> {
  const { config, scenario, scenarioPath, session } = opts;
  const flow = await loadFlowConfig(scenario.flow ?? "flow.yaml");
  const operations = await loadOpenApiOperations(config.openapi.specPath);
  const startedAt = new Date().toISOString();

  const prev = await readScenarioResult(session);
  const attempt = (prev?.attempt ?? 0) + 1;

  await resetSession(session);
  await createFlowSessionState(session, flow);
  // Populate the initial screen's observed pool so the first step can select.
  await runScreenLoad({ config, flow, session });

  const ctx: Record<string, unknown> = {
    params: { ...(scenario.params ?? {}), ...(opts.params ?? {}) },
    baseline: {},
    saved: {},
    run: { startedAt, now: startedAt },
    env: process.env,
  };
  const baselinePool = ctx.baseline as Record<string, unknown>;

  // ── Baseline: capture before-state so goals can assert relative change. ──
  const baseline: ScenarioCallResult[] = [];
  let setupFailed = false;
  for (const call of scenario.baseline ?? []) {
    try {
      const r = await executeStandaloneCall({
        config, flow, session, operations,
        request: call, expectStatus: call.expect?.status,
        ctx, savePool: baselinePool,
      });
      baseline.push({
        operationId: call.operationId,
        status: r.failure ? "failed" : "passed",
        httpStatus: r.httpStatus,
        saved: r.saved,
        error: r.failure,
      });
      if (r.failure) { setupFailed = true; break; }
    } catch (err) {
      baseline.push({ operationId: call.operationId, status: "failed", saved: [], error: toFailure(err) });
      setupFailed = true;
      break;
    }
  }

  // ── Steps: walk the guarded path; a failed step blocks the rest. ──
  const steps: ScenarioStepResult[] = scenario.steps.map((s, id) => ({
    id, action: s.action, status: "pending" as StepStatus,
  }));
  let blocked = setupFailed;
  for (let i = 0; i < scenario.steps.length && !blocked; i++) {
    const step = scenario.steps[i];
    const flowState = await getFlowSessionState(session);
    const from = flowState.currentState;
    const action = flow.states[from]?.actions?.[step.action];
    try {
      if (!action) throw new Error(`action "${step.action}" is not available from state "${from}"`);
      const { inputs, values } = resolveStepInputs(step, action, flowState, ctx);
      const result = await runFlowAction({ config, flow, session, actionId: step.action, inputs, values });
      steps[i] = { id: i, action: step.action, status: "passed", from: result.from, to: result.to };
    } catch (err) {
      steps[i] = { id: i, action: step.action, status: "failed", from, error: toFailure(err) };
      blocked = true;
    }
  }

  // ── Goals: acceptance assertions; each reported independently. ──
  const goals: ScenarioGoalResult[] = (scenario.goal ?? []).map((g, id) => ({
    id, name: g.name, operationId: g.operationId, status: "pending" as StepStatus,
  }));
  if (!blocked) {
    const flowState = await getFlowSessionState(session);
    ctx.saved = { ...flowState.saved };
    const savePool = ctx.saved as Record<string, unknown>;
    for (let i = 0; i < goals.length; i++) {
      const goal = scenario.goal![i];
      try {
        const r = await executeStandaloneCall({
          config, flow, session, operations,
          request: goal, assert: goal.assert,
          ctx, savePool,
        });
        goals[i] = {
          id: i, name: goal.name, operationId: goal.operationId,
          status: r.failure ? "failed" : "passed",
          httpStatus: r.httpStatus, error: r.failure,
        };
      } catch (err) {
        goals[i] = {
          id: i, name: goal.name, operationId: goal.operationId,
          status: "failed", error: toFailure(err),
        };
      }
    }
  }

  const allStepsPassed = steps.every((s) => s.status === "passed");
  const allGoalsPassed = goals.every((g) => g.status === "passed");
  const overall: "green" | "red" =
    !setupFailed && allStepsPassed && allGoalsPassed ? "green" : "red";

  const result: ScenarioResult = {
    ticket: scenario.ticket,
    title: scenario.title,
    scenarioPath,
    session,
    attempt,
    startedAt,
    finishedAt: new Date().toISOString(),
    overall,
    baseline,
    steps,
    goal: goals,
  };
  await writeScenarioResult(session, result);
  return result;
}
