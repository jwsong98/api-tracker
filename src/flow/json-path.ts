function normalize(path: string): string {
  if (!path.startsWith("$.")) {
    throw new Error(`Unsupported JSONPath "${path}": expected "$." prefix`);
  }
  return path.slice(2);
}

function readSegment(values: unknown[], segment: string): unknown[] {
  if (segment === "*") {
    return values.flatMap((value) => (Array.isArray(value) ? value : []));
  }

  const arrayMatch = /^(.+)\[\*\]$/.exec(segment);
  if (arrayMatch) {
    const key = arrayMatch[1];
    return values.flatMap((value) => {
      if (value == null || typeof value !== "object") return [];
      const child = (value as Record<string, unknown>)[key];
      return Array.isArray(child) ? child : [];
    });
  }

  return values.flatMap((value) => {
    if (value == null || typeof value !== "object") return [];
    const child = (value as Record<string, unknown>)[segment];
    return child === undefined ? [] : [child];
  });
}

export function selectJsonPath(root: unknown, path: string): unknown[] {
  const segments = normalize(path).split(".").filter(Boolean);
  return segments.reduce((values, segment) => readSegment(values, segment), [root]);
}

export function selectOne(root: unknown, path: string): unknown {
  const values = selectJsonPath(root, path);
  return values[0];
}
