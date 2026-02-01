import { AppShell } from "./AppShell";
import { LandingPage } from "../pages/LandingPage";
import { LobbyPage } from "../pages/LobbyPage";
import { LogPanel } from "../ui/LogPanel";
import { useRoomController } from "../state/useRoomController";

export function AppRoot() {
  const c = useRoomController();
  const showLobby = Boolean(c.lobby);

  return (
    <AppShell title="Quizflare" subtitle="Milestone 1: Lobby + join + live updates" badge="local">
      {showLobby ? (
        <LobbyPage
          pin={c.pin}
          roleHint={c.roleHint}
          members={c.lobby?.members ?? []}
          wsStatus={c.wsStatus}
          onConnectWs={c.connectWs}
          onDisconnectWs={c.disconnectWs}
        />
      ) : (
        <LandingPage
          pin={c.pin}
          setPin={c.setPin}
          name={c.name}
          setName={c.setName}
          creating={c.creating}
          joining={c.joining}
          onCreate={c.createRoom}
          onJoin={c.joinRoom}
          onConnectWs={c.connectWs}
          onDisconnectWs={c.disconnectWs}
          wsStatus={c.wsStatus}
        />
      )}

      <section className="panel">
        <div className="meta">
          <div>
            <span className="metaKey">WS:</span> <span className="mono">{c.wsStatus}</span>
          </div>
          <div>
            <span className="metaKey">Role hint:</span> <span className="mono">{c.roleHint ?? "null"}</span>
          </div>
          <div>
            <span className="metaKey">WS URL:</span> <span className="mono">{c.wsUrl || "-"}</span>
          </div>
        </div>
      </section>

      <LogPanel lines={c.logs} />
    </AppShell>
  );
}
