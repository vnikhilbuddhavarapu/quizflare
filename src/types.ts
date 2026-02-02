export type WsStatus = "disconnected" | "connecting" | "connected";

export type RoleHint = "host" | "player" | null;

export type LobbyMember = {
  role: "host" | "player";
  name: string;
  connected: boolean;
};

export type LobbyState = {
  type: "lobby_state";
  v: 1;
  members: LobbyMember[];
};

export type LeaderboardEntry = {
  name: string;
  role: string;
  score: number;
};

export type GamePhase =
  | "lobby"
  | "countdown"
  | "question_preview"
  | "answering"
  | "reveal"
  | "scoreboard"
  | "finished";

export type GameState = {
  type: "game_state";
  v: 1;
  phase: GamePhase;
  locked: boolean;
  questionIndex: number;
  serverNowMs: number;
  phaseStartedAtMs: number;
  phaseEndsAtMs: number | null;
  question?: { text: string; options?: string[] };
  imageUrl?: string;
  reveal?: { correctIndex: number };
  leaderboard?: LeaderboardEntry[];
  answeredCount?: number;
  playerCount?: number;
};

export type ConnectedMsg = {
  type: "connected";
  v: 1;
  roleHint: RoleHint;
};

export type ServerMsg =
  | LobbyState
  | GameState
  | ConnectedMsg
  | Record<string, unknown>;

export type ClientMsg =
  | { type: "host_lock_room"; v: 1; locked: boolean }
  | { type: "host_start_game"; v: 1 }
  | { type: "host_next"; v: 1 }
  | { type: "answer_submit"; v: 1; choiceIndex: number };
