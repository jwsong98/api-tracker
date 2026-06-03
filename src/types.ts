// ── Config (config.yaml) ──

export interface Config {
  server: {
    baseUrl: string;
  };
  openapi: {
    specPath: string;
  };
  auth: {
    profiles: Record<string, AuthProfile>;
  };
  db: {
    resetCommand: string;
    resetWorkingDir: string;
  };
}

export interface AuthProfile {
  endpoint: string;
  method: string;
  credentials: Record<string, string>;
  tokenPath: string;
  note: string;
}

// ── Auth Cache (auth.json) ──

export type AuthCache = Record<
  string,
  {
    token: string;
    expiresAt: string;
    note: string;
  }
>;

// ── Session (meta.json) ──

export type SessionStatus = "active" | "completed" | "diverged";

export interface SessionMeta {
  name: string;
  status: SessionStatus;
  createdAt: string;
  continueFrom: string | null;
  lastNodeId: number;
  edgeCount: number;
}

// ── Edge (edges/NNN.json) ──

export interface EdgeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  template: {
    path: string;
    body: unknown;
  };
}

export interface EdgeResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface Ref {
  value: unknown;
  source: string;
  boundAs: string | null;
}

export interface WsReceivedMessage {
  destination: string;
  body: unknown;
  timestamp: string;
}

export interface WsEdgeExtension {
  protocol: "ws";
  destination: string;
  subscribe?: string;
  clientGeneratedId?: string;
  received: WsReceivedMessage[];
  matchedMessage?: WsReceivedMessage;
}

export interface Edge {
  edgeId: number;
  fromNode: number;
  toNode: number;
  timestamp: string;
  request: EdgeRequest;
  response: EdgeResponse;
  refs: Ref[];
  warnings: string[];
  authProfile: string;
  ws?: WsEdgeExtension;
}

// ── Graph (graph.json) ──

export interface GraphNode {
  id: number;
  label: string;
}

export interface GraphEdge {
  id: number;
  from: number;
  to: number;
  file: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Bindings (bindings.json) ──

export type Bindings = Record<
  string,
  {
    value: unknown;
    origin: string;
    jsonPath: string;
  }
>;
