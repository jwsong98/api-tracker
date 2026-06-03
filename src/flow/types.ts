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
  variant?: string;
  actions?: Record<string, FlowActionConfig>;
}

export interface FlowActionConfig {
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
  to: string;
  protocol?: "http" | "ws";
  inputs: ActionInputs;
}
