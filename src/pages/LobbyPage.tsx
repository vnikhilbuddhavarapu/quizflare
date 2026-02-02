import type { LobbyMember } from "../types";
import { Button } from "../ui/Button";

type Props = {
  pin: string;
  roleHint: string | null;
  members: LobbyMember[];
  wsStatus: string;
  onLeave?: () => void;
};

export function LobbyPage({ pin, roleHint, members, wsStatus, onLeave }: Props) {
  return (
    <section className="panel">
      <div className="row">
        <div className="meta">
          <div>
            <span className="metaKey">PIN:</span> <span className="mono">{pin}</span>
          </div>
          <div>
            <span className="metaKey">Role:</span> <span className="mono">{roleHint ?? "null"}</span>
          </div>
          <div>
            <span className="metaKey">WS:</span> <span className="mono">{wsStatus}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {roleHint === "player" && onLeave ? (
            <Button variant="ghost" onClick={onLeave}>
              Leave
            </Button>
          ) : null}
          <div className="pill">
            {wsStatus === "connected"
              ? "Connected"
              : wsStatus === "connecting"
                ? "Connecting…"
                : "Reconnecting…"}
          </div>
        </div>
      </div>
      <div className="panelTitle">Lobby</div>
      <div className="lobbyList">
        {members.map((m, idx) => (
          <div key={idx} className="lobbyRow">
            <span className="mono">{m.connected ? "●" : "○"}</span>
            <span className="lobbyName">{m.name}</span>
            <span className="muted">{m.role}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
