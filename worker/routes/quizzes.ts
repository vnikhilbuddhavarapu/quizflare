import type { Env } from "../env";
import { parseCookies, makeSetCookie } from "../shared/cookies";
import {
  badRequest,
  forbidden,
  json,
  methodNotAllowed,
  notFound,
} from "../shared/http";
import { sha256Hex } from "../shared/hash";

function getOrCreateCreator(request: Request) {
  const isHttps = new URL(request.url).protocol === "https:";
  const cookies = parseCookies(request.headers.get("Cookie"));
  const existing = cookies.qf_creator;
  if (existing) return { creator: existing, setCookie: null as string | null };

  const creator = crypto.randomUUID();
  const setCookie = makeSetCookie("qf_creator", creator, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 60 * 60 * 24 * 180,
  });
  return { creator, setCookie };
}

async function requireOwnerKey(request: Request): Promise<string | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const creator = cookies.qf_creator;
  if (!creator) return null;
  return sha256Hex(creator);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type QuestionType = "true_false" | "single_choice" | "multi_select";

function isQuestionType(v: unknown): v is QuestionType {
  return v === "true_false" || v === "single_choice" || v === "multi_select";
}

function defaultOptions(type: QuestionType): string[] {
  if (type === "true_false") return ["True", "False"];
  return ["Option A", "Option B", "Option C", "Option D"];
}

function imageExtFromMime(mime: string): string | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

async function isOwner(
  env: Env,
  quizId: string,
  ownerKey: string,
): Promise<boolean> {
  if (!env.QUIZ_DB) return false;
  const row = await env.QUIZ_DB.prepare(
    "SELECT id FROM quizzes WHERE id = ? AND ownerKey = ? LIMIT 1;",
  )
    .bind(quizId, ownerKey)
    .first();
  return Boolean(row);
}

export async function handleCreatorInit(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const { setCookie } = getOrCreateCreator(request);
  const headers = new Headers();
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 204, headers });
}

export async function handleQuizzes(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.QUIZ_DB)
    return json({ error: { code: "not_configured" } }, { status: 501 });

  if (request.method === "POST") {
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

    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title || title.length > 80) return badRequest("invalid_title");

    const { creator, setCookie } = getOrCreateCreator(request);
    const ownerKey = await sha256Hex(creator);
    const id = crypto.randomUUID();
    const now = Date.now();

    await env.QUIZ_DB.prepare(
      "INSERT INTO quizzes(id, title, ownerKey, createdAtMs, updatedAtMs) VALUES(?, ?, ?, ?, ?);",
    )
      .bind(id, title, ownerKey, now, now)
      .run();

    const headers = new Headers();
    if (setCookie) headers.append("Set-Cookie", setCookie);

    return json({ id, title }, { status: 201, headers });
  }

  if (request.method !== "GET") return methodNotAllowed(["GET", "POST"]);

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "mine";

  if (scope !== "mine") return badRequest("unsupported_scope");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const creator = cookies.qf_creator;
  if (!creator) return json({ quizzes: [] });

  const ownerKey = await sha256Hex(creator);
  const rows = await env.QUIZ_DB.prepare(
    "SELECT id, title, createdAtMs, updatedAtMs FROM quizzes WHERE ownerKey = ? ORDER BY updatedAtMs DESC LIMIT 100;",
  )
    .bind(ownerKey)
    .all();

  return json({ quizzes: rows.results ?? [] });
}

export async function handleQuizById(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!env.QUIZ_DB)
    return json({ error: { code: "not_configured" } }, { status: 501 });

  if (request.method === "PUT") {
    const ownerKey = await requireOwnerKey(request);
    if (!ownerKey) return forbidden();
    if (!(await isOwner(env, id, ownerKey))) return forbidden();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("invalid_json");
    }

    const obj = isObject(body) ? body : {};
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title || title.length > 80) return badRequest("invalid_title");

    const now = Date.now();
    await env.QUIZ_DB.prepare(
      "UPDATE quizzes SET title = ?, updatedAtMs = ? WHERE id = ?;",
    )
      .bind(title, now, id)
      .run();

    return new Response(null, { status: 204 });
  }

  if (request.method !== "GET") return methodNotAllowed(["GET", "PUT"]);

  const quiz = await env.QUIZ_DB.prepare(
    "SELECT id, title, createdAtMs, updatedAtMs FROM quizzes WHERE id = ? LIMIT 1;",
  )
    .bind(id)
    .first();

  if (!quiz) return notFound();

  const questions = await env.QUIZ_DB.prepare(
    "SELECT id, quizId, position, type, prompt, timeLimitMs, pointsMultiplier, imageKey, createdAtMs, updatedAtMs FROM questions WHERE quizId = ? ORDER BY position ASC;",
  )
    .bind(id)
    .all();

  const qRows = (questions.results ?? []) as Array<{
    id: string;
    type: string;
    position: number;
    prompt: string;
    timeLimitMs: number;
    pointsMultiplier: number;
    imageKey: string | null;
  }>;

  const questionIds = qRows.map((q) => q.id);
  const optionsByQ = new Map<
    string,
    Array<{ position: number; text: string }>
  >();
  const answersByQ = new Map<string, number[]>();

  if (questionIds.length > 0) {
    const optRes = await env.QUIZ_DB.prepare(
      `SELECT questionId, position, text FROM options WHERE questionId IN (${questionIds.map(() => "?").join(",")}) ORDER BY questionId ASC, position ASC;`,
    )
      .bind(...questionIds)
      .all<{ questionId: string; position: number; text: string }>();

    for (const r of optRes.results ?? []) {
      const arr = optionsByQ.get(r.questionId) ?? [];
      arr.push({ position: r.position, text: r.text });
      optionsByQ.set(r.questionId, arr);
    }

    const ansRes = await env.QUIZ_DB.prepare(
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

  const fullQuestions = qRows.map((q) => ({
    id: q.id,
    position: q.position,
    type: q.type,
    prompt: q.prompt,
    timeLimitMs: q.timeLimitMs,
    pointsMultiplier: q.pointsMultiplier,
    imageKey: q.imageKey,
    options: (optionsByQ.get(q.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((o) => o.text),
    correctIndices: answersByQ.get(q.id) ?? [],
  }));

  return json({ quiz, questions: fullQuestions });
}

export async function handleQuizAddQuestion(
  request: Request,
  env: Env,
  quizId: string,
): Promise<Response> {
  if (!env.QUIZ_DB)
    return json({ error: { code: "not_configured" } }, { status: 501 });
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const ownerKey = await requireOwnerKey(request);
  if (!ownerKey) return forbidden();
  if (!(await isOwner(env, quizId, ownerKey))) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }

  const obj = isObject(body) ? body : {};
  const typeRaw = obj.type;
  const type: QuestionType = isQuestionType(typeRaw)
    ? typeRaw
    : "single_choice";
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";

  const timeLimitMsRaw =
    typeof obj.timeLimitMs === "number" ? obj.timeLimitMs : 20000;
  const timeLimitMs = Math.max(
    5000,
    Math.min(120000, Math.floor(timeLimitMsRaw)),
  );

  const pointsMultiplierRaw =
    typeof obj.pointsMultiplier === "number" ? obj.pointsMultiplier : 1;
  const pointsMultiplier = pointsMultiplierRaw === 2 ? 2 : 1;

  const qid = crypto.randomUUID();
  const now = Date.now();

  const posRow = await env.QUIZ_DB.prepare(
    "SELECT COALESCE(MAX(position) + 1, 0) as nextPos FROM questions WHERE quizId = ?;",
  )
    .bind(quizId)
    .first<{ nextPos: number }>();

  const nextPos = posRow?.nextPos ?? 0;

  await env.QUIZ_DB.batch([
    env.QUIZ_DB.prepare(
      "INSERT INTO questions(id, quizId, position, type, prompt, timeLimitMs, pointsMultiplier, imageKey, createdAtMs, updatedAtMs) VALUES(?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);",
    ).bind(
      qid,
      quizId,
      nextPos,
      type,
      prompt || "New question",
      timeLimitMs,
      pointsMultiplier,
      now,
      now,
    ),
    env.QUIZ_DB.prepare(
      "UPDATE quizzes SET updatedAtMs = ? WHERE id = ?;",
    ).bind(now, quizId),
  ]);

  const opts = defaultOptions(type);
  const optStmts = opts.map((text, idx) =>
    env
      .QUIZ_DB!.prepare(
        "INSERT INTO options(id, questionId, position, text) VALUES(?, ?, ?, ?);",
      )
      .bind(crypto.randomUUID(), qid, idx, text),
  );

  const ansStmts = [
    env.QUIZ_DB.prepare(
      "INSERT INTO answers(questionId, optionPosition) VALUES(?, ?);",
    ).bind(qid, 0),
  ];

  await env.QUIZ_DB.batch([...optStmts, ...ansStmts]);

  return json({ questionId: qid }, { status: 201 });
}

export async function handleQuizReorder(
  request: Request,
  env: Env,
  quizId: string,
): Promise<Response> {
  if (!env.QUIZ_DB)
    return json({ error: { code: "not_configured" } }, { status: 501 });
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const ownerKey = await requireOwnerKey(request);
  if (!ownerKey) return forbidden();
  if (!(await isOwner(env, quizId, ownerKey))) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }

  const obj = isObject(body) ? body : {};
  const ids = Array.isArray(obj.questionIds) ? obj.questionIds : [];
  const questionIds = ids.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (questionIds.length < 1) return badRequest("invalid_questionIds");

  const existing = await env.QUIZ_DB.prepare(
    "SELECT id FROM questions WHERE quizId = ?;",
  )
    .bind(quizId)
    .all<{ id: string }>();

  const existingSet = new Set((existing.results ?? []).map((r) => r.id));
  if (existingSet.size !== questionIds.length)
    return badRequest("question_count_mismatch");
  for (const id of questionIds) {
    if (!existingSet.has(id)) return badRequest("unknown_question");
  }

  const now = Date.now();
  const stmts = questionIds.map((id, idx) =>
    env
      .QUIZ_DB!.prepare(
        "UPDATE questions SET position = ?, updatedAtMs = ? WHERE id = ? AND quizId = ?;",
      )
      .bind(idx, now, id, quizId),
  );
  stmts.push(
    env.QUIZ_DB.prepare(
      "UPDATE quizzes SET updatedAtMs = ? WHERE id = ?;",
    ).bind(now, quizId),
  );
  await env.QUIZ_DB.batch(stmts);

  return new Response(null, { status: 204 });
}

export async function handleQuestionImage(
  request: Request,
  env: Env,
  questionId: string,
): Promise<Response> {
  if (!env.QUIZ_DB || !env.QUIZ_IMAGES)
    return json({ error: { code: "not_configured" } }, { status: 501 });

  const row = await env.QUIZ_DB.prepare(
    "SELECT id, quizId, imageKey FROM questions WHERE id = ? LIMIT 1;",
  )
    .bind(questionId)
    .first<{ id: string; quizId: string; imageKey: string | null }>();

  if (!row) return notFound();

  if (request.method === "GET" || request.method === "HEAD") {
    if (!row.imageKey) return notFound();
    const obj = await env.QUIZ_IMAGES.get(row.imageKey);
    if (!obj) return notFound();

    const headers = new Headers();
    headers.set(
      "Content-Type",
      obj.httpMetadata?.contentType ?? "application/octet-stream",
    );
    headers.set("Cache-Control", "public, max-age=3600");
    if (obj.etag) headers.set("ETag", obj.etag);
    if (request.method === "HEAD")
      return new Response(null, { status: 200, headers });
    return new Response(obj.body, { status: 200, headers });
  }

  if (request.method === "DELETE") {
    const ownerKey = await requireOwnerKey(request);
    if (!ownerKey) return forbidden();
    if (!(await isOwner(env, row.quizId, ownerKey))) return forbidden();
    if (!row.imageKey) return new Response(null, { status: 204 });

    const now = Date.now();
    await env.QUIZ_DB.batch([
      env.QUIZ_DB.prepare(
        "UPDATE questions SET imageKey = NULL, updatedAtMs = ? WHERE id = ?;",
      ).bind(now, questionId),
      env.QUIZ_DB.prepare(
        "UPDATE quizzes SET updatedAtMs = ? WHERE id = ?;",
      ).bind(now, row.quizId),
    ]);
    await env.QUIZ_IMAGES.delete(row.imageKey);
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST")
    return methodNotAllowed(["GET", "HEAD", "POST", "DELETE"]);

  const ownerKey = await requireOwnerKey(request);
  if (!ownerKey) return forbidden();
  if (!(await isOwner(env, row.quizId, ownerKey))) return forbidden();

  const ct = request.headers.get("Content-Type") ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data"))
    return badRequest("expected_multipart");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("invalid_multipart");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("missing_file");

  if (file.size <= 0) return badRequest("invalid_file");
  if (file.size > 5_000_000) return badRequest("image_too_large");

  const ext = imageExtFromMime(file.type);
  if (!ext) return badRequest("unsupported_image_type");

  const key = `question-images/${questionId}/${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();
  await env.QUIZ_IMAGES.put(key, bytes, {
    httpMetadata: { contentType: file.type },
  });

  const now = Date.now();
  await env.QUIZ_DB.batch([
    env.QUIZ_DB.prepare(
      "UPDATE questions SET imageKey = ?, updatedAtMs = ? WHERE id = ?;",
    ).bind(key, now, questionId),
    env.QUIZ_DB.prepare(
      "UPDATE quizzes SET updatedAtMs = ? WHERE id = ?;",
    ).bind(now, row.quizId),
  ]);

  if (row.imageKey && row.imageKey !== key) {
    await env.QUIZ_IMAGES.delete(row.imageKey);
  }

  return json({ imageKey: key }, { status: 201 });
}

export async function handleQuestionById(
  request: Request,
  env: Env,
  questionId: string,
): Promise<Response> {
  if (!env.QUIZ_DB)
    return json({ error: { code: "not_configured" } }, { status: 501 });
  if (request.method !== "PUT") return methodNotAllowed(["PUT"]);

  const ownerKey = await requireOwnerKey(request);
  if (!ownerKey) return forbidden();

  const qRow = await env.QUIZ_DB.prepare(
    "SELECT id, quizId FROM questions WHERE id = ? LIMIT 1;",
  )
    .bind(questionId)
    .first<{ id: string; quizId: string }>();
  if (!qRow) return notFound();
  if (!(await isOwner(env, qRow.quizId, ownerKey))) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }

  const obj = isObject(body) ? body : {};
  const typeRaw = obj.type;
  if (!isQuestionType(typeRaw)) return badRequest("invalid_type");
  const type: QuestionType = typeRaw;
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  if (!prompt || prompt.length > 300) return badRequest("invalid_prompt");

  const timeLimitMsRaw =
    typeof obj.timeLimitMs === "number" ? obj.timeLimitMs : 20000;
  const timeLimitMs = Math.max(
    5000,
    Math.min(120000, Math.floor(timeLimitMsRaw)),
  );

  const pointsMultiplierRaw =
    typeof obj.pointsMultiplier === "number" ? obj.pointsMultiplier : 1;
  const pointsMultiplier = pointsMultiplierRaw === 2 ? 2 : 1;

  const optionsRaw = Array.isArray(obj.options) ? obj.options : null;
  const options = (optionsRaw ?? [])
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (type === "true_false") {
    if (options.length !== 2) return badRequest("invalid_options");
  } else {
    if (options.length < 2 || options.length > 6)
      return badRequest("invalid_options");
  }

  const correctRaw = Array.isArray(obj.correctIndices)
    ? obj.correctIndices
    : [];
  const correctIndices = correctRaw
    .filter((x): x is number => typeof x === "number" && Number.isInteger(x))
    .map((n) => n as number);
  if (type === "multi_select") {
    if (correctIndices.length < 1) return badRequest("invalid_correct");
  } else {
    if (correctIndices.length !== 1) return badRequest("invalid_correct");
  }
  for (const idx of correctIndices) {
    if (idx < 0 || idx >= options.length) return badRequest("invalid_correct");
  }

  const now = Date.now();
  await env.QUIZ_DB.batch([
    env.QUIZ_DB.prepare(
      "UPDATE questions SET type = ?, prompt = ?, timeLimitMs = ?, pointsMultiplier = ?, updatedAtMs = ? WHERE id = ?;",
    ).bind(type, prompt, timeLimitMs, pointsMultiplier, now, questionId),
    env.QUIZ_DB.prepare("DELETE FROM options WHERE questionId = ?;").bind(
      questionId,
    ),
    env.QUIZ_DB.prepare("DELETE FROM answers WHERE questionId = ?;").bind(
      questionId,
    ),
  ]);

  const optStmts = options.map((text, idx) =>
    env
      .QUIZ_DB!.prepare(
        "INSERT INTO options(id, questionId, position, text) VALUES(?, ?, ?, ?);",
      )
      .bind(crypto.randomUUID(), questionId, idx, text),
  );

  const ansStmts = correctIndices.map((idx) =>
    env
      .QUIZ_DB!.prepare(
        "INSERT INTO answers(questionId, optionPosition) VALUES(?, ?);",
      )
      .bind(questionId, idx),
  );

  await env.QUIZ_DB.batch([
    ...optStmts,
    ...ansStmts,
    env.QUIZ_DB.prepare(
      "UPDATE quizzes SET updatedAtMs = ? WHERE id = ?;",
    ).bind(now, qRow.quizId),
  ]);

  return new Response(null, { status: 204 });
}
