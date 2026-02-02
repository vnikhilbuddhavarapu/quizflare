import { Button } from "../ui/Button";

type Props = {
  locked: boolean;
  wsConnected: boolean;
  onToggleLock: () => void;
  onStartGame: () => void;
  onEndRoom: () => void;
};

export function HostLobbyPanel({ locked, wsConnected, onToggleLock, onStartGame, onEndRoom }: Props) {
  return (
    <section className="panel">
      <div className="row">
        <Button variant="secondary" onClick={onToggleLock} disabled={!wsConnected}>
          {locked ? "Unlock room" : "Lock room"}
        </Button>
        <Button onClick={onStartGame} disabled={!wsConnected}>
          Start game
        </Button>
        <Button variant="ghost" onClick={onEndRoom}>
          End room
        </Button>
      </div>
    </section>
  );
}
