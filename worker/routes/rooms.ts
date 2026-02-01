import type { Env } from "../env";
import { json, methodNotAllowed } from "../shared/http";
import { makeSetCookie } from "../shared/cookies";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";

export async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const reqId = getRequestId(request);
  const pinRegistryId = env.PIN_REGISTRY_DO.idFromName("global");
  const pinRegistry = env.PIN_REGISTRY_DO.get(pinRegistryId);

  const allocResp = await pinRegistry.fetch("http://do/allocate", { method: "POST" });
  if (!allocResp.ok) {
    log("error", "room.create.pin_alloc_failed", { reqId, status: allocResp.status });
    return json({ error: { code: "pin_alloc_failed" } }, { status: 502 });
  }

  const { pin } = (await allocResp.json()) as { pin: string };

  const hostToken = crypto.randomUUID();
  const isHttps = new URL(request.url).protocol === "https:";

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
