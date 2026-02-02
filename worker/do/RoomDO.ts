import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { parseCookies } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";

type RoomMetaRow = {
  id: number;
  pin: string | null;
  idleCleanupAtMs: number | null;
};

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
  imageUrl?: string;
  pointsMultiplier: number;
};

type QuizConfigRow = {
  id: number;
  quizId: string | null;
};

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      await this.ensureSchema();
    });
  }

  private async ensureSchema() {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, createdAtMs INTEGER NOT NULL);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS members (token TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, joinedAtMs INTEGER NOT NULL);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS scores (token TEXT PRIMARY KEY, score INTEGER NOT NULL);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS answers (questionIndex INTEGER NOT NULL, token TEXT NOT NULL, choiceIndex INTEGER NOT NULL, submittedAtMs INTEGER NOT NULL, correct INTEGER NOT NULL, points INTEGER NOT NULL, PRIMARY KEY(questionIndex, token));",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL, locked INTEGER NOT NULL, questionIndex INTEGER NOT NULL, phaseStartedAtMs INTEGER NOT NULL, phaseEndsAtMs INTEGER);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS quiz_config (id INTEGER PRIMARY KEY CHECK(id=1), quizId TEXT);",
    );

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO quiz_config(id, quizId) VALUES(1, NULL);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_meta (id INTEGER PRIMARY KEY CHECK(id=1), pin TEXT, idleCleanupAtMs INTEGER);",
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO room_meta(id, pin, idleCleanupAtMs) VALUES(1, NULL, NULL);",
    );

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS quiz_questions (idx INTEGER PRIMARY KEY, id TEXT NOT NULL, text TEXT NOT NULL, optionsJson TEXT NOT NULL, correctIndex INTEGER NOT NULL, previewDurationMs INTEGER NOT NULL, answerDurationMs INTEGER NOT NULL, imageUrl TEXT, pointsMultiplier INTEGER NOT NULL);",
    );

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO game(id, phase, locked, questionIndex, phaseStartedAtMs, phaseEndsAtMs) VALUES(1, 'lobby', 0, 0, 0, NULL);",
    );
  }

  private getPin(): string | null {
    const row = this.ctx.storage.sql
      .exec<RoomMetaRow>(
        "SELECT pin, idleCleanupAtMs, id FROM room_meta WHERE id = 1;",
      )
      .toArray()[0];
    const pin = row?.pin ?? null;
    return typeof pin === "string" && pin.length === 6 ? pin : null;
  }

  private setPin(pin: string) {
    this.ctx.storage.sql.exec(
      "UPDATE room_meta SET pin = ? WHERE id = 1;",
      pin,
    );
  }

  private getIdleCleanupAtMs(): number | null {
    const row = this.ctx.storage.sql
      .exec<RoomMetaRow>(
        "SELECT idleCleanupAtMs, pin, id FROM room_meta WHERE id = 1;",
      )
      .toArray()[0];
    const v = row?.idleCleanupAtMs ?? null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private setIdleCleanupAtMs(ts: number | null) {
    this.ctx.storage.sql.exec(
      "UPDATE room_meta SET idleCleanupAtMs = ? WHERE id = 1;",
      ts,
    );
  }

  private clearIdleCleanup() {
    this.setIdleCleanupAtMs(null);
  }

  private async updateAlarm() {
    const game = this.getGameRow();
    const idleAt = this.getIdleCleanupAtMs();
    const a =
      typeof game.phaseEndsAtMs === "number" ? game.phaseEndsAtMs : null;
    const b = typeof idleAt === "number" ? idleAt : null;
    const next =
      a != null && b != null
        ? Math.min(a, b)
        : a != null
          ? a
          : b != null
            ? b
            : null;
    if (next != null) {
      await this.ctx.storage.setAlarm(next);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async scheduleIdleCleanupIfEmpty() {
    if (this.ctx.getWebSockets().length > 0) {
      this.clearIdleCleanup();
      await this.updateAlarm();
      return;
    }
    const ms = 10 * 60 * 1000;
    this.setIdleCleanupAtMs(Date.now() + ms);
    await this.updateAlarm();
  }

  private async cleanupRoom(reason: string) {
    const pin = this.getPin();
    if (pin) {
      try {
        const id = this.env.PIN_REGISTRY_DO.idFromName("global");
        const stub = this.env.PIN_REGISTRY_DO.get(id);
        await stub.fetch("http://do/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
      } catch {
        void 0;
      }
    }

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, reason);
      } catch {
        void 0;
      }
    }

    try {
      this.ctx.storage.sql.exec("DELETE FROM sessions;");
      this.ctx.storage.sql.exec("DELETE FROM members;");
      this.ctx.storage.sql.exec("DELETE FROM scores;");
      this.ctx.storage.sql.exec("DELETE FROM answers;");
      this.ctx.storage.sql.exec("DELETE FROM quiz_questions;");
      this.ctx.storage.sql.exec(
        "UPDATE quiz_config SET quizId = NULL WHERE id = 1;",
      );
      this.ctx.storage.sql.exec(
        "UPDATE room_meta SET pin = NULL, idleCleanupAtMs = NULL WHERE id = 1;",
      );
      this.ctx.storage.sql.exec(
        "UPDATE game SET phase = 'lobby', locked = 0, questionIndex = 0, phaseStartedAtMs = 0, phaseEndsAtMs = NULL WHERE id = 1;",
      );
    } catch {
      void 0;
    }

    await this.ctx.storage.deleteAll();
    await this.ensureSchema();
    await this.updateAlarm();
  }

  private getQuizId(): string | null {
    const row = this.ctx.storage.sql
      .exec<QuizConfigRow>("SELECT quizId FROM quiz_config WHERE id = 1;")
      .toArray()[0];
    const quizId = row?.quizId ?? null;
    return typeof quizId === "string" && quizId.length > 0 ? quizId : null;
  }

  private getQuizLength(): number {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(1) as n FROM quiz_questions;")
      .toArray()[0];
    return row?.n ?? 0;
  }

  private getQuizQuestion(idx: number): Question | null {
    const row = this.ctx.storage.sql
      .exec<{
        id: string;
        text: string;
        optionsJson: string;
        correctIndex: number;
        previewDurationMs: number;
        answerDurationMs: number;
        imageUrl: string | null;
        pointsMultiplier: number;
      }>(
        "SELECT id, text, optionsJson, correctIndex, previewDurationMs, answerDurationMs, imageUrl, pointsMultiplier FROM quiz_questions WHERE idx = ? LIMIT 1;",
        idx,
      )
      .toArray()[0];
    if (!row) return null;

    let options: string[] = [];
    try {
      const parsed = JSON.parse(row.optionsJson) as unknown;
      options = Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      options = [];
    }

    return {
      id: row.id,
      text: row.text,
      options,
      correctIndex: row.correctIndex,
      previewDurationMs: row.previewDurationMs,
      answerDurationMs: row.answerDurationMs,
      imageUrl: row.imageUrl ?? undefined,
      pointsMultiplier: row.pointsMultiplier,
    };
  }

  private loadDefaultQuiz() {
    this.ctx.storage.sql.exec("DELETE FROM quiz_questions;");

    const questions: Array<{
      id: string;
      text: string;
      options: string[];
      correctIndex: number;
      previewDurationMs: number;
      answerDurationMs: number;
    }> = [
      {
        id: "demo-1",
        text: "Which planet is known as the Red Planet?",
        options: ["Earth", "Mars", "Jupiter", "Venus"],
        correctIndex: 1,
        previewDurationMs: 3500,
        answerDurationMs: 12000,
      },
      {
        id: "demo-2",
        text: "What is the capital of Japan?",
        options: ["Kyoto", "Seoul", "Tokyo", "Osaka"],
        correctIndex: 2,
        previewDurationMs: 3500,
        answerDurationMs: 12000,
      },
      {
        id: "demo-3",
        text: "2 + 2 × 2 = ?",
        options: ["6", "8", "4", "10"],
        correctIndex: 0,
        previewDurationMs: 3500,
        answerDurationMs: 12000,
      },
    ];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      this.ctx.storage.sql.exec(
        "INSERT INTO quiz_questions(idx, id, text, optionsJson, correctIndex, previewDurationMs, answerDurationMs, imageUrl, pointsMultiplier) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);",
        i,
        q.id,
        q.text,
        JSON.stringify(q.options),
        q.correctIndex,
        q.previewDurationMs,
        q.answerDurationMs,
        null,
        1,
      );
    }
  }

  private async ensureQuizLoaded() {
    if (this.getQuizLength() > 0) return;

    const quizId = this.getQuizId();
    if (!quizId || !this.env.QUIZ_DB) {
      this.loadDefaultQuiz();
      return;
    }

    const questions = await this.env.QUIZ_DB.prepare(
      "SELECT id, position, prompt, timeLimitMs, pointsMultiplier, imageKey FROM questions WHERE quizId = ? ORDER BY position ASC;",
    )
      .bind(quizId)
      .all<{
        id: string;
        position: number;
        prompt: string;
        timeLimitMs: number;
        pointsMultiplier: number;
        imageKey: string | null;
      }>();

    const qRows = questions.results ?? [];
    const questionIds = qRows.map((q) => q.id);

    const optionsByQ = new Map<string, string[]>();
    const answersByQ = new Map<string, number[]>();

    if (questionIds.length > 0) {
      const optRes = await this.env.QUIZ_DB.prepare(
        `SELECT questionId, position, text FROM options WHERE questionId IN (${questionIds.map(() => "?").join(",")}) ORDER BY questionId ASC, position ASC;`,
      )
        .bind(...questionIds)
        .all<{ questionId: string; position: number; text: string }>();

      for (const r of optRes.results ?? []) {
        const arr = optionsByQ.get(r.questionId) ?? [];
        arr[r.position] = r.text;
        optionsByQ.set(r.questionId, arr);
      }

      const ansRes = await this.env.QUIZ_DB.prepare(
        `SELECT questionId, optionPosition FROM answers WHERE questionId IN (${questionIds.map(() => "?").join(",")}) ORDER BY questionId ASC, optionPosition ASC;`,
      )
        .bind(...questionIds)
        .all<{ questionId: string; optionPosition: number }>();

      for (const r of ansRes.results ?? []) {
        const arr = answersByQ.get(r.questionId) ?? [];
        arr.push(r.optionPosition);
        answersByQ.set(r.questionId, arr);
      }
    }

    this.ctx.storage.sql.exec("DELETE FROM quiz_questions;");
    for (let i = 0; i < qRows.length; i++) {
      const q = qRows[i];
      const options = (optionsByQ.get(q.id) ?? []).filter(Boolean);
      const correctIndices = answersByQ.get(q.id) ?? [];
      const correctIndex = correctIndices[0] ?? 0;
      const imageUrl = q.imageKey ? `/api/questions/${q.id}/image` : null;
      this.ctx.storage.sql.exec(
        "INSERT INTO quiz_questions(idx, id, text, optionsJson, correctIndex, previewDurationMs, answerDurationMs, imageUrl, pointsMultiplier) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);",
        i,
        q.id,
        q.prompt,
        JSON.stringify(options),
        correctIndex,
        5000,
        q.timeLimitMs,
        imageUrl,
        q.pointsMultiplier,
      );
    }
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
        const quizId = typeof obj.quizId === "string" ? obj.quizId : null;
        const pin = typeof obj.pin === "string" ? obj.pin : "";
        if (!hostToken) return new Response(null, { status: 400 });

        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO members(token, role, name, joinedAtMs) VALUES(?, 'host', 'Host', ?);",
          hostToken,
          Date.now(),
        );

        this.ctx.storage.sql.exec(
          "UPDATE quiz_config SET quizId = ? WHERE id = 1;",
          quizId,
        );

        if (/^[0-9]{6}$/.test(pin)) {
          this.setPin(pin);
        }
        this.clearIdleCleanup();
        await this.updateAlarm();

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
        const pin = typeof obj.pin === "string" ? obj.pin : "";
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

        if (/^[0-9]{6}$/.test(pin)) {
          this.setPin(pin);
        }
        this.clearIdleCleanup();
        await this.updateAlarm();

        log("info", "room.join", { reqId });
        const lobby = await this.getLobbyState();
        await this.broadcastLobbyState(lobby);
        await this.broadcastGameState();
        return new Response(JSON.stringify(lobby), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname === "/leave") {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });

        const body = await request.json().catch(() => null);
        const obj: Record<string, unknown> =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const token = typeof obj.token === "string" ? obj.token : "";
        const role = typeof obj.role === "string" ? obj.role : "";
        const pin = typeof obj.pin === "string" ? obj.pin : "";
        if (!token) return new Response(null, { status: 400 });
        if (role !== "host" && role !== "player")
          return new Response(null, { status: 400 });
        if (/^[0-9]{6}$/.test(pin)) {
          this.setPin(pin);
        }

        this.ctx.storage.sql.exec(
          "DELETE FROM members WHERE token = ? AND role = ?;",
          token,
          role,
        );
        this.ctx.storage.sql.exec("DELETE FROM scores WHERE token = ?;", token);
        this.ctx.storage.sql.exec(
          "DELETE FROM answers WHERE token = ?;",
          token,
        );

        for (const ws of this.ctx.getWebSockets()) {
          try {
            for (const tag of this.ctx.getTags(ws)) {
              if (tag === token) {
                ws.close(1000, "leave");
              }
            }
          } catch {
            void 0;
          }
        }

        await this.broadcastLobbyState();
        await this.broadcastGameState();
        await this.scheduleIdleCleanupIfEmpty();
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/end") {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });

        const body = await request.json().catch(() => null);
        const obj: Record<string, unknown> =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const hostToken =
          typeof obj.hostToken === "string" ? obj.hostToken : "";
        const pin = typeof obj.pin === "string" ? obj.pin : "";
        if (!hostToken) return new Response(null, { status: 400 });
        if (/^[0-9]{6}$/.test(pin)) {
          this.setPin(pin);
        }

        const r = await this.getRoleHintFromToken(hostToken);
        if (r !== "host") return new Response(null, { status: 403 });

        log("info", "room.end", { reqId });
        await this.cleanupRoom("room_ended");
        return new Response(null, { status: 204 });
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

    log("info", "room.ws.connect", { reqId, hasHost, hasPlayer, roleHint });

    this.clearIdleCleanup();
    await this.updateAlarm();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (token) this.ctx.acceptWebSocket(server, [token]);
    else this.ctx.acceptWebSocket(server);

    this.ctx.waitUntil(
      (async () => {
        try {
          server.send(JSON.stringify({ type: "connected", v: 1, roleHint }));
        } catch {
          return;
        }

        const lobby = await this.getLobbyState();
        try {
          server.send(JSON.stringify(lobby));
        } catch {
          // ignore
        }

        const gameState = this.getGameState();
        try {
          server.send(JSON.stringify(gameState));
        } catch {
          // ignore
        }

        await this.broadcastLobbyState(lobby);
        await this.broadcastGameState(gameState);
      })(),
    );

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

    this.clearIdleCleanup();
    await this.updateAlarm();

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
      if (role !== "host") {
        log("warn", "room.host_start_game.ignored", {
          reason: "not_host",
          role,
        });
        return;
      }
      const game = this.getGameRow();
      if (game.phase !== "lobby") {
        log("warn", "room.host_start_game.ignored", {
          reason: "not_in_lobby",
          phase: game.phase,
        });
        return;
      }

      await this.ensureQuizLoaded();
      if (this.getQuizLength() < 1) {
        log("error", "room.host_start_game.ignored", {
          reason: "no_questions_loaded",
          quizId: this.getQuizId(),
        });
        return;
      }

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
        if (nextIndex >= this.getQuizLength()) {
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
      const q = this.getQuizQuestion(game.questionIndex);
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
        correct === 1
          ? Math.round(1000 * q.pointsMultiplier * (0.3 + 0.7 * timeFactor))
          : 0;

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
    await this.scheduleIdleCleanupIfEmpty();
  }

  async alarm() {
    const game = this.getGameRow();
    const now = Date.now();

    const idleAt = this.getIdleCleanupAtMs();
    if (idleAt != null && now >= idleAt) {
      if (this.ctx.getWebSockets().length < 1) {
        log("info", "room.cleanup.idle", { reason: "idle" });
        await this.cleanupRoom("room_idle");
        return;
      }
      this.clearIdleCleanup();
      await this.updateAlarm();
    }

    if (game.phaseEndsAtMs != null && now < game.phaseEndsAtMs) {
      await this.updateAlarm();
      return;
    }

    if (this.getQuizLength() < 1) {
      await this.ensureQuizLoaded();
    }

    if (game.phase === "countdown") {
      const q = this.getQuizQuestion(game.questionIndex);
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
      const q = this.getQuizQuestion(game.questionIndex);
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

    await this.updateAlarm();
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
    const q = this.getQuizQuestion(game.questionIndex);
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
      return { ...base, question: { text: q.text }, imageUrl: q.imageUrl };
    }

    if (game.phase === "answering") {
      return {
        ...base,
        question: { text: q.text, options: q.options },
        imageUrl: q.imageUrl,
      };
    }

    if (game.phase === "reveal") {
      return {
        ...base,
        question: { text: q.text, options: q.options },
        reveal: { correctIndex: q.correctIndex },
        imageUrl: q.imageUrl,
      };
    }

    if (game.phase === "scoreboard" || game.phase === "finished") {
      return {
        ...base,
        question: { text: q.text, options: q.options },
        reveal: { correctIndex: q.correctIndex },
        imageUrl: q.imageUrl,
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

    await this.updateAlarm();
  }
}
