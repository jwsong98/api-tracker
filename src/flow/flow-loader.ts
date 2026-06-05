import { readYaml } from "../storage/file-store.js";
import type { Config } from "../types.js";
import { loadOpenApiOperations } from "./openapi-index.js";
import type { FlowConfig } from "./types.js";

export async function loadFlowConfig(relativePath = "flow.yaml"): Promise<FlowConfig> {
  const flow = await readYaml<FlowConfig>(relativePath);
  validateFlowShape(flow);
  return flow;
}

export async function validateFlowConfig(flow: FlowConfig, config: Config): Promise<void> {
  validateFlowShape(flow);
  const operations = await loadOpenApiOperations(config.openapi.specPath);

  for (const [stateId, state] of Object.entries(flow.states)) {
    for (const call of state.load ?? []) {
      if (!call.operationId) {
        throw new Error(`State "${stateId}" load call is missing operationId`);
      }
      if (!operations.has(call.operationId)) {
        throw new Error(`State "${stateId}" load references unknown operationId "${call.operationId}"`);
      }
    }
    for (const [actionId, action] of Object.entries(state.actions ?? {})) {
      if (!flow.states[action.to]) {
        throw new Error(`Action "${stateId}.${actionId}" points to unknown state "${action.to}"`);
      }
      if (action.protocol === "ws") continue;
      for (const call of action.calls ?? []) {
        if (!call.operationId) {
          throw new Error(`Action "${stateId}.${actionId}" HTTP call is missing operationId`);
        }
        if (!operations.has(call.operationId)) {
          throw new Error(
            `Action "${stateId}.${actionId}" references unknown operationId "${call.operationId}"`,
          );
        }
      }
    }
  }
}

function validateFlowShape(flow: FlowConfig): void {
  if (flow.version !== 1) {
    throw new Error("flow.yaml version must be 1");
  }
  if (!flow.initialState || typeof flow.initialState !== "string") {
    throw new Error("flow.yaml must define initialState");
  }
  if (!flow.states || typeof flow.states !== "object") {
    throw new Error("flow.yaml must define states");
  }
  if (!flow.states[flow.initialState]) {
    throw new Error(`initialState "${flow.initialState}" is not defined in states`);
  }
}
