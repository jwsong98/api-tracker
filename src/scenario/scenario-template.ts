/**
 * Scenario template resolver. Decoupled from flow's renderValue so scenarios can
 * reference their own context (`params`, `baseline`, `saved`, `run`, `env`) and
 * use `${var + N}` / `${var - N}` offsets for baseline-relative counts — the one
 * arithmetic form we allow, deliberately not a general expression language.
 * See docs/scenario-loop-design.md §3.4.
 */

const OFFSET_RE = /^([\w.]+)\s*([+-])\s*(\d+(?:\.\d+)?)$/;

function readPath(ctx: Record<string, unknown>, expression: string): unknown {
  let current: unknown = ctx;
  for (const part of expression.split(".")) {
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot resolve template "\${${expression}}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) {
    throw new Error(`Cannot resolve template "\${${expression}}"`);
  }
  return current;
}

function resolveExpr(expr: string, ctx: Record<string, unknown>): unknown {
  const offset = OFFSET_RE.exec(expr);
  if (offset) {
    const base = Number(readPath(ctx, offset[1]));
    if (Number.isNaN(base)) {
      throw new Error(`Cannot apply offset to non-number "\${${offset[1]}}"`);
    }
    const n = Number(offset[3]);
    return offset[2] === "+" ? base + n : base - n;
  }
  return readPath(ctx, expr);
}

/**
 * Resolve a single string. A whole-string `${expr}` returns the raw typed value
 * (number/object/etc); embedded references are stringified into place.
 */
export function resolveString(str: string, ctx: Record<string, unknown>): unknown {
  const whole = /^\$\{([^}]+)\}$/.exec(str);
  if (whole) return resolveExpr(whole[1].trim(), ctx);
  return str.replace(/\$\{([^}]+)\}/g, (_, expr: string) => String(resolveExpr(expr.trim(), ctx)));
}

/** Recursively resolve `${...}` templates in strings within any JSON value. */
export function resolveDeep(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") return resolveString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, ctx));
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveDeep(v, ctx)]),
    );
  }
  return value;
}
