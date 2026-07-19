import * as readline from "node:readline";
import type { FlowConfig, FlowActionConfig } from "./types.js";

interface InteractiveState {
  currentState: string;
  history: { action: string; from: string; to: string }[];
  cursor: number;
}

export function runInteractive(flow: FlowConfig): void {
  const state: InteractiveState = {
    currentState: flow.initialState,
    history: [],
    cursor: 0,
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  render(flow, state);

  process.stdin.on("keypress", (_ch, key) => {
    if (!key) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.stdout.write("\x1B[?25h\n");
      process.exit(0);
    }

    const actions = getActions(flow, state.currentState);

    if (key.name === "up") {
      state.cursor = Math.max(0, state.cursor - 1);
    } else if (key.name === "down") {
      state.cursor = Math.min(actions.length - 1, state.cursor - 0 + 1);
    } else if (key.name === "return" && actions.length > 0) {
      const selected = actions[state.cursor];
      if (selected) {
        state.history.push({
          action: selected.id,
          from: state.currentState,
          to: selected.config.to,
        });
        state.currentState = selected.config.to;
        state.cursor = 0;
      }
    } else if (key.name === "backspace" && state.history.length > 0) {
      const prev = state.history.pop()!;
      state.currentState = prev.from;
      state.cursor = 0;
    }

    render(flow, state);
  });
}

interface ActionEntry {
  id: string;
  config: FlowActionConfig;
}

function getActions(flow: FlowConfig, stateId: string): ActionEntry[] {
  const stateConfig = flow.states[stateId];
  if (!stateConfig?.actions) return [];
  return Object.entries(stateConfig.actions).map(([id, config]) => ({ id, config }));
}

function render(flow: FlowConfig, state: InteractiveState): void {
  const { currentState, history, cursor } = state;
  const stateConfig = flow.states[currentState];
  const actions = getActions(flow, currentState);

  const lines: string[] = [];

  // clear screen
  lines.push("\x1B[2J\x1B[H\x1B[?25l");

  lines.push("\x1B[1m API Flow Explorer \x1B[0m");
  lines.push("");

  // state map — show all states, highlight current
  lines.push("\x1B[90m── States ──\x1B[0m");
  for (const [id, s] of Object.entries(flow.states)) {
    const marker = id === currentState ? "\x1B[36m● " : "\x1B[90m○ ";
    const title = s.title ? ` \x1B[0m${s.title}` : "";
    const route = s.route ? ` \x1B[90m${s.route}\x1B[0m` : "";
    lines.push(`  ${marker}${id}\x1B[0m${title}${route}`);
  }
  lines.push("");

  // current state detail
  const currentTitle = stateConfig?.title ? ` ${stateConfig.title}` : "";
  lines.push(`\x1B[1mCurrent:\x1B[0m \x1B[36m${currentState}\x1B[0m${currentTitle} \x1B[90m${stateConfig?.route ?? ""}\x1B[0m`);
  lines.push("");

  // actions
  if (actions.length === 0) {
    lines.push("\x1B[90m  (no actions available)\x1B[0m");
  } else {
    lines.push("\x1B[90m── Actions ──\x1B[0m");
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const selected = i === cursor;
      const arrow = selected ? "\x1B[33m▸ " : "  ";
      const bg = selected ? "\x1B[7m" : "";
      const protocol = a.config.protocol === "ws" ? " \x1B[35m[ws]\x1B[0m" : "";
      const transition = `\x1B[90m→ ${a.config.to}\x1B[0m`;

      const requires = Object.keys(a.config.requires ?? {});
      const manual = a.config.manual ?? [];
      const inputs: string[] = [];
      if (requires.length > 0) inputs.push(`requires: ${requires.join(", ")}`);
      if (manual.length > 0) inputs.push(`manual: ${manual.join(", ")}`);
      const inputStr = inputs.length > 0 ? `  \x1B[90m(${inputs.join(" | ")})\x1B[0m` : "";

      const calls = (a.config.calls ?? [])
        .map((c) => c.operationId ?? c.destination ?? "")
        .filter(Boolean);
      const callStr = calls.length > 0 ? `  \x1B[90m[${calls.join(", ")}]\x1B[0m` : "";

      const title = a.config.title ? ` \x1B[90m${a.config.title}\x1B[0m` : "";
      lines.push(`${arrow}${bg}${a.id}\x1B[0m${title} ${transition}${protocol}${callStr}${inputStr}`);
    }
  }
  lines.push("");

  // history
  if (history.length > 0) {
    lines.push("\x1B[90m── History ──\x1B[0m");
    const shown = history.slice(-8);
    for (let i = 0; i < shown.length; i++) {
      const h = shown[i];
      const num = history.length - shown.length + i + 1;
      lines.push(`  \x1B[90m${num}. ${h.from} → ${h.action} → ${h.to}\x1B[0m`);
    }
    lines.push("");
  }

  // help
  lines.push("\x1B[90m↑↓ select  ↵ execute  ⌫ undo  q quit\x1B[0m");

  process.stdout.write(lines.join("\n"));
}
