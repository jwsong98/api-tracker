import { Command } from "commander";
import { readYaml, readJson } from "../../storage/file-store.js";
import { getSession, getActiveSession } from "../../core/session-manager.js";
import { resolveRequest, inferRefs } from "../../core/binding-engine.js";
import { detectUnreachable } from "../../detection/unreachable.js";
import { callWithAuth } from "../../core/http-caller.js";
import { recordEdge } from "../../core/recorder.js";
import { formatOutput } from "../../output/formatter.js";
import type { Config, Bindings } from "../../types.js";

export function callCommand(): Command {
  const cmd = new Command("call")
    .description("Make an API call and record it")
    .argument("<method>", "HTTP method")
    .argument("<path>", "API path")
    .option("--body <json>", "Request body (JSON string)")
    .option("--auth <profile>", "Auth profile name")
    .option("--session <name>", "Session name")
    .option("--header <key:value>", "Additional header (repeatable)", collect, [])
    .option("--human", "Human-readable output")
    .action(async (method: string, path: string, opts) => {
      try {
        // 1. Load config
        const config = await readYaml<Config>("config.yaml");

        // 2. Resolve session
        const sessionName = opts.session ?? (await getActiveSession());
        if (!sessionName) {
          console.log(JSON.stringify({ error: "No active session. Run 'session start' first." }));
          return;
        }
        await getSession(sessionName); // validate existence

        // 3. Load bindings
        const bindings = (await readJson<Bindings>(`sessions/${sessionName}/bindings.json`)) ?? {};

        // 4. Parse body
        const body = opts.body ? JSON.parse(opts.body) : undefined;

        // 5. Resolve templates
        const templatePath = path;
        const templateBody = body;
        const { resolved, refs: explicitRefs } = resolveRequest({ path, body }, bindings);

        // 6. Auto-infer refs
        const inferredRefs = inferRefs(resolved, bindings);
        const allRefs = [...explicitRefs, ...inferredRefs];

        // 7. Detect unreachable
        const warnings = detectUnreachable(allRefs);

        // 8. Build URL and call
        const url = `${config.server.baseUrl}${resolved.path}`;
        const response = await callWithAuth({
          method,
          url,
          body: resolved.body,
          authProfile: opts.auth,
        });

        // 9. Record edge
        const { edgeId, fromNode, toNode, newBindings } = await recordEdge({
          session: sessionName,
          method,
          path: resolved.path,
          body: resolved.body,
          authProfile: opts.auth,
          templatePath,
          templateBody,
          refs: allRefs,
          response,
          warnings,
        });

        // 10. Output
        const output = {
          node: toNode,
          edge: edgeId,
          request: { method, path: resolved.path, body: resolved.body },
          response: { status: response.status, body: response.body },
          refs: allRefs,
          warnings,
          newBindings,
        };

        console.log(formatOutput(output, { human: opts.human }));
      } catch (err: unknown) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      }
    });

  return cmd;
}

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}
