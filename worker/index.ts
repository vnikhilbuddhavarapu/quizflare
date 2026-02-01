import type { Env } from "./env";
import { RoomDO } from "./do/RoomDO";
import { PinRegistryDO } from "./do/PinRegistryDO";
import { route } from "./router";

export { RoomDO, PinRegistryDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
      return route(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
