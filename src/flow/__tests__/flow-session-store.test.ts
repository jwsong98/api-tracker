import { describe, it, expect } from "vitest";
import { initialFlowState } from "../flow-session-store.js";
import type { FlowConfig } from "../types.js";

const flow: FlowConfig = {
  version: 1,
  initialState: "login",
  states: {
    login: { route: "/login" },
    project_list: { route: "/projects" },
  },
};

describe("initialFlowState", () => {
  it("uses flow.yaml initialState by default", () => {
    const state = initialFlowState(flow);
    expect(state.currentState).toBe("login");
  });

  it("allows overriding the initial state for a session", () => {
    const state = initialFlowState(flow, "project_list");
    expect(state.currentState).toBe("project_list");
  });

  it("rejects unknown initial states", () => {
    expect(() => initialFlowState(flow, "missing")).toThrow(
      'Initial flow state "missing" is not defined',
    );
  });
});
