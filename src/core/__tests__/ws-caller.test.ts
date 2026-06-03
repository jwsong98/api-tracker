import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import {
  connectStomp,
  subscribe,
  send,
  waitForMessage,
  disconnect,
  type StompConnection,
} from "../ws-caller.js";

function buildFrame(command: string, headers: Record<string, string>, body?: string): string {
  let frame = command + "\n";
  for (const [key, value] of Object.entries(headers)) {
    frame += `${key}:${value}\n`;
  }
  frame += "\n";
  if (body) frame += body;
  frame += "\0";
  return frame;
}

function parseClientFrame(raw: string): { command: string; headers: Record<string, string>; body: string } | null {
  const nullIdx = raw.indexOf("\0");
  const content = nullIdx >= 0 ? raw.slice(0, nullIdx) : raw;
  const headerEnd = content.indexOf("\n\n");
  if (headerEnd === -1) return null;
  const headerBlock = content.slice(0, headerEnd);
  const body = content.slice(headerEnd + 2);
  const lines = headerBlock.split("\n");
  const command = lines[0];
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx > 0) {
      headers[lines[i].slice(0, colonIdx)] = lines[i].slice(colonIdx + 1);
    }
  }
  return { command, headers, body };
}

let wss: WebSocketServer;
let port: number;
let serverClients: WebSocket[] = [];

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 });
  port = (wss.address() as { port: number }).port;

  wss.on("connection", (ws) => {
    serverClients.push(ws);
    const subscriptions = new Map<string, string>();

    ws.on("message", (data) => {
      const raw = data.toString();
      const frame = parseClientFrame(raw);
      if (!frame) return;

      if (frame.command === "CONNECT") {
        ws.send(buildFrame("CONNECTED", { version: "1.2" }));
      }

      if (frame.command === "SUBSCRIBE") {
        subscriptions.set(frame.headers["id"], frame.headers["destination"]);
      }

      if (frame.command === "SEND") {
        for (const [subId, dest] of subscriptions) {
          ws.send(
            buildFrame(
              "MESSAGE",
              {
                subscription: subId,
                destination: dest,
                "message-id": `msg-${Date.now()}`,
                "content-type": "application/json",
              },
              frame.body,
            ),
          );
        }
      }

      if (frame.command === "DISCONNECT") {
        ws.send(buildFrame("RECEIPT", { "receipt-id": frame.headers["receipt"] ?? "" }));
      }
    });
  });
});

afterAll(() => {
  wss.close();
});

beforeEach(() => {
  serverClients = [];
});

describe("ws-caller", () => {
  let conn: StompConnection;

  afterEach(async () => {
    if (conn) {
      try {
        await disconnect(conn);
      } catch {}
    }
  });

  it("connects to a STOMP server", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("subscribes and receives messages after send", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    const buffer = subscribe(conn, "/topic/test");
    await send(conn, "/app/test", { text: "hello" });

    const result = await waitForMessage(buffer, { timeout: 2000 });
    expect(result.matched).not.toBeNull();
    expect((result.matched!.body as any).text).toBe("hello");
    expect(result.all.length).toBeGreaterThanOrEqual(1);
  });

  it("times out when no message is received", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    const buffer = subscribe(conn, "/topic/empty");

    const result = await waitForMessage(buffer, { timeout: 200 });
    expect(result.matched).toBeNull();
    expect(result.all).toHaveLength(0);
  });

  it("matches messages by condition", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    const buffer = subscribe(conn, "/topic/match-test");

    await send(conn, "/app/match-test", { type: "SYSTEM", text: "ignore" });

    setTimeout(async () => {
      await send(conn, "/app/match-test", { type: "CHAT", text: "target" });
    }, 50);

    const result = await waitForMessage(buffer, {
      timeout: 2000,
      match: { "$.body.type": "CHAT" },
    });

    expect(result.matched).not.toBeNull();
    expect((result.matched!.body as any).type).toBe("CHAT");
    expect((result.matched!.body as any).text).toBe("target");
  });

  it("supports clientGeneratedId matching", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    const buffer = subscribe(conn, "/topic/client-id");
    const clientId = "test-uuid-123";

    await send(conn, "/app/client-id", { clientGeneratedId: clientId, text: "tracked" });

    const result = await waitForMessage(buffer, {
      timeout: 2000,
      match: { "$.body.clientGeneratedId": clientId },
    });

    expect(result.matched).not.toBeNull();
    expect((result.matched!.body as any).clientGeneratedId).toBe(clientId);
  });

  it("disconnects cleanly", async () => {
    conn = await connectStomp({ url: `ws://localhost:${port}` });
    await disconnect(conn);
    expect(conn.ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
  });
});
