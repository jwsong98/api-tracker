import { callWithAuth } from "../core/http-caller.js";
import { recordEdge } from "../core/recorder.js";
import type { Config, Ref } from "../types.js";
import { selectJsonPath, selectOne } from "./json-path.js";
import { loadOpenApiOperations } from "./openapi-index.js";
import {
  getFlowSessionState,
  writeFlowSessionState,
} from "./flow-session-store.js";
import { runWsAction } from "./ws-action-runner.js";
import { FlowError } from "./flow-errors.js";
import type {
  ActionView,
  FlowActionConfig,
  FlowCallConfig,
  FlowCallResult,
  FlowConfig,
  FlowSessionState,
  FlowStateRef,
  ManualFieldInfo,
  ObservedValue,
  OpenApiFieldSchema,
  OpenApiOperation,
  RequiredObservedInput,
} from "./types.js";

/** Build the common envelope header for a state. */
export function stateRef(flow: FlowConfig, stateId: string): FlowStateRef {
  const state = flow.states[stateId];
  if (!state) {
    throw new FlowError("UNKNOWN_STATE", `Flow state "${stateId}" is not defined`, { state: stateId });
  }
  return { id: stateId, route: state.route, variant: state.variant };
}

/**
 * Describe a single action fully: its target state and every input the agent
 * must supply (observed candidates + typed manual fields). This is the unit the
 * agent contract is built from — `actions` returns a list of these, `inputs`
 * returns one.
 */
export function buildActionView(
  flow: FlowConfig,
  state: FlowSessionState,
  actionId: string,
  operations: Map<string, OpenApiOperation>,
): ActionView {
  const action = getAction(flow, state.currentState, actionId);
  const observed: RequiredObservedInput[] = Object.entries(action.requires ?? {}).map(
    ([input, requirement]) => ({
      input,
      observedAs: requirement.observedAs,
      candidates: state.observed[requirement.observedAs] ?? [],
    }),
  );
  return {
    id: actionId,
    to: action.to,
    protocol: action.protocol,
    inputs: {
      observed,
      manual: describeManualFields(flow, state.currentState, actionId, operations),
    },
  };
}

/** All actions available from the current state, each fully described. */
export function describeAvailableActions(
  flow: FlowConfig,
  state: FlowSessionState,
  operations: Map<string, OpenApiOperation>,
): ActionView[] {
  const current = flow.states[state.currentState];
  if (!current) {
    throw new FlowError("UNKNOWN_STATE", `Current flow state "${state.currentState}" is not defined`, {
      state: state.currentState,
    });
  }
  return Object.keys(current.actions ?? {}).map((id) => buildActionView(flow, state, id, operations));
}

/**
 * Enrich an action's `manual` keys with type info from the OpenAPI schema.
 *
 * A manual key is matched by name against the body/param fields of the action's
 * calls (first match wins). Keys that don't directly map to a top-level schema
 * field — e.g. a `patch` key bound to an entire request body — degrade to an
 * untyped `{ name, required: true }` entry.
 */
export function describeManualFields(
  flow: FlowConfig,
  stateId: string,
  actionId: string,
  operations: Map<string, OpenApiOperation>,
): ManualFieldInfo[] {
  const action = getAction(flow, stateId, actionId);
  const manualKeys = action.manual ?? [];

  const fieldsByName = new Map<string, OpenApiFieldSchema & { operationId: string }>();
  for (const call of action.calls ?? []) {
    if (!call.operationId) continue;
    const operation = operations.get(call.operationId);
    if (!operation) continue;
    for (const field of [...(operation.bodyFields ?? []), ...(operation.paramFields ?? [])]) {
      if (!fieldsByName.has(field.name)) {
        fieldsByName.set(field.name, { ...field, operationId: call.operationId });
      }
    }
  }

  return manualKeys.map((name) => {
    const field = fieldsByName.get(name);
    if (!field) return { name, required: true };
    return {
      name,
      type: field.type,
      required: field.required,
      enum: field.enum,
      format: field.format,
      description: field.description,
      itemsType: field.itemsType,
      fromOperation: field.operationId,
    };
  });
}

export function suggestProducerActions(flow: FlowConfig, stateId: string, observedAs: string): string[] {
  const state = flow.states[stateId];
  if (!state) return [];
  return Object.entries(state.actions ?? {})
    .filter(([, action]) =>
      (action.calls ?? []).some((call) => Object.keys(call.observe ?? {}).includes(observedAs)),
    )
    .map(([actionId]) => actionId);
}

export async function runFlowAction(options: {
  config: Config;
  flow: FlowConfig;
  session: string;
  actionId: string;
  inputs?: Record<string, string>;
  values?: Record<string, unknown>;
}): Promise<{
  action: string;
  from: string;
  to: string;
  calls: FlowCallResult[];
  loaded: FlowCallResult[];
  state: FlowSessionState;
}> {
  const { config, flow, session, actionId } = options;
  const state = await getFlowSessionState(session);
  const from = state.currentState;
  const action = getAction(flow, from, actionId);
  const inputContext = resolveRequiredInputs(flow, state, actionId, action, options.inputs ?? {});
  const manualContext = resolveManualValues(action, options.values ?? {});
  const operations = await loadOpenApiOperations(config.openapi.specPath);

  const calls: FlowCallResult[] = [];
  const workingState: FlowSessionState = cloneState(state);
  const context: Record<string, unknown> = {
    ...workingState.saved,
    ...inputContext,
    manual: manualContext,
    env: process.env,
  };

  if (action.protocol === "ws") {
    const wsResults = await runWsAction({
      config,
      flow,
      session,
      actionId,
      action,
      context,
      workingState,
    });
    for (const r of wsResults) {
      calls.push({
        destination: r.destination,
        method: "WS",
        path: r.destination,
        status: r.received.matched ? 200 : 408,
        saved: r.saved,
        observed: r.observed,
        clientGeneratedId: r.clientGeneratedId,
        received: r.received,
      });
    }
  } else {
    try {
      const httpResults = await executeHttpCalls({
        config,
        flow,
        session,
        operations,
        sourceLabel: actionId,
        calls: action.calls ?? [],
        context,
        workingState,
      });
      calls.push(...httpResults);
    } catch (err) {
      // A guard failure mid-transition is recorded so history reflects the
      // attempt; the transition itself is not committed.
      if (err instanceof FlowError && err.code === "UNEXPECTED_STATUS") {
        await appendHistory(session, workingState, {
          action: actionId,
          from,
          to: action.to,
          ok: false,
          timestamp: new Date().toISOString(),
        });
      }
      throw err;
    }
  }

  // Transition completes, then the destination screen auto-loads its data into
  // the shared observed/saved pool (see FlowStateConfig.load).
  workingState.currentState = action.to;
  const loaded = await executeScreenLoad({
    config,
    flow,
    session,
    operations,
    stateId: action.to,
    workingState,
  });

  workingState.history.push({
    action: actionId,
    from,
    to: action.to,
    ok: true,
    timestamp: new Date().toISOString(),
  });
  await writeFlowSessionState(session, workingState);

  return {
    action: actionId,
    from,
    to: action.to,
    calls,
    loaded,
    state: workingState,
  };
}

/**
 * Run a screen's `load` calls and persist the resulting state. Used when a
 * session starts directly on a screen (flow start), where there is no
 * transitioning action to trigger the load. Returns the executed load calls and
 * the updated state; a no-op (empty `loaded`) when the screen defines no load.
 */
export async function runScreenLoad(options: {
  config: Config;
  flow: FlowConfig;
  session: string;
}): Promise<{ loaded: FlowCallResult[]; state: FlowSessionState }> {
  const { config, flow, session } = options;
  const state = await getFlowSessionState(session);
  const screen = flow.states[state.currentState];
  if (!screen?.load?.length) {
    return { loaded: [], state };
  }
  const operations = await loadOpenApiOperations(config.openapi.specPath);
  const workingState = cloneState(state);
  const loaded = await executeScreenLoad({
    config,
    flow,
    session,
    operations,
    stateId: state.currentState,
    workingState,
  });
  await writeFlowSessionState(session, workingState);
  return { loaded, state: workingState };
}

/** Execute the `load` calls declared on a screen, mutating workingState. */
async function executeScreenLoad(options: {
  config: Config;
  flow: FlowConfig;
  session: string;
  operations: Map<string, OpenApiOperation>;
  stateId: string;
  workingState: FlowSessionState;
}): Promise<FlowCallResult[]> {
  const { config, flow, session, operations, stateId, workingState } = options;
  const loadCalls = flow.states[stateId]?.load ?? [];
  if (loadCalls.length === 0) return [];
  // Load reads from the global pool only — saved values plus env. It has no
  // action inputs or manual values of its own.
  const context: Record<string, unknown> = { ...workingState.saved, env: process.env };
  return executeHttpCalls({
    config,
    flow,
    session,
    operations,
    sourceLabel: `${stateId}:load`,
    calls: loadCalls,
    context,
    workingState,
  });
}

/**
 * Execute a list of HTTP calls in sequence against a working state: render each
 * with the shared context, enforce its expected status, apply observe/save, and
 * record an edge. Shared by action calls and screen load calls. Throws a
 * FlowError on an unknown operationId or an unexpected status; the caller
 * decides how to reflect that in session history.
 */
async function executeHttpCalls(options: {
  config: Config;
  flow: FlowConfig;
  session: string;
  operations: Map<string, OpenApiOperation>;
  sourceLabel: string;
  calls: FlowCallConfig[];
  context: Record<string, unknown>;
  workingState: FlowSessionState;
}): Promise<FlowCallResult[]> {
  const { config, flow, session, operations, sourceLabel, calls, context, workingState } = options;
  const results: FlowCallResult[] = [];

  for (const call of calls) {
    const operation = operations.get(call.operationId!);
    if (!operation) {
      throw new FlowError("UNKNOWN_OPERATION", `Unknown OpenAPI operationId "${call.operationId}"`, {
        operationId: call.operationId,
        action: sourceLabel,
      });
    }

    const rendered = renderCall(operation, call, context);
    const response = await callWithAuth({
      method: operation.method,
      url: `${config.server.baseUrl}${rendered.path}`,
      headers: rendered.headers,
      body: rendered.body,
      authProfile: call.auth ?? flow.defaultAuth,
    });

    const expectedStatus = call.expect?.status;
    if (expectedStatus != null && response.status !== expectedStatus) {
      throw new FlowError(
        "UNEXPECTED_STATUS",
        `"${sourceLabel}" failed: ${call.operationId} expected status ${expectedStatus}, got ${response.status}`,
        {
          action: sourceLabel,
          operationId: call.operationId,
          expected: expectedStatus,
          received: response.status,
        },
      );
    }

    const observedKeys = applyObserve(workingState, sourceLabel, call, response.body);
    const savedKeys = applySave(workingState, call, response.body, context);

    await recordEdge({
      session,
      method: operation.method,
      path: rendered.path,
      body: rendered.body,
      authProfile: call.auth ?? flow.defaultAuth,
      templatePath: operation.path,
      templateBody: call.body,
      refs: rendered.refs,
      response,
      warnings: [],
    });

    results.push({
      operationId: call.operationId,
      method: operation.method,
      path: rendered.path,
      status: response.status,
      saved: savedKeys,
      observed: observedKeys,
    });
  }

  return results;
}

function resolveManualValues(
  action: FlowActionConfig,
  rawValues: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of action.manual ?? []) {
    if (!(key in rawValues)) {
      throw new FlowError("MISSING_MANUAL_VALUE", `Missing manual value "${key}". Pass it with --value ${key}=<json>`, {
        input: key,
      });
    }
    result[key] = rawValues[key];
  }
  return result;
}

function getAction(flow: FlowConfig, stateId: string, actionId: string): FlowActionConfig {
  const state = flow.states[stateId];
  if (!state) {
    throw new FlowError("UNKNOWN_STATE", `Current flow state "${stateId}" is not defined`, { state: stateId });
  }
  const action = state.actions?.[actionId];
  if (!action) {
    const allowed = Object.keys(state.actions ?? {});
    throw new FlowError(
      "ACTION_NOT_AVAILABLE",
      `Action "${actionId}" is not available from state "${stateId}". Allowed actions: ${allowed.join(", ")}`,
      { action: actionId, state: stateId, allowed },
    );
  }
  return action;
}

function resolveRequiredInputs(
  flow: FlowConfig,
  state: FlowSessionState,
  actionId: string,
  action: FlowActionConfig,
  rawInputs: Record<string, string>,
): Record<string, ObservedValue> {
  const result: Record<string, ObservedValue> = {};

  for (const [inputName, requirement] of Object.entries(action.requires ?? {})) {
    const requestedId = rawInputs[inputName];
    if (!requestedId) {
      const producers = suggestProducerActions(flow, state.currentState, requirement.observedAs);
      throw new FlowError(
        "MISSING_REQUIRED_INPUT",
        `Missing required input "${inputName}". Run one of these actions first or choose an observed value: ${producers.join(", ")}`,
        { input: inputName, observedAs: requirement.observedAs, producers },
      );
    }

    const candidates = state.observed[requirement.observedAs] ?? [];
    const selected = candidates.find((candidate) => candidate.id === requestedId);
    if (!selected) {
      throw new FlowError(
        "INPUT_NOT_OBSERVED",
        `Input "${inputName}" value "${requestedId}" was not observed as "${requirement.observedAs}"`,
        {
          input: inputName,
          requestedId,
          observedAs: requirement.observedAs,
          candidates: candidates.map((c) => c.id),
        },
      );
    }
    result[inputName] = selected;
  }

  return result;
}

export function renderCall(
  operation: OpenApiOperation,
  call: FlowCallConfig,
  context: Record<string, unknown>,
): { path: string; headers: Record<string, string>; body: any; refs: Ref[] } {
  const params = renderValue(call.params ?? {}, context) as Record<string, unknown>;
  let path = operation.path;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, "g"), encodeURIComponent(String(value)));
  }

  const query = Object.entries(params).filter(([key]) => !operation.path.includes(`{${key}}`));
  if (query.length > 0) {
    const search = new URLSearchParams();
    for (const [key, value] of query) {
      if (value != null) search.set(key, String(value));
    }
    const suffix = search.toString();
    if (suffix) path += `?${suffix}`;
  }

  return {
    path,
    headers: renderValue(call.headers ?? {}, context) as Record<string, string>,
    body: call.body == null ? undefined : renderValue(call.body, context),
    refs: [],
  };
}

function renderValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const only = /^\$\{([^}]+)\}$/.exec(value);
    if (only) return readContext(context, only[1]);
    return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => String(readContext(context, expr)));
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, context));
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        renderValue(child, context),
      ]),
    );
  }
  return value;
}

function readContext(context: Record<string, unknown>, expression: string): unknown {
  const parts = expression.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot resolve template "\${${expression}}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) {
    throw new Error(`Cannot resolve template "\${${expression}}"`);
  }
  return current;
}

function applySave(
  state: FlowSessionState,
  call: FlowCallConfig,
  responseBody: unknown,
  context: Record<string, unknown>,
): string[] {
  const saved: string[] = [];
  const root = { body: responseBody };
  for (const [key, path] of Object.entries(call.save ?? {})) {
    const value = selectOne(root, path);
    if (value !== undefined) {
      state.saved[key] = value;
      context[key] = value;
      saved.push(key);
    }
  }
  return saved;
}

function applyObserve(
  state: FlowSessionState,
  actionId: string,
  call: FlowCallConfig,
  responseBody: unknown,
): string[] {
  const observed: string[] = [];
  const root = { body: responseBody };
  const callId = call.id ?? call.operationId ?? "unknown";

  for (const [key, spec] of Object.entries(call.observe ?? {})) {
    const ids = selectJsonPath(root, spec.id);
    const labels = spec.label ? selectJsonPath(root, spec.label) : [];
    const existing = state.observed[key] ?? [];
    const byId = new Map(existing.map((entry) => [entry.id, entry]));

    ids.forEach((id, index) => {
      if (id == null) return;
      const idString = String(id);
      byId.set(idString, {
        id: idString,
        label: labels[index] == null ? undefined : String(labels[index]),
        value: id,
        source: { action: actionId, call: callId },
      });
    });

    state.observed[key] = [...byId.values()];
    observed.push(key);
  }

  return observed;
}

async function appendHistory(
  session: string,
  state: FlowSessionState,
  entry: FlowSessionState["history"][number],
): Promise<void> {
  state.history.push(entry);
  await writeFlowSessionState(session, state);
}

function cloneState(state: FlowSessionState): FlowSessionState {
  return JSON.parse(JSON.stringify(state)) as FlowSessionState;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
