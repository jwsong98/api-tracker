import readline, { type Key } from "node:readline";
import type { Edge, SessionMeta } from "../types.js";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgSelect: "\x1b[48;5;238m",
};

const STATUS_COLOR: Record<string, string> = {
  active: C.green,
  completed: C.blue,
  diverged: C.yellow,
};

function statusStyle(status: number): string {
  const color = status >= 200 && status < 300 ? C.green : status >= 400 ? C.red : C.yellow;
  return `${C.bold}${color}${status}${C.reset}`;
}

function methodStyle(method: string): string {
  const colors: Record<string, string> = {
    GET: C.green, POST: C.blue, PUT: C.yellow,
    PATCH: C.yellow, DELETE: C.red,
  };
  return `${C.bold}${colors[method] ?? C.white}${method}${C.reset}`;
}

function termWidth(): number {
  return process.stdout.columns ?? 80;
}

function hr(char = "─"): string {
  return char.repeat(termWidth());
}

function center(text: string, width: number): string {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, Math.floor((width - plain.length) / 2));
  return " ".repeat(pad) + text;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined || value === "") return `${C.dim}(empty)${C.reset}`;
  const json = JSON.stringify(value, null, 2);
  return json.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `${C.cyan}${match}${C.reset}`;
        return `${C.green}${match}${C.reset}`;
      }
      if (/true|false/.test(match)) return `${C.magenta}${match}${C.reset}`;
      if (/null/.test(match)) return `${C.dim}${match}${C.reset}`;
      return `${C.yellow}${match}${C.reset}`;
    },
  );
}

// ── Renders ──────────────────────────────────────────────────────────────────

function renderSessionList(sessions: SessionMeta[], cursor: number): void {
  const width = termWidth();
  process.stdout.write("\x1b[2J\x1b[H");

  console.log(hr("═"));
  console.log(center(
    `${C.bold}Sessions${C.reset}   ${C.dim}[↑][↓] move  [Enter] select  [q] quit${C.reset}`,
    width,
  ));
  console.log(hr("═"));
  console.log();

  const nameWidth = Math.max(...sessions.map((s) => s.name.length), 4);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const selected = i === cursor;
    const color = STATUS_COLOR[s.status] ?? "";
    const statusStr = `${color}${s.status}${C.reset}`;
    const created = new Date(s.createdAt).toLocaleString();

    if (selected) {
      process.stdout.write(`${C.bgSelect} ▶ ${C.bold}${s.name.padEnd(nameWidth)}${C.reset}${C.bgSelect}  ${statusStr}${C.bgSelect}  ${String(s.edgeCount).padStart(3)} calls  ${C.dim}${created}${C.reset}\n`);
    } else {
      console.log(`   ${s.name.padEnd(nameWidth)}  ${statusStr}  ${String(s.edgeCount).padStart(3)} calls  ${C.dim}${created}${C.reset}`);
    }
  }

  console.log();
  console.log(hr("═"));
}

function renderEdge(edge: Edge, index: number, total: number, sessionName: string): void {
  const width = termWidth();
  const { request: req, response: res } = edge;
  const ts = new Date(edge.timestamp).toLocaleString();

  process.stdout.write("\x1b[2J\x1b[H");

  const navHint = `${C.dim}[←][→] navigate  [Esc] back to list  [q] quit${C.reset}`;
  const stepLabel = `${C.bold}${sessionName}  Step ${index + 1} / ${total}${C.reset}`;
  console.log(hr("═"));
  console.log(center(`${stepLabel}    ${navHint}`, width));
  console.log(hr("═"));

  console.log(`  ${methodStyle(req.method)}  ${C.bold}${req.path}${C.reset}   →  ${statusStyle(res.status)}`);
  console.log(`  ${C.dim}${ts}${C.reset}${edge.authProfile ? `   auth: ${edge.authProfile}` : ""}`);

  if (edge.warnings.length > 0) {
    console.log(`  ${C.yellow}⚠ ${edge.warnings.join(", ")}${C.reset}`);
  }
  if (edge.refs.length > 0) {
    const bound = edge.refs.filter((r) => r.boundAs).map((r) => r.boundAs).join(", ");
    if (bound) console.log(`  ${C.dim}bindings: ${bound}${C.reset}`);
  }

  console.log("\n" + hr());
  console.log(`  ${C.bold}${C.blue}▶ REQUEST${C.reset}`);
  console.log(hr());

  const reqHeaders = Object.entries(req.headers ?? {})
    .filter(([k]) => !k.toLowerCase().startsWith("authorization"))
    .map(([k, v]) => `  ${C.cyan}"${k}"${C.reset}: ${C.green}"${v}"${C.reset}`)
    .join("\n");
  if (reqHeaders) {
    console.log(`${C.dim}  headers:${C.reset}`);
    console.log(reqHeaders);
  }
  console.log(`${C.dim}  body:${C.reset}`);
  for (const line of prettyJson(req.body).split("\n")) console.log(`  ${line}`);

  console.log("\n" + hr());
  console.log(`  ${C.bold}${C.green}◀ RESPONSE  ${statusStyle(res.status)}${C.reset}`);
  console.log(hr());

  const resContentType = res.headers?.["content-type"] ?? "";
  if (resContentType) console.log(`  ${C.dim}content-type: ${resContentType}${C.reset}`);
  for (const line of prettyJson(res.body).split("\n")) console.log(`  ${line}`);

  if (edge.ws) {
    console.log("\n" + hr());
    console.log(`  ${C.bold}${C.magenta}WS  ${edge.ws.destination}${C.reset}`);
    console.log(hr());
    for (const msg of edge.ws.received) {
      const msgTs = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`  ${C.dim}${msgTs}${C.reset}  ← ${msg.destination}`);
      for (const line of prettyJson(msg.body).split("\n")) console.log(`    ${line}`);
    }
  }

  console.log("\n" + hr("═"));
}

// ── Keypress helper ───────────────────────────────────────────────────────────
// handler returns: "done" | "back" | "continue"

type KeyResult = "done" | "back" | "continue";

function waitKey(handler: (key: Key) => KeyResult): Promise<"done" | "back"> {
  return new Promise<"done" | "back">((resolve) => {
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

// ── Public: standalone edge browser (used by session show) ───────────────────

export async function browseEdges(edges: Edge[], sessionName: string): Promise<void> {
  if (edges.length === 0) {
    console.log("(no recorded calls in this session)");
    return;
  }

  if (!process.stdin.isTTY) return;

  let idx = 0;
  renderEdge(edges[idx], idx, edges.length, sessionName);

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  await waitKey((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[2J\x1b[H");
      return "done";
    }
    if (key.name === "right" || key.name === "l") {
      if (idx < edges.length - 1) idx++;
      renderEdge(edges[idx], idx, edges.length, sessionName);
    } else if (key.name === "left" || key.name === "h") {
      if (idx > 0) idx--;
      renderEdge(edges[idx], idx, edges.length, sessionName);
    }
    return "continue";
  });
}

// ── Public: interactive session list → edge browser ──────────────────────────

export async function browseInteractive(
  sessions: SessionMeta[],
  loadEdges: (name: string) => Promise<Edge[]>,
): Promise<void> {
  if (sessions.length === 0) {
    console.log("(no sessions found)");
    return;
  }

  if (!process.stdin.isTTY) {
    console.log(JSON.stringify({ sessions: sessions.map((s) => s.name) }));
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  let cursor = 0;

  // outer loop: session list → edge view → back to session list
  while (true) {
    renderSessionList(sorted, cursor);

    // Phase 1: pick a session
    let selectedName: string | null = null;
    const listResult = await waitKey((key) => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) return "done";
      if (key.name === "up" || key.name === "k") {
        if (cursor > 0) cursor--;
        renderSessionList(sorted, cursor);
      } else if (key.name === "down" || key.name === "j") {
        if (cursor < sorted.length - 1) cursor++;
        renderSessionList(sorted, cursor);
      } else if (key.name === "return") {
        selectedName = sorted[cursor].name;
        return "back"; // reuse "back" to signal "selected"
      }
      return "continue";
    });

    if (listResult === "done") break;
    if (!selectedName) break;

    // Phase 2: browse edges
    const edges = await loadEdges(selectedName);

    if (edges.length === 0) {
      renderSessionList(sorted, cursor);
      // show brief message then re-render list
      process.stdout.write(`\x1b[2A\x1b[2K  ${C.yellow}(no calls recorded)${C.reset}\n`);
      continue;
    }

    let edgeIdx = 0;
    renderEdge(edges[edgeIdx], edgeIdx, edges.length, selectedName);

    const edgeResult = await waitKey((key) => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) return "done";
      if (key.name === "escape" || key.name === "backspace") return "back";
      if (key.name === "right" || key.name === "l") {
        if (edgeIdx < edges.length - 1) edgeIdx++;
        renderEdge(edges[edgeIdx], edgeIdx, edges.length, selectedName!);
      } else if (key.name === "left" || key.name === "h") {
        if (edgeIdx > 0) edgeIdx--;
        renderEdge(edges[edgeIdx], edgeIdx, edges.length, selectedName!);
      }
      return "continue";
    });

    if (edgeResult === "done") break;
    // "back" → loop again (show session list)
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[2J\x1b[H");
}
