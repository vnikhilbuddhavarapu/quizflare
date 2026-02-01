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

type Phase =
  | "lobby"
  | "countdown"
  | "question_preview"
  | "answering"
  | "reveal"
  | "scoreboard"
  | "finished";

type GameRow = {
  phase: Phase;
  locked: number;
  questionIndex: number;
  phaseStartedAtMs: number;
  phaseEndsAtMs: number | null;
};

type Question = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  answerDurationMs: number;
  previewDurationMs: number;
};

const QUIZ: Question[] = [
  {
    id: "q1",
    text: "What is the capital of France?",
    options: ["Paris", "Berlin", "Madrid", "Rome"],
    correctIndex: 0,
    previewDurationMs: 5000,
    answerDurationMs: 15000,
  },
  {
    id: "q2",
    text: "2 + 2 = ?",
    options: ["3", "4", "5", "22"],
    correctIndex: 1,
    previewDurationMs: 5000,
    answerDurationMs: 12000,
  },
];

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

      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS scores (token TEXT PRIMARY KEY, score INTEGER NOT NULL);",
      );

      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS answers (questionIndex INTEGER NOT NULL, token TEXT NOT NULL, choiceIndex INTEGER NOT NULL, submittedAtMs INTEGER NOT NULL, correct INTEGER NOT NULL, points INTEGER NOT NULL, PRIMARY KEY(questionIndex, token));",
      );

      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL, locked INTEGER NOT NULL, questionIndex INTEGER NOT NULL, phaseStartedAtMs INTEGER NOT NULL, phaseEndsAtMs INTEGER);",
      );

      ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO game(id, phase, locked, questionIndex, phaseStartedAtMs, phaseEndsAtMs) VALUES(1, 'lobby', 0, 0, 0, NULL);",
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
        await this.broadcastGameState();
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

        const game = this.getGameRow();
        if (game.phase !== "lobby") {
          return new Response(
            JSON.stringify({ error: { code: "game_started" } }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (game.locked === 1) {
          return new Response(
            JSON.stringify({ error: { code: "room_locked" } }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO members(token, role, name, joinedAtMs) VALUES(?, 'player', ?, ?);",
          playerToken,
          name,
          Date.now(),
        );

        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO scores(token, score) VALUES(?, 0);",
          playerToken,
        );

        log("info", "room.join", { reqId });
        const lobby = await this.getLobbyState();
        await this.broadcastLobbyState(lobby);
        await this.broadcastGameState();
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

    const as = url.searchParams.get("as");
    const candidateTokens: Array<string | null> =
      as === "host"
        ? [cookies.qf_host ?? null, cookies.qf_player ?? null]
        : as === "player"
          ? [cookies.qf_player ?? null, cookies.qf_host ?? null]
          : [cookies.qf_player ?? null, cookies.qf_host ?? null];

    let token: string | null = null;
    let roleHint: "host" | "player" | null = null;
    for (const t of candidateTokens) {
      if (!t) continue;
      const r = await this.getRoleHintFromToken(t);
      if (r) {
        token = t;
        roleHint = r;
        break;
      }
    }

    log("info", "room.ws.connect", { reqId, hasHost, hasPlayer });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (token) this.ctx.acceptWebSocket(server, [token]);
    else this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({ type: "connected", v: 1, roleHint }));

    const lobby = await this.getLobbyState();
    server.send(JSON.stringify(lobby));

    const gameState = this.getGameState();
    server.send(JSON.stringify(gameState));
    await this.broadcastLobbyState(lobby);
    await this.broadcastGameState(gameState);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    log("info", "room.ws.message", {
      bytes: typeof message === "string" ? message.length : message.byteLength,
    });

    if (typeof message !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return;
    const msg = parsed as Record<string, unknown>;
    const type = typeof msg.type === "string" ? msg.type : "";

    const token = this.getWsToken(ws);
    const role = await this.getRoleHintFromToken(token);
    if (!token || !role) return;

    if (type === "host_lock_room") {
      if (role !== "host") return;
      const locked = msg.locked === true ? 1 : 0;
      const game = this.getGameRow();
      if (game.phase !== "lobby") return;
      this.ctx.storage.sql.exec(
        "UPDATE game SET locked = ? WHERE id = 1;",
        locked,
      );
      await this.broadcastGameState();
      return;
    }

    if (type === "host_start_game") {
      if (role !== "host") return;
      const game = this.getGameRow();
      if (game.phase !== "lobby") return;

      this.ctx.storage.sql.exec("DELETE FROM answers;");
      this.ctx.storage.sql.exec("UPDATE scores SET score = 0;");

      const now = Date.now();
      await this.setPhase({
        phase: "countdown",
        questionIndex: 0,
        locked: 1,
        phaseStartedAtMs: now,
        phaseEndsAtMs: now + 3000,
      });
      await this.broadcastGameState();
      return;
    }

    if (type === "host_next") {
      if (role !== "host") return;
      const game = this.getGameRow();
      if (game.phase === "finished") {
        await this.setPhase({
          phase: "lobby",
          questionIndex: 0,
          locked: 0,
          phaseStartedAtMs: Date.now(),
          phaseEndsAtMs: null,
        });
        await this.broadcastGameState();
        return;
      }
      if (game.phase === "scoreboard") {
        const nextIndex = game.questionIndex + 1;
        if (nextIndex >= QUIZ.length) {
          await this.setPhase({
            phase: "finished",
            questionIndex: game.questionIndex,
            locked: 1,
            phaseStartedAtMs: Date.now(),
            phaseEndsAtMs: null,
          });
        } else {
          const now = Date.now();
          await this.setPhase({
            phase: "countdown",
            questionIndex: nextIndex,
            locked: 1,
            phaseStartedAtMs: now,
            phaseEndsAtMs: now + 3000,
          });
        }
        await this.broadcastGameState();
      }
      return;
    }

    if (type === "answer_submit") {
      if (role !== "player") return;
      const choiceIndex =
        typeof msg.choiceIndex === "number" ? msg.choiceIndex : -1;
      const game = this.getGameRow();
      if (game.phase !== "answering") return;
      const q = QUIZ[game.questionIndex];
      if (!q) return;
      if (
        !Number.isInteger(choiceIndex) ||
        choiceIndex < 0 ||
        choiceIndex >= q.options.length
      )
        return;

      const now = Date.now();
      if (game.phaseEndsAtMs != null && now > game.phaseEndsAtMs) return;

      const already = this.ctx.storage.sql
        .exec<{
          n: number;
        }>(
          "SELECT COUNT(1) as n FROM answers WHERE questionIndex = ? AND token = ?;",
          game.questionIndex,
          token,
        )
        .toArray()[0];
      if (already && already.n > 0) return;

      const correct = choiceIndex === q.correctIndex ? 1 : 0;
      const duration = q.answerDurationMs;
      const endsAt = game.phaseEndsAtMs ?? now;
      const remaining = Math.max(0, endsAt - now);
      const timeFactor =
        duration > 0 ? Math.min(1, Math.max(0, remaining / duration)) : 0;
      const points =
        correct === 1 ? Math.round(1000 * (0.3 + 0.7 * timeFactor)) : 0;

      this.ctx.storage.sql.exec(
        "INSERT INTO answers(questionIndex, token, choiceIndex, submittedAtMs, correct, points) VALUES(?, ?, ?, ?, ?, ?);",
        game.questionIndex,
        token,
        choiceIndex,
        now,
        correct,
        points,
      );
      this.ctx.storage.sql.exec(
        "UPDATE scores SET score = score + ? WHERE token = ?;",
        points,
        token,
      );

      await this.broadcastGameState();
      return;
    }
  }

  async webSocketClose(_ws: WebSocket, code: number, reason: string) {
    log("info", "room.ws.close", { code, reason });
    await this.broadcastLobbyState();
    await this.broadcastGameState();
  }

  async alarm() {
    const game = this.getGameRow();
    const now = Date.now();
    if (game.phaseEndsAtMs != null && now < game.phaseEndsAtMs) {
      return;
    }

    if (game.phase === "countdown") {
      const q = QUIZ[game.questionIndex];
      if (!q) return;
      const started = Date.now();
      await this.setPhase({
        phase: "question_preview",
        questionIndex: game.questionIndex,
        locked: 1,
        phaseStartedAtMs: started,
        phaseEndsAtMs: started + q.previewDurationMs,
      });
      await this.broadcastGameState();
      return;
    }

    if (game.phase === "question_preview") {
      const q = QUIZ[game.questionIndex];
      if (!q) return;
      const started = Date.now();
      await this.setPhase({
        phase: "answering",
        questionIndex: game.questionIndex,
        locked: 1,
        phaseStartedAtMs: started,
        phaseEndsAtMs: started + q.answerDurationMs,
      });
      await this.broadcastGameState();
      return;
    }

    if (game.phase === "answering") {
      const started = Date.now();
      await this.setPhase({
        phase: "reveal",
        questionIndex: game.questionIndex,
        locked: 1,
        phaseStartedAtMs: started,
        phaseEndsAtMs: started + 5000,
      });
      await this.broadcastGameState();
      return;
    }

    if (game.phase === "reveal") {
      await this.setPhase({
        phase: "scoreboard",
        questionIndex: game.questionIndex,
        locked: 1,
        phaseStartedAtMs: Date.now(),
        phaseEndsAtMs: null,
      });
      await this.broadcastGameState();
      return;
    }
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
        void 0;
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
        void 0;
      }
    }
  }

  private getWsToken(ws: WebSocket): string | null {
    try {
      const tags = this.ctx.getTags(ws);
      return tags.length > 0 ? tags[0] : null;
    } catch {
      return null;
    }
  }

  private getGameRow(): GameRow {
    const row = this.ctx.storage.sql
      .exec<GameRow>(
        "SELECT phase, locked, questionIndex, phaseStartedAtMs, phaseEndsAtMs FROM game WHERE id = 1;",
      )
      .toArray()[0];
    if (row) return row;
    return {
      phase: "lobby",
      locked: 0,
      questionIndex: 0,
      phaseStartedAtMs: 0,
      phaseEndsAtMs: null,
    };
  }

  private getLeaderboard(limit = 50) {
    const rows = this.ctx.storage.sql
      .exec<{
        name: string;
        role: string;
        score: number;
      }>(
        "SELECT m.name as name, m.role as role, s.score as score FROM scores s JOIN members m ON m.token = s.token WHERE m.role = 'player' ORDER BY s.score DESC LIMIT ?;",
        limit,
      )
      .toArray();

    return rows.map((r) => ({ name: r.name, role: r.role, score: r.score }));
  }

  private getAnsweredCount(questionIndex: number) {
    const row = this.ctx.storage.sql
      .exec<{
        n: number;
      }>(
        "SELECT COUNT(1) as n FROM answers WHERE questionIndex = ?;",
        questionIndex,
      )
      .toArray()[0];
    return row?.n ?? 0;
  }

  private getPlayerCount() {
    const row = this.ctx.storage.sql
      .exec<{
        n: number;
      }>("SELECT COUNT(1) as n FROM members WHERE role = 'player';")
      .toArray()[0];
    return row?.n ?? 0;
  }

  private getGameState(precomputed?: GameRow) {
    const game = precomputed ?? this.getGameRow();
    const q = QUIZ[game.questionIndex] ?? null;
    const base: Record<string, unknown> = {
      type: "game_state",
      v: 1,
      phase: game.phase,
      locked: game.locked === 1,
      questionIndex: game.questionIndex,
      serverNowMs: Date.now(),
      phaseStartedAtMs: game.phaseStartedAtMs,
      phaseEndsAtMs: game.phaseEndsAtMs,
      leaderboard:
        game.phase === "scoreboard" || game.phase === "finished"
          ? this.getLeaderboard()
          : undefined,
      answeredCount:
        game.phase === "answering"
          ? this.getAnsweredCount(game.questionIndex)
          : undefined,
      playerCount:
        game.phase === "answering" ? this.getPlayerCount() : undefined,
    };

    if (!q) return base;

    if (game.phase === "question_preview") {
      return { ...base, question: { text: q.text } };
    }

    if (game.phase === "answering") {
      return { ...base, question: { text: q.text, options: q.options } };
    }

    if (game.phase === "reveal") {
      return {
        ...base,
        question: { text: q.text, options: q.options },
        reveal: { correctIndex: q.correctIndex },
      };
    }

    if (game.phase === "scoreboard" || game.phase === "finished") {
      return {
        ...base,
        question: { text: q.text, options: q.options },
        reveal: { correctIndex: q.correctIndex },
      };
    }

    return base;
  }

  private async broadcastGameState(
    precomputed?: ReturnType<RoomDO["getGameState"]>,
  ) {
    const state = precomputed ?? this.getGameState();
    const msg = JSON.stringify(state);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        void 0;
      }
    }
  }

  private async setPhase(next: {
    phase: Phase;
    locked: number;
    questionIndex: number;
    phaseStartedAtMs: number;
    phaseEndsAtMs: number | null;
  }) {
    this.ctx.storage.sql.exec(
      "UPDATE game SET phase = ?, locked = ?, questionIndex = ?, phaseStartedAtMs = ?, phaseEndsAtMs = ? WHERE id = 1;",
      next.phase,
      next.locked,
      next.questionIndex,
      next.phaseStartedAtMs,
      next.phaseEndsAtMs,
    );

    if (next.phaseEndsAtMs != null) {
      await this.ctx.storage.setAlarm(next.phaseEndsAtMs);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}
