import { readJson, writeJson } from "../storage/file-store.js";
import type { FlowConfig, FlowSessionState } from "./types.js";

export function initialFlowState(flow: FlowConfig, initialState?: string): FlowSessionState {
  const currentState = initialState ?? flow.initialState;
  if (!flow.states[currentState]) {
    throw new Error(`Initial flow state "${currentState}" is not defined`);
  }
  return {
    currentState,
    saved: {},
    observed: {},
    history: [],
  };
}

export async function createFlowSessionState(
  session: string,
  flow: FlowConfig,
  initialState?: string,
): Promise<FlowSessionState> {
  const state = initialFlowState(flow, initialState);
  await writeFlowSessionState(session, state);
  return state;
}

export async function getFlowSessionState(session: string): Promise<FlowSessionState> {
  const state = await readJson<FlowSessionState>(`sessions/${session}/flow-state.json`);
  if (!state) {
    throw new Error(`Flow state for session "${session}" not found. Run 'flow start' first.`);
  }
  return state;
}

export async function writeFlowSessionState(
  session: string,
  state: FlowSessionState,
): Promise<void> {
  await writeJson(`sessions/${session}/flow-state.json`, state);
}
