import { AppShell } from "./AppShell";
import { LandingPage } from "../pages/LandingPage";
import { LobbyPage } from "../pages/LobbyPage";
import { HostLobbyPanel } from "../pages/HostLobbyPanel";
import { GamePage } from "../pages/GamePage";
import { LogPanel } from "../ui/LogPanel";
import { useRoomController } from "../state/useRoomController";

export function AppRoot() {
  const c = useRoomController();
  const showLobby = Boolean(c.lobby);
  const gamePhase = c.game?.phase ?? null;
  const inGame = Boolean(c.game && gamePhase && gamePhase !== "lobby");
  const locked = c.game?.locked ?? false;
  const isHost = c.roleHint === "host";
  const wsConnected = c.wsStatus === "connected";

  return (
    <AppShell title="Quizflare" subtitle="Milestone 2: Quiz loop (hardcoded)" badge="local">
      {inGame && c.game ? (
        <GamePage
          roleHint={c.roleHint}
          game={c.game}
          onHostNext={c.hostNext}
          onSubmitAnswer={c.submitAnswer}
        />
      ) : showLobby ? (
        <>
          {isHost && gamePhase === "lobby" ? (
            <HostLobbyPanel
              locked={locked}
              wsConnected={wsConnected}
              onToggleLock={() => c.hostLockRoom(!locked)}
              onStartGame={c.hostStartGame}
            />
          ) : null}
          <LobbyPage
            pin={c.pin}
            roleHint={c.roleHint}
            members={c.lobby?.members ?? []}
            wsStatus={c.wsStatus}
            onConnectWs={c.connectWs}
            onDisconnectWs={c.disconnectWs}
          />
        </>
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
