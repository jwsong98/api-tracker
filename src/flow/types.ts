export interface FlowWsConfig {
  endpoint: string;
  timeout?: number;
}

export interface FlowConfig {
  version: 1;
  initialState: string;
  defaultAuth?: string;
  ws?: FlowWsConfig;
  states: Record<string, FlowStateConfig>;
}

export interface FlowStateConfig {
  route: string;
  /** Human-readable screen name (any language) shown alongside the state id. */
  title?: string;
  variant?: string;
  /**
   * Calls that fire automatically when this screen is entered (on transition in,
   * or on flow start when it is the initial state). They pool data from several
   * APIs into the session's observed/saved store so that later actions can
   * compose values gathered across the screen into a single follow-up call.
   * Load calls read from the global context (saved values + env); they cannot
   * read action-scoped inputs, so a navigating action must `save` anything its
   * destination's load needs.
   */
  load?: FlowCallConfig[];
  actions?: Record<string, FlowActionConfig>;
}

export interface FlowActionConfig {
  /** Human-readable action name (any language) shown alongside the action id. */
  title?: string;
  to: string;
  protocol?: "http" | "ws";
  subscribe?: string;
  requires?: Record<string, FlowRequiredInput>;
  manual?: string[];
  calls?: FlowCallConfig[];
}

export interface FlowRequiredInput {
  observedAs: string;
}

export interface FlowReceiveExpectation {
  timeout?: number;
  match?: Record<string, unknown>;
}

export interface FlowCallConfig {
  id?: string;
  operationId?: string;
  destination?: string;
  clientId?: boolean;
  auth?: string;
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
  save?: Record<string, string>;
  observe?: Record<string, FlowObserveConfig>;
  expect?: FlowExpectation;
}

export interface FlowExpectation {
  status?: number;
  receive?: FlowReceiveExpectation;
}

export interface FlowObserveConfig {
  id: string;
  label?: string;
}

export interface OpenApiFieldSchema {
  name: string;
  in: "body" | "path" | "query" | "header";
  type?: string;
  required: boolean;
  enum?: unknown[];
  format?: string;
  description?: string;
  itemsType?: string;
}

export interface OpenApiOperation {
  operationId: string;
  method: string;
  path: string;
  bodyFields?: OpenApiFieldSchema[];
  paramFields?: OpenApiFieldSchema[];
}

export interface ManualFieldInfo {
  name: string;
  type?: string;
  required: boolean;
  enum?: unknown[];
  format?: string;
  description?: string;
  itemsType?: string;
  /** operationId whose schema this typing was derived from, if matched. */
  fromOperation?: string;
}

export interface ObservedValue {
  id: string;
  label?: string;
  value?: unknown;
  source: {
    action: string;
    call: string;
  };
}

/** Result summary for a single executed call (an action call or a screen load call). */
export interface FlowCallResult {
  operationId?: string;
  destination?: string;
  method: string;
  path: string;
  status: number;
  saved: string[];
  observed: string[];
  clientGeneratedId?: string;
  received?: {
    count: number;
    matched: boolean;
    matchedMessage?: unknown;
    timeElapsed: number;
  };
}

export interface FlowHistoryEntry {
  action: string;
  from: string;
  to: string;
  ok: boolean;
  timestamp: string;
}

export interface FlowSessionState {
  currentState: string;
  saved: Record<string, unknown>;
  observed: Record<string, ObservedValue[]>;
  history: FlowHistoryEntry[];
}

/** A reference to a flow state, used as the common envelope header. */
export interface FlowStateRef {
  id: string;
  title?: string;
  route?: string;
  variant?: string;
}

/** An observed-input slot an action requires, plus the values currently pickable. */
export interface RequiredObservedInput {
  /** Input name the action expects (passed via --input <name>:<id>). */
  input: string;
  /** Observed bucket the candidates are drawn from. */
  observedAs: string;
  /** Values observed so far that can satisfy this input. */
  candidates: ObservedValue[];
}

export interface ActionInputs {
  observed: RequiredObservedInput[];
  manual: ManualFieldInfo[];
}

/** A fully-described action: what it does plus every input the agent must supply. */
export interface ActionView {
  id: string;
  title?: string;
  to: string;
  toTitle?: string;
  protocol?: "http" | "ws";
  inputs: ActionInputs;
}
