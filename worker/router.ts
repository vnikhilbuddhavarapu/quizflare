import type { Env } from "./env";
import { notFound } from "./shared/http";
import {
  handleCreateRoom,
  handleEndRoom,
  handleJoinRoom,
  handleLeaveRoom,
} from "./routes/rooms";
import {
  handleCreatorInit,
  handleQuestionById,
  handleQuestionImage,
  handleQuizAddQuestion,
  handleQuizById,
  handleQuizReorder,
  handleQuizzes,
} from "./routes/quizzes";
import { handleRoomWebSocket } from "./routes/ws";

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/rooms/create") {
    return handleCreateRoom(request, env);
  }

  if (url.pathname === "/api/rooms/leave") {
    return handleLeaveRoom(request, env);
  }

  if (url.pathname === "/api/rooms/end") {
    return handleEndRoom(request, env);
  }

  if (url.pathname === "/api/rooms/join") {
    return handleJoinRoom(request, env);
  }

  if (url.pathname === "/api/creator/init") {
    return handleCreatorInit(request);
  }

  if (url.pathname === "/api/quizzes") {
    return handleQuizzes(request, env);
  }

  const quizPrefix = "/api/quizzes/";
  if (url.pathname.startsWith(quizPrefix)) {
    const rest = url.pathname.slice(quizPrefix.length);
    const parts = rest.split("/").filter(Boolean);
    const quizId = parts[0] ?? "";
    const action = parts[1] ?? "";
    if (!quizId) return notFound();
    if (!action) return handleQuizById(request, env, quizId);
    if (action === "questions")
      return handleQuizAddQuestion(request, env, quizId);
    if (action === "reorder") return handleQuizReorder(request, env, quizId);
    return notFound();
  }

  const questionPrefix = "/api/questions/";
  if (url.pathname.startsWith(questionPrefix)) {
    const rest = url.pathname.slice(questionPrefix.length);
    const parts = rest.split("/").filter(Boolean);
    const questionId = parts[0] ?? "";
    const action = parts[1] ?? "";
    if (!questionId) return notFound();
    if (!action) return handleQuestionById(request, env, questionId);
    if (action === "image")
      return handleQuestionImage(request, env, questionId);
    return notFound();
  }

  const wsPrefix = "/ws/room/";
  if (url.pathname.startsWith(wsPrefix)) {
    const pin = url.pathname.slice(wsPrefix.length);
    return handleRoomWebSocket(request, env, pin);
  }

  return notFound();
}
