import readline, { type Key } from "node:readline";
import { renderEdge } from "./session-browser.js";
import type { Edge } from "../types.js";
import type { ScenarioOverview } from "../scenario/scenario-store.js";
import type { ScenarioConfig, ScenarioResult, StepStatus } from "../scenario/types.js";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bgSelect: "\x1b[48;5;238m",
};

const MARK: Record<StepStatus, string> = {
  passed: `${C.green}✔${C.reset}`,
  failed: `${C.red}✘${C.reset}`,
  pending: `${C.dim}◌${C.reset}`,
};

function termWidth(): number {
  return process.stdout.columns ?? 80;
}

function hr(char = "─"): string {
  return char.repeat(termWidth());
}

function clear(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * A human checklist of a completed run — the "cognitive-debt" view (design
 * §3.5). Shared with `scenario status/run --human` output.
 */
export function renderChecklist(r: ScenarioResult): string {
  const badge = r.overall === "green" ? `${C.green}● GREEN${C.reset}` : `${C.red}● RED${C.reset}`;
  const lines: string[] = [];
  lines.push(`${C.bold}${r.ticket}${C.reset}${r.title ? `  ${r.title}` : ""}    attempt ${r.attempt}   ${badge}`);
  lines.push("─".repeat(60));

  if (r.baseline.length) {
    lines.push(`${C.dim}BASELINE${C.reset}`);
    for (const b of r.baseline) {
      lines.push(` ${MARK[b.status]} ${b.operationId}${b.saved.length ? `  ${C.dim}→ ${b.saved.join(", ")}${C.reset}` : ""}`);
      if (b.error) lines.push(`     ${C.red}${b.error.message}${C.reset}`);
    }
  }

  lines.push(`${C.dim}STEPS${C.reset}`);
  for (const s of r.steps) {
    const route = s.from && s.to ? `  ${C.dim}${s.from} → ${s.to}${C.reset}` : "";
    lines.push(` ${MARK[s.status]} ${s.id + 1}. ${s.action}${route}`);
    if (s.error) lines.push(`     ${C.red}${s.error.message}${C.reset}`);
  }

  if (r.goal.length) {
    lines.push(`${C.dim}GOAL${C.reset}`);
    for (const g of r.goal) {
      lines.push(` ${MARK[g.status]} ${g.name}`);
      if (g.error) lines.push(`     ${C.red}${g.error.message}${C.reset}`);
    }
  }
  return lines.join("\n");
}

/** A planned (never-run) scenario rendered from its YAML — all steps pending. */
function renderPlanned(config: ScenarioConfig): string {
  const lines: string[] = [];
  lines.push(`${C.bold}${config.ticket}${C.reset}${config.title ? `  ${config.title}` : ""}    ${C.dim}not run yet${C.reset}`);
  lines.push("─".repeat(60));
  if (config.description) lines.push(`${C.dim}${config.description}${C.reset}`);

  if (config.baseline?.length) {
    lines.push(`${C.dim}BASELINE${C.reset}`);
    for (const b of config.baseline) lines.push(` ${MARK.pending} ${b.operationId}`);
  }

  lines.push(`${C.dim}STEPS${C.reset}`);
  config.steps.forEach((s, i) => lines.push(` ${MARK.pending} ${i + 1}. ${s.action}`));

  if (config.goal?.length) {
    lines.push(`${C.dim}GOAL${C.reset}`);
    for (const g of config.goal) lines.push(` ${MARK.pending} ${g.name}`);
  }
  return lines.join("\n");
}

function overviewLabel(o: ScenarioOverview): { ticket: string; title: string } {
  const ticket = o.config?.ticket ?? o.result?.ticket ?? o.path.replace(/^scenarios\//, "").replace(/\.ya?ml$/i, "");
  const title = o.config?.title ?? o.result?.title ?? "";
  return { ticket, title };
}

function statusBadge(o: ScenarioOverview): string {
  if (!o.result) return `${C.dim}—      ${C.reset}`;
  return o.result.overall === "green" ? `${C.green}GREEN${C.reset}  ` : `${C.red}RED${C.reset}    `;
}

function renderList(overviews: ScenarioOverview[], cursor: number): void {
  clear();
  console.log(hr("═"));
  console.log(`  ${C.bold}Scenarios${C.reset}   ${C.dim}[↑][↓] move  [Enter] open  [q] quit${C.reset}`);
  console.log(hr("═"));
  console.log();

  const ticketWidth = Math.max(...overviews.map((o) => overviewLabel(o).ticket.length), 6);

  overviews.forEach((o, i) => {
    const { ticket, title } = overviewLabel(o);
    const selected = i === cursor;
    const badge = statusBadge(o);
    const attempt = o.result ? `${C.dim}attempt ${o.result.attempt}${C.reset}` : "";
    const when = o.result ? `${C.dim}${new Date(o.result.finishedAt).toLocaleString()}${C.reset}` : "";
    const row = `${ticket.padEnd(ticketWidth)}  ${badge}  ${title.padEnd(28)}  ${attempt}  ${when}`;
    if (selected) {
      process.stdout.write(`${C.bgSelect} ▶ ${C.bold}${row}${C.reset}\n`);
    } else {
      console.log(`   ${row}`);
    }
  });

  console.log();
  console.log(hr("═"));
}

function renderDetail(o: ScenarioOverview): void {
  clear();
  console.log(hr("═"));
  const canEdges = Boolean(o.result && (o.result.steps.length || o.result.baseline.length || o.result.goal.length));
  const edgeHint = canEdges ? `  ${C.cyan}[e] browse edges${C.reset}` : "";
  console.log(`  ${C.dim}[Esc] back${edgeHint}  ${C.dim}[q] quit${C.reset}`);
  console.log(hr("═"));
  console.log();
  const body = o.result
    ? renderChecklist(o.result)
    : o.config
      ? renderPlanned(o.config)
      : `${C.yellow}(scenario YAML could not be parsed: ${o.path})${C.reset}`;
  console.log(body);
  console.log();
  console.log(hr("═"));
}

// ── Keypress helper ────────────────────────────────────────────────────────────

type KeyResult = "done" | "back" | "edges" | "continue";

function waitKey(handler: (key: Key) => KeyResult): Promise<Exclude<KeyResult, "continue">> {
  return new Promise((resolve) => {
    function onKeypress(_ch: string, key: Key): void {
      if (!key) return;
      const result = handler(key);
      if (result !== "continue") {
        process.stdin.removeListener("keypress", onKeypress);
        resolve(result);
      }
    }
    process.stdin.on("keypress", onKeypress);
  });
}

// ── Public: interactive scenario board → detail → edge drill-in ────────────────

export async function browseScenarios(
  overviews: ScenarioOverview[],
  loadEdges: (session: string) => Promise<Edge[]>,
): Promise<void> {
  if (overviews.length === 0) {
    console.log("(no scenarios found under scenarios/)");
    return;
  }

  if (!process.stdin.isTTY) {
    console.log(
      JSON.stringify({
        scenarios: overviews.map((o) => ({
          path: o.path,
          ticket: overviewLabel(o).ticket,
          overall: o.result?.overall ?? null,
          attempt: o.result?.attempt ?? null,
        })),
      }),
    );
    return;
  }

  const sorted = [...overviews].sort((a, b) => {
    const ta = a.result?.finishedAt ?? "";
    const tb = b.result?.finishedAt ?? "";
    return tb.localeCompare(ta);
  });

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  let cursor = 0;

  // outer loop: scenario list → detail → (edges) → back to list
  while (true) {
    renderList(sorted, cursor);

    const listResult = await waitKey((key) => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) return "done";
      if (key.name === "up" || key.name === "k") {
        if (cursor > 0) cursor--;
        renderList(sorted, cursor);
      } else if (key.name === "down" || key.name === "j") {
        if (cursor < sorted.length - 1) cursor++;
        renderList(sorted, cursor);
      } else if (key.name === "return") {
        return "back"; // reuse "back" to signal "selected"
      }
      return "continue";
    });

    if (listResult === "done") break;
    const selected = sorted[cursor];

    // detail loop: allow repeated 'e' drill-ins until Esc/q
    let leaveDetail = false;
    while (!leaveDetail) {
      renderDetail(selected);
      const detailResult = await waitKey((key) => {
        if (key.name === "q" || (key.ctrl && key.name === "c")) return "done";
        if (key.name === "escape" || key.name === "backspace") return "back";
        if (key.name === "e") return "edges";
        return "continue";
      });

      if (detailResult === "done") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        clear();
        return;
      }
      if (detailResult === "back") {
        leaveDetail = true;
      } else if (detailResult === "edges" && selected.result) {
        // Inline edge browser so keys stay consistent with the rest of the TUI:
        // [←][→] navigate, [Esc] back to detail, [q] quit. (browseEdges is a
        // standalone q-only viewer and would trap Esc here.)
        const edges = await loadEdges(selected.result.session);
        if (edges.length === 0) continue; // no recorded calls → stay on detail

        const sessionName = selected.result.session;
        let edgeIdx = 0;
        renderEdge(edges[edgeIdx], edgeIdx, edges.length, sessionName);
        const edgeResult = await waitKey((key) => {
          if (key.name === "q" || (key.ctrl && key.name === "c")) return "done";
          if (key.name === "escape" || key.name === "backspace") return "back";
          if (key.name === "right" || key.name === "l") {
            if (edgeIdx < edges.length - 1) edgeIdx++;
            renderEdge(edges[edgeIdx], edgeIdx, edges.length, sessionName);
          } else if (key.name === "left" || key.name === "h") {
            if (edgeIdx > 0) edgeIdx--;
            renderEdge(edges[edgeIdx], edgeIdx, edges.length, sessionName);
          }
          return "continue";
        });
        if (edgeResult === "done") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          clear();
          return;
        }
        // "back" → detail loop re-renders the checklist
      }
    }
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();
  clear();
}
