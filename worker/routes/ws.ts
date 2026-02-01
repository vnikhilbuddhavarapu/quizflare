import type { Env } from "../env";
import { badRequest, methodNotAllowed } from "../shared/http";
import { isValidPin } from "../shared/pins";

export async function handleRoomWebSocket(request: Request, env: Env, pin: string) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);

  const upgrade = request.headers.get("Upgrade");
  if (upgrade !== "websocket") return badRequest("expected websocket upgrade");

  if (!isValidPin(pin)) return badRequest("invalid pin");

  const id = env.ROOM_DO.idFromName(`room:${pin}`);
  const stub = env.ROOM_DO.get(id);
  return stub.fetch(request);
}
