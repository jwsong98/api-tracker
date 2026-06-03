import { getToken, refreshOnUnauthorized } from "./auth-manager.js";

export async function callApi(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.body != null && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(options.url, {
    method: options.method,
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let body: any;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: res.status, headers: responseHeaders, body };
}

export async function callWithAuth(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  authProfile?: string;
}): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  if (options.authProfile) {
    const token = await getToken(options.authProfile);
    headers["Authorization"] = `Bearer ${token}`;
  }

  const result = await callApi({
    method: options.method,
    url: options.url,
    headers,
    body: options.body,
  });

  if (result.status === 401 && options.authProfile) {
    const newToken = await refreshOnUnauthorized(options.authProfile);
    headers["Authorization"] = `Bearer ${newToken}`;
    return callApi({
      method: options.method,
      url: options.url,
      headers,
      body: options.body,
    });
  }

  return result;
}
