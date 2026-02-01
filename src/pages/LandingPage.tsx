import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

type Props = {
  pin: string;
  setPin: (pin: string) => void;
  name: string;
  setName: (name: string) => void;
  creating: boolean;
  joining: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onConnectWs: () => void;
  onDisconnectWs: () => void;
  wsStatus: string;
};

export function LandingPage({
  pin,
  setPin,
  name,
  setName,
  creating,
  joining,
  onCreate,
  onJoin,
  onConnectWs,
  onDisconnectWs,
  wsStatus,
}: Props) {
  return (
    <section className="panel">
      <div className="row">
        <Button onClick={onCreate} disabled={creating}>
          {creating ? "Creating…" : "Create room"}
        </Button>
        <TextInput label="Room PIN" value={pin} onChange={setPin} placeholder="000000" inputMode="numeric" maxLength={6} />
        <TextInput label="Name" value={name} onChange={setName} placeholder="Your name" />
        <Button variant="secondary" onClick={onJoin} disabled={joining || !pin.trim() || !name.trim()}>
          {joining ? "Joining…" : "Join"}
        </Button>
        <Button variant="secondary" onClick={onConnectWs} disabled={wsStatus !== "disconnected" || !pin.trim()}>
          Connect WS
        </Button>
        <Button variant="ghost" onClick={onDisconnectWs} disabled={wsStatus === "disconnected"}>
          Disconnect
        </Button>
      </div>
    </section>
  );
}
