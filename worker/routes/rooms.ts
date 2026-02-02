import type { Env } from "../env";
import { badRequest, forbidden, json, methodNotAllowed } from "../shared/http";
import { makeSetCookie, parseCookies } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";
import { isValidPin } from "../shared/pins";
import { sha256Hex } from "../shared/hash";

export async function handleCreateRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  let quizId: string | null = null;
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("invalid_json");
    }

    const obj: Record<string, unknown> =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const candidate = typeof obj.quizId === "string" ? obj.quizId.trim() : "";
    if (candidate) quizId = candidate;
  }

  if (quizId) {
    if (!env.QUIZ_DB)
      return json({ error: { code: "not_configured" } }, { status: 501 });

    const cookies = parseCookies(request.headers.get("Cookie"));
    const creator = cookies.qf_creator;
    if (!creator) return forbidden();
    const ownerKey = await sha256Hex(creator);

    const row = await env.QUIZ_DB.prepare(
      "SELECT id FROM quizzes WHERE id = ? AND ownerKey = ? LIMIT 1;",
    )
      .bind(quizId, ownerKey)
      .first();
    if (!row) return forbidden();
  }

  const reqId = getRequestId(request);
  const pinRegistryId = env.PIN_REGISTRY_DO.idFromName("global");
  const pinRegistry = env.PIN_REGISTRY_DO.get(pinRegistryId);

  const allocResp = await pinRegistry.fetch("http://do/allocate", {
    method: "POST",
  });
  if (!allocResp.ok) {
    log("error", "room.create.pin_alloc_failed", {
      reqId,
      status: allocResp.status,
    });
    return json({ error: { code: "pin_alloc_failed" } }, { status: 502 });
  }

  const { pin } = (await allocResp.json()) as { pin: string };

  const hostToken = crypto.randomUUID();
  const isHttps = new URL(request.url).protocol === "https:";

  const roomId = env.ROOM_DO.idFromName(`room:${pin}`);
  const roomStub = env.ROOM_DO.get(roomId);
  const initResp = await roomStub.fetch("http://do/init-host", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostToken, quizId, pin }),
  });
  if (!initResp.ok) {
    log("error", "room.create.room_init_failed", {
      reqId,
      status: initResp.status,
    });
    return json({ error: { code: "room_init_failed" } }, { status: 502 });
  }

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    makeSetCookie("qf_host", hostToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: 60 * 60 * 6,
    }),
  );

  log("info", "room.create", { reqId, pin });
  return json({ pin }, { headers });
}

export async function handleJoinRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const reqId = getRequestId(request);
  const isHttps = new URL(request.url).protocol === "https:";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: { code: "bad_request", message: "invalid_json" } },
      { status: 400 },
    );
  }

  const obj: Record<string, unknown> =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const pin = typeof obj.pin === "string" ? obj.pin.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";

  if (!isValidPin(pin))
    return json(
      { error: { code: "bad_request", message: "invalid_pin" } },
      { status: 400 },
    );
  if (name.length < 1 || name.length > 20)
    return json(
      { error: { code: "bad_request", message: "invalid_name" } },
      { status: 400 },
    );

  const playerToken = crypto.randomUUID();

  const roomId = env.ROOM_DO.idFromName(`room:${pin}`);
  const roomStub = env.ROOM_DO.get(roomId);
  const joinResp = await roomStub.fetch("http://do/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerToken, name, pin }),
  });

  if (!joinResp.ok) {
    log("warn", "room.join.rejected", { reqId, status: joinResp.status });
    const text = await joinResp.text().catch(() => "");
    return new Response(text || null, {
      status: joinResp.status,
      headers: {
        "Content-Type":
          joinResp.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const joinData = (await joinResp.json()) as unknown;

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    makeSetCookie("qf_player", playerToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: 60 * 60 * 6,
    }),
  );

  log("info", "room.join", { reqId, pin });
  return json(joinData, { headers });
}

export async function handleLeaveRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const obj: Record<string, unknown> =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const pin = typeof obj.pin === "string" ? obj.pin.trim() : "";
  if (!isValidPin(pin)) return badRequest("invalid_pin");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const as = typeof obj.as === "string" ? obj.as : "";
  const token =
    as === "host"
      ? (cookies.qf_host ?? "")
      : as === "player"
        ? (cookies.qf_player ?? "")
        : (cookies.qf_player ?? cookies.qf_host ?? "");
  const role =
    as === "host"
      ? "host"
      : as === "player"
        ? "player"
        : cookies.qf_player
          ? "player"
          : "host";
  if (!token) return forbidden();

  const roomId = env.ROOM_DO.idFromName(`room:${pin}`);
  const roomStub = env.ROOM_DO.get(roomId);
  const resp = await roomStub.fetch("http://do/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, role, pin }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return new Response(text || null, { status: resp.status });
  }

  const isHttps = new URL(request.url).protocol === "https:";
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    makeSetCookie(role === "host" ? "qf_host" : "qf_player", "", {
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: 0,
    }),
  );
  return new Response(null, { status: 204, headers });
}

export async function handleEndRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const obj: Record<string, unknown> =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const pin = typeof obj.pin === "string" ? obj.pin.trim() : "";
  if (!isValidPin(pin)) return badRequest("invalid_pin");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const hostToken = cookies.qf_host ?? "";
  if (!hostToken) return forbidden();

  const roomId = env.ROOM_DO.idFromName(`room:${pin}`);
  const roomStub = env.ROOM_DO.get(roomId);
  const resp = await roomStub.fetch("http://do/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostToken, pin }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return new Response(text || null, { status: resp.status });
  }

  const isHttps = new URL(request.url).protocol === "https:";
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    makeSetCookie("qf_host", "", {
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: 0,
    }),
  );
  return new Response(null, { status: 204, headers });
}
