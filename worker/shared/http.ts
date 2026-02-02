export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function methodNotAllowed(allowed: string[]) {
  return new Response(null, {
    status: 405,
    headers: { Allow: allowed.join(", ") },
  });
}

export function notFound() {
  return new Response(null, { status: 404 });
}

export function badRequest(message: string) {
  return json({ error: { code: "bad_request", message } }, { status: 400 });
}

export function forbidden() {
  return json({ error: { code: "forbidden" } }, { status: 403 });
}
