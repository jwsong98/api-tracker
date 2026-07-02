/**
 * Structural matchers for goal assertions. A scenario asserts on the *shape* and
 * *relation* of server-generated values it cannot know ahead of time (uuids,
 * timestamps), not literal equality. See docs/scenario-loop-design.md §3.4.
 *
 * Pure module: expected values must already be template-resolved by the caller.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATCHER_KEYS = [
  "equals",
  "exists",
  "isUuid",
  "matches",
  "contains",
  "length",
  "minLength",
  "gt",
  "gte",
  "lt",
  "lte",
  "after",
  "before",
] as const;

export type MatcherName = (typeof MATCHER_KEYS)[number];

export interface NormalizedSpec {
  matcher: MatcherName;
  expected: unknown;
}

export interface MatchFailure {
  path: string;
  matcher: MatcherName;
  expected: unknown;
  actual: unknown;
}

/**
 * Interpret a raw matcher spec. A one-key object whose key is a known matcher
 * (e.g. `{ isUuid: true }`, `{ after: "..." }`) selects that matcher; anything
 * else (a string/number/bool/array, or a plain object) is an `equals` target.
 */
export function normalizeSpec(spec: unknown): NormalizedSpec {
  if (spec != null && typeof spec === "object" && !Array.isArray(spec)) {
    const keys = Object.keys(spec as Record<string, unknown>);
    if (keys.length === 1 && (MATCHER_KEYS as readonly string[]).includes(keys[0])) {
      return { matcher: keys[0] as MatcherName, expected: (spec as Record<string, unknown>)[keys[0]] };
    }
  }
  return { matcher: "equals", expected: spec };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Length of an array/string match, else the count of JSONPath matches. */
function lengthOf(first: unknown, matches: unknown[]): number {
  if (Array.isArray(first) || typeof first === "string") return first.length;
  return matches.length;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got ${JSON.stringify(value)}`);
  return n;
}

function asTime(value: unknown): number {
  const t = new Date(value as string).getTime();
  if (Number.isNaN(t)) throw new Error(`Expected an ISO timestamp, got ${JSON.stringify(value)}`);
  return t;
}

/**
 * Evaluate one assertion against the JSONPath match set. Returns a failure
 * describing expected vs actual, or null when it holds. `matches` is the array
 * selectJsonPath returns; single-value paths use `matches[0]`.
 */
export function evaluateAssertion(
  matches: unknown[],
  spec: NormalizedSpec,
  path: string,
): MatchFailure | null {
  const first = matches[0];
  const { matcher, expected } = spec;
  const fail = (actual: unknown): MatchFailure => ({ path, matcher, expected, actual });

  switch (matcher) {
    case "equals":
      return deepEqual(first, expected) ? null : fail(first);

    case "exists": {
      const present = matches.length > 0 && first !== null && first !== undefined;
      const want = expected !== false;
      return present === want ? null : fail(present);
    }

    case "isUuid":
      return typeof first === "string" && UUID_RE.test(first) ? null : fail(first);

    case "matches": {
      const ok = typeof first === "string" && new RegExp(String(expected)).test(first);
      return ok ? null : fail(first);
    }

    case "contains": {
      const inArray = matches.some((v) => deepEqual(v, expected));
      const inString = typeof first === "string" && first.includes(String(expected));
      return inArray || inString ? null : fail(matches);
    }

    case "length": {
      const len = lengthOf(first, matches);
      return len === asNumber(expected) ? null : fail(len);
    }

    case "minLength": {
      const len = lengthOf(first, matches);
      return len >= asNumber(expected) ? null : fail(len);
    }

    case "gt":
      return asNumber(first) > asNumber(expected) ? null : fail(first);
    case "gte":
      return asNumber(first) >= asNumber(expected) ? null : fail(first);
    case "lt":
      return asNumber(first) < asNumber(expected) ? null : fail(first);
    case "lte":
      return asNumber(first) <= asNumber(expected) ? null : fail(first);

    case "after":
      return asTime(first) > asTime(expected) ? null : fail(first);
    case "before":
      return asTime(first) < asTime(expected) ? null : fail(first);

    default:
      throw new Error(`Unknown matcher "${matcher}"`);
  }
}
