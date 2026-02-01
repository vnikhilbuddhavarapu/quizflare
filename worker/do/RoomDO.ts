import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { parseCookies } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, createdAtMs INTEGER NOT NULL);",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const reqId = getRequestId(request);
    const upgradeHeader = request.headers.get("Upgrade");

    if (upgradeHeader !== "websocket") {
      log("warn", "room.fetch.non_websocket", { reqId });
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const cookies = parseCookies(request.headers.get("Cookie"));
    const hasHost = Boolean(cookies.qf_host);
    const hasPlayer = Boolean(cookies.qf_player);

    log("info", "room.ws.connect", { reqId, hasHost, hasPlayer });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    server.send(
      JSON.stringify({ type: "connected", v: 1, roleHint: hasHost ? "host" : hasPlayer ? "player" : null }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    log("info", "room.ws.message", {
      bytes: typeof message === "string" ? message.length : message.byteLength,
    });
    ws.send(typeof message === "string" ? message : "[binary]");
  }

  async webSocketClose(_ws: WebSocket, code: number, reason: string) {
    log("info", "room.ws.close", { code, reason });
  }
}
