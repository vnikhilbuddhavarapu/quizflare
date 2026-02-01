import type { Env } from "../env";
import { json, methodNotAllowed } from "../shared/http";
import { makeSetCookie } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";
import { isValidPin } from "../shared/pins";

export async function handleCreateRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

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
    body: JSON.stringify({ hostToken }),
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
    body: JSON.stringify({ playerToken, name }),
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
