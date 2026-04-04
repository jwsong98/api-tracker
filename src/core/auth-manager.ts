import { loadConfig } from "../storage/config-loader.js";
import { readJson, writeJson } from "../storage/file-store.js";
import type { AuthCache, AuthProfile } from "../types.js";

function extractByTokenPath(obj: unknown, tokenPath: string): string {
  // tokenPath: "$.accessToken" or "$.data.token" etc.
  const parts = tokenPath.replace(/^\$\./, "").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot extract tokenPath "${tokenPath}": missing key "${part}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") {
    throw new Error(`Token at "${tokenPath}" is not a string`);
  }
  return current;
}

async function getProfile(profileName: string): Promise<{ profile: AuthProfile; baseUrl: string }> {
  const config = await loadConfig();
  const profile = config.auth.profiles[profileName];
  if (!profile) {
    throw new Error(`Auth profile "${profileName}" not found in config.yaml`);
  }
  return { profile, baseUrl: config.server.baseUrl };
}

async function loadAuthCache(): Promise<AuthCache> {
  return (await readJson<AuthCache>("auth.json")) ?? {};
}

export async function login(
  profileName: string,
): Promise<{ token: string; expiresAt?: string }> {
  const { profile, baseUrl } = await getProfile(profileName);

  const url = baseUrl + profile.endpoint;
  const res = await fetch(url, {
    method: profile.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile.credentials),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Login failed for profile "${profileName}": ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`,
    );
  }

  const json: unknown = await res.json();
  const token = extractByTokenPath(json, profile.tokenPath);
  const expiresAt =
    typeof (json as Record<string, unknown>).expiresAt === "string"
      ? ((json as Record<string, unknown>).expiresAt as string)
      : undefined;

  const cache = await loadAuthCache();
  cache[profileName] = {
    token,
    expiresAt: expiresAt ?? "",
    note: profile.note,
  };
  await writeJson("auth.json", cache);

  return { token, expiresAt };
}

export async function getToken(profileName: string): Promise<string> {
  const cache = await loadAuthCache();
  const entry = cache[profileName];
  if (entry?.token) {
    return entry.token;
  }
  const result = await login(profileName);
  return result.token;
}

export async function refreshOnUnauthorized(profileName: string): Promise<string> {
  const result = await login(profileName);
  return result.token;
}

export async function getAuthStatus(): Promise<AuthCache> {
  return loadAuthCache();
}
