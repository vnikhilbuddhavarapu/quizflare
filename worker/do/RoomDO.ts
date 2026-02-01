import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { parseCookies } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";

type MemberRow = {
  token: string;
  role: "host" | "player";
  name: string;
  joinedAtMs: number;
};

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, createdAtMs INTEGER NOT NULL);",
      );

      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS members (token TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, joinedAtMs INTEGER NOT NULL);",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const reqId = getRequestId(request);
    const upgradeHeader = request.headers.get("Upgrade");

    const url = new URL(request.url);
    if (upgradeHeader !== "websocket") {
      if (url.pathname === "/init-host") {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });

        const body = await request.json().catch(() => null);
        const obj: Record<string, unknown> =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const hostToken =
          typeof obj.hostToken === "string" ? obj.hostToken : "";
        if (!hostToken) return new Response(null, { status: 400 });

        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO members(token, role, name, joinedAtMs) VALUES(?, 'host', 'Host', ?);",
          hostToken,
          Date.now(),
        );

        log("info", "room.init_host", { reqId });
        await this.broadcastLobbyState();
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/join") {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });

        const body = await request.json().catch(() => null);
        const obj: Record<string, unknown> =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const playerToken =
          typeof obj.playerToken === "string" ? obj.playerToken : "";
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        if (!playerToken) return new Response(null, { status: 400 });
        if (name.length < 1 || name.length > 20)
          return new Response(null, { status: 400 });

        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO members(token, role, name, joinedAtMs) VALUES(?, 'player', ?, ?);",
          playerToken,
          name,
          Date.now(),
        );

        log("info", "room.join", { reqId });
        const lobby = await this.getLobbyState();
        await this.broadcastLobbyState(lobby);
        return new Response(JSON.stringify(lobby), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (upgradeHeader !== "websocket") {
      log("warn", "room.fetch.non_websocket", { reqId });
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const cookies = parseCookies(request.headers.get("Cookie"));
    const hasHost = Boolean(cookies.qf_host);
    const hasPlayer = Boolean(cookies.qf_player);

    const token = cookies.qf_host ?? cookies.qf_player ?? null;
    const roleHint = await this.getRoleHintFromToken(token);

    log("info", "room.ws.connect", { reqId, hasHost, hasPlayer });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (token) this.ctx.acceptWebSocket(server, [token]);
    else this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({ type: "connected", v: 1, roleHint }));

    const lobby = await this.getLobbyState();
    server.send(JSON.stringify(lobby));
    await this.broadcastLobbyState(lobby);

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
    await this.broadcastLobbyState();
  }

  private async getRoleHintFromToken(
    token: string | null,
  ): Promise<"host" | "player" | null> {
    if (!token) return null;

    const row = this.ctx.storage.sql
      .exec<{
        role: string;
      }>("SELECT role FROM members WHERE token = ? LIMIT 1;", token)
      .toArray()[0];
    if (!row) return null;
    if (row.role === "host" || row.role === "player") return row.role;
    return null;
  }

  private getConnectedTokenSet(): Set<string> {
    const set = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        for (const tag of this.ctx.getTags(ws)) {
          set.add(tag);
        }
      } catch {
        // ignore
      }
    }
    return set;
  }

  private async getLobbyState() {
    const members = this.ctx.storage.sql
      .exec<MemberRow>(
        "SELECT token, role, name, joinedAtMs FROM members ORDER BY joinedAtMs ASC;",
      )
      .toArray();

    const connected = this.getConnectedTokenSet();
    return {
      type: "lobby_state" as const,
      v: 1 as const,
      members: members.map((m) => ({
        role: m.role,
        name: m.name,
        connected: connected.has(m.token),
      })),
    };
  }

  private async broadcastLobbyState(
    precomputed?: Awaited<ReturnType<RoomDO["getLobbyState"]>>,
  ) {
    const lobby = precomputed ?? (await this.getLobbyState());
    const msg = JSON.stringify(lobby);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // ignore
      }
    }
  }
}
