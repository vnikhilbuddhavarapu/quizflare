export function getRequestId(request: Request) {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}
