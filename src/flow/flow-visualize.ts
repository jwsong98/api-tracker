import type { FlowConfig } from "./types.js";

export function generateMermaid(flow: FlowConfig, currentState?: string): string {
  const lines: string[] = ["stateDiagram-v2"];

  lines.push(`  [*] --> ${flow.initialState}`);

  for (const [stateId, state] of Object.entries(flow.states)) {
    const name = state.title ?? stateId;
    const label = state.route ? `${stateId} : ${name}\\n${state.route}` : `${stateId} : ${name}`;
    lines.push(`  ${label}`);
  }

  if (currentState && flow.states[currentState]) {
    lines.push(`  classDef active fill:#f9f,stroke:#333,stroke-width:2px`);
    lines.push(`  class ${currentState} active`);
  }

  for (const [stateId, state] of Object.entries(flow.states)) {
    for (const [actionId, action] of Object.entries(state.actions ?? {})) {
      const protocol = action.protocol === "ws" ? " [ws]" : "";
      const name = action.title ?? actionId;
      lines.push(`  ${stateId} --> ${action.to} : ${name}${protocol}`);
    }
  }

  return lines.join("\n");
}
