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

export type ConnectedMsg = {
  type: "connected";
  v: 1;
  roleHint: RoleHint;
};

export type ServerMsg = LobbyState | ConnectedMsg | Record<string, unknown>;
