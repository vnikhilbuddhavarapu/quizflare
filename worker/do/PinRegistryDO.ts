import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { json, methodNotAllowed } from "../shared/http";
import { log } from "../shared/log";
import { getRequestId } from "../shared/requestId";

export class PinRegistryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS pins (pin TEXT PRIMARY KEY, createdAtMs INTEGER NOT NULL);",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const reqId = getRequestId(request);
    const url = new URL(request.url);

    if (url.pathname === "/allocate") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const pin = await this.allocatePin();
      log("info", "pin.allocate", { reqId, pin });
      return json({ pin });
    }

    return new Response(null, { status: 404 });
  }

  private async allocatePin() {
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i++) {
      const pin = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      try {
        this.ctx.storage.sql.exec(
          "INSERT INTO pins(pin, createdAtMs) VALUES(?, ?);",
          pin,
          Date.now(),
        );
        return pin;
      } catch {
        // collision, retry
      }
    }
    throw new Error("unable_to_allocate_pin");
  }
}
