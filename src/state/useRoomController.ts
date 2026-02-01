import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMsg,
  ConnectedMsg,
  GameState,
  LobbyState,
  RoleHint,
  WsStatus,
} from "../types";

function nowLine(line: string) {
  return new Date().toLocaleTimeString() + "  " + line;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isConnectedMsg(v: unknown): v is ConnectedMsg {
  return isObject(v) && v.type === "connected" && v.v === 1;
}

function isLobbyState(v: unknown): v is LobbyState {
  return (
    isObject(v) &&
    v.type === "lobby_state" &&
    v.v === 1 &&
    Array.isArray(v.members)
  );
}

function isGameState(v: unknown): v is GameState {
  return (
    isObject(v) &&
    v.type === "game_state" &&
    v.v === 1 &&
    typeof v.phase === "string"
  );
}

export function useRoomController() {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const [roleHint, setRoleHint] = useState<RoleHint>(null);
  const [desiredRole, setDesiredRole] = useState<RoleHint>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const p = pin.trim();
    const qs = desiredRole ? `?as=${encodeURIComponent(desiredRole)}` : "";
    return p ? `${proto}://${host}/ws/room/${p}${qs}` : "";
  }, [pin, desiredRole]);

  function push(line: string) {
    setLogs((prev) => [nowLine(line), ...prev].slice(0, 200));
  }

  async function createRoom() {
    setCreating(true);
    setRoleHint(null);
    setDesiredRole(null);
    setLobby(null);
    setGame(null);
    try {
      const resp = await fetch("/api/rooms/create", { method: "POST" });
      if (!resp.ok) {
        push(`Create room failed: HTTP ${resp.status}`);
        return;
      }
      const data = (await resp.json()) as { pin: string };
      setPin(data.pin);
      setDesiredRole("host");
      push(`Created room pin=${data.pin}. (Host cookie should be set.)`);
    } catch (e) {
      push(`Create room failed: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom() {
    const p = pin.trim();
    const n = name.trim();
    if (!/^[0-9]{6}$/.test(p)) {
      push("Invalid PIN: must be 6 digits");
      return;
    }
    if (!n) {
      push("Name is required");
      return;
    }

    setJoining(true);
    try {
      const resp = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: p, name: n }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        push(`Join failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      const data = (await resp.json()) as unknown;
      if (isLobbyState(data)) {
        setLobby(data);
        setDesiredRole("player");
        push(`Join OK: lobby_state (${data.members.length} members)`);
      } else {
        setDesiredRole("player");
        push("Join OK");
      }
    } catch (e) {
      push(`Join failed: ${String(e)}`);
    } finally {
      setJoining(false);
    }
  }

  function sendWs(msg: ClientMsg) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      push("WS not connected");
      return;
    }
    wsRef.current.send(JSON.stringify(msg));
  }

  function hostLockRoom(locked: boolean) {
    sendWs({ type: "host_lock_room", v: 1, locked });
  }

  function hostStartGame() {
    sendWs({ type: "host_start_game", v: 1 });
  }

  function hostNext() {
    sendWs({ type: "host_next", v: 1 });
  }

  function submitAnswer(choiceIndex: number) {
    sendWs({ type: "answer_submit", v: 1, choiceIndex });
  }

  function connectWs() {
    const p = pin.trim();
    if (!/^[0-9]{6}$/.test(p)) {
      push("Invalid PIN: must be 6 digits");
      return;
    }

    wsRef.current?.close(1000, "reconnect");
    setWsStatus("connecting");
    push(`Connecting WS: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      push("WS open");
    };
    ws.onmessage = (e) => {
      const text = typeof e.data === "string" ? e.data : "[binary]";
      push(`WS message: ${text}`);
      try {
        const msg = JSON.parse(text) as unknown;
        if (isConnectedMsg(msg)) {
          setRoleHint(msg.roleHint);
          if (
            desiredRole == null &&
            (msg.roleHint === "host" || msg.roleHint === "player")
          ) {
            setDesiredRole(msg.roleHint);
          }
        }
        if (isLobbyState(msg)) setLobby(msg);
        if (isGameState(msg)) setGame(msg);
      } catch {
        // ignore
      }
    };
    ws.onerror = () => push("WS error");
    ws.onclose = (e) => {
      setWsStatus("disconnected");
      push(`WS closed: ${e.code}${e.reason ? ` (${e.reason})` : ""}`);
    };
  }

  function disconnectWs() {
    wsRef.current?.close(1000, "disconnect");
    wsRef.current = null;
  }

  useEffect(() => {
    return () => wsRef.current?.close(1000, "unmount");
  }, []);

  return {
    pin,
    setPin,
    name,
    setName,
    wsUrl,
    wsStatus,
    roleHint,
    lobby,
    game,
    logs,
    creating,
    joining,
    createRoom,
    joinRoom,
    connectWs,
    disconnectWs,
    hostLockRoom,
    hostStartGame,
    hostNext,
    submitAnswer,
  };
}
