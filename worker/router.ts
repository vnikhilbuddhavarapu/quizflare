import type { Env } from "./env";
import { notFound } from "./shared/http";
import { handleCreateRoom, handleJoinRoom } from "./routes/rooms";
import { handleRoomWebSocket } from "./routes/ws";

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/rooms/create") {
    return handleCreateRoom(request, env);
  }

  if (url.pathname === "/api/rooms/join") {
    return handleJoinRoom(request, env);
  }

  const wsPrefix = "/ws/room/";
  if (url.pathname.startsWith(wsPrefix)) {
    const pin = url.pathname.slice(wsPrefix.length);
    return handleRoomWebSocket(request, env, pin);
  }

  return notFound();
}
