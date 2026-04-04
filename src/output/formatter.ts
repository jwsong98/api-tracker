export function formatOutput(data: any, options?: { human?: boolean }): string {
  if (!options?.human) {
    return JSON.stringify(data, null, 2);
  }

  // Simple human-readable format
  const lines: string[] = [];

  if (data.request) {
    lines.push(`${data.request.method} ${data.request.path}`);
  }
  if (data.response) {
    lines.push(`→ ${data.response.status}`);
    if (data.response.body) {
      lines.push(JSON.stringify(data.response.body, null, 2));
    }
  }
  if (data.warnings?.length) {
    lines.push("");
    for (const w of data.warnings) {
      lines.push(`⚠ ${w}`);
    }
  }
  if (data.newBindings && Object.keys(data.newBindings).length > 0) {
    lines.push("");
    lines.push("New bindings:");
    for (const [k, v] of Object.entries(data.newBindings)) {
      lines.push(`  ${k} = ${JSON.stringify(v)}`);
    }
  }

  return lines.join("\n");
}
