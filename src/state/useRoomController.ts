import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMsg,
  ConnectedMsg,
  GameState,
  LobbyState,
  RoleHint,
  WsStatus,
} from "../types";

let globalConnectLock: {
  url: string;
  status: "idle" | "connecting";
  startedAtMs: number;
} = {
  url: "",
  status: "idle",
  startedAtMs: 0,
};

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

export function useRoomController(opts?: { autoConnectEnabled?: boolean }) {
  const autoConnectEnabled = opts?.autoConnectEnabled ?? true;
  const [pin, setPin] = useState(() => {
    try {
      const saved = window.localStorage.getItem("qf_last_pin") ?? "";
      return /^[0-9]{6}$/.test(saved) ? saved : "";
    } catch {
      return "";
    }
  });
  const [name, setName] = useState(() => {
    try {
      return window.localStorage.getItem("qf_last_name") ?? "";
    } catch {
      return "";
    }
  });
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const [roleHint, setRoleHint] = useState<RoleHint>(null);
  const [desiredRole, setDesiredRole] = useState<RoleHint>(() => {
    try {
      const saved = window.localStorage.getItem("qf_desired_role");
      return saved === "host" || saved === "player" ? saved : null;
    } catch {
      return null;
    }
  });
  const [autoConnect, setAutoConnect] = useState(() => {
    try {
      return window.localStorage.getItem("qf_auto_connect") === "1";
    } catch {
      return false;
    }
  });
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const wsStatusRef = useRef<WsStatus>("disconnected");
  const autoConnectRef = useRef(false);
  const connectWsRef = useRef<() => void>(() => {});
  const lastConnectUrlRef = useRef<string>("");
  const connectingLockRef = useRef(false);
  const everConnectedRef = useRef(false);

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

  function clearReconnectTimer() {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  async function createRoomWithQuiz(quizId: string) {
    const qid = quizId.trim();
    if (!qid) return;

    setCreating(true);
    setRoleHint(null);
    setDesiredRole(null);
    setLobby(null);
    setGame(null);
    everConnectedRef.current = false;
    try {
      const resp = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: qid }),
      });
      if (!resp.ok) {
        push(`Create room failed: HTTP ${resp.status}`);
        return;
      }
      const data = (await resp.json()) as { pin: string };
      setPin(data.pin);
      setDesiredRole("host");
      reconnectAttemptRef.current = 0;
      setAutoConnect(true);
      try {
        window.localStorage.setItem("qf_resume_pin", data.pin);
      } catch {
        void 0;
      }
      try {
        window.history.pushState({}, "", `/room/${data.pin}`);
        window.dispatchEvent(new Event("qf:navigate"));
      } catch {
        void 0;
      }
      push(`Created room pin=${data.pin}. (Host cookie should be set.)`);
    } catch (e) {
      push(`Create room failed: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();

    if (!autoConnectEnabled) return;

    if (connectingLockRef.current) return;
    const attempt = reconnectAttemptRef.current;
    const delayMs = Math.min(5000, 300 * Math.pow(2, attempt));
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      if (!autoConnectRef.current) return;
      if (wsStatusRef.current !== "disconnected") return;
      if (!wsUrl) return;
      connectWsRef.current();
    }, delayMs);
    push(`Reconnecting in ${delayMs}ms…`);
  }

  async function createRoom() {
    setCreating(true);
    setRoleHint(null);
    setDesiredRole(null);
    setLobby(null);
    setGame(null);
    everConnectedRef.current = false;
    try {
      const resp = await fetch("/api/rooms/create", { method: "POST" });
      if (!resp.ok) {
        push(`Create room failed: HTTP ${resp.status}`);
        return;
      }
      const data = (await resp.json()) as { pin: string };
      setPin(data.pin);
      setDesiredRole("host");
      reconnectAttemptRef.current = 0;
      setAutoConnect(true);
      try {
        window.localStorage.setItem("qf_resume_pin", data.pin);
      } catch {
        // ignore
      }
      try {
        window.history.pushState({}, "", `/room/${data.pin}`);
        window.dispatchEvent(new Event("qf:navigate"));
      } catch {
        // ignore
      }
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
    everConnectedRef.current = false;
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
        reconnectAttemptRef.current = 0;
        setAutoConnect(true);
        try {
          window.localStorage.setItem("qf_resume_pin", p);
        } catch {
          // ignore
        }
        try {
          window.history.pushState({}, "", `/room/${p}`);
          window.dispatchEvent(new Event("qf:navigate"));
        } catch {
          // ignore
        }
        push(`Join OK: lobby_state (${data.members.length} members)`);
      } else {
        setDesiredRole("player");
        reconnectAttemptRef.current = 0;
        setAutoConnect(true);
        try {
          window.localStorage.setItem("qf_resume_pin", p);
        } catch {
          // ignore
        }
        try {
          window.history.pushState({}, "", `/room/${p}`);
          window.dispatchEvent(new Event("qf:navigate"));
        } catch {
          // ignore
        }
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

    clearReconnectTimer();

    const current = wsRef.current;

    if (
      globalConnectLock.status === "connecting" &&
      globalConnectLock.url === wsUrl &&
      Date.now() - globalConnectLock.startedAtMs < 5000
    ) {
      return;
    }

    if (connectingLockRef.current) return;
    const alreadyConnectingOrConnected =
      current &&
      (current.readyState === WebSocket.CONNECTING ||
        current.readyState === WebSocket.OPEN);

    if (alreadyConnectingOrConnected && current.url === wsUrl) {
      setWsStatus(
        current.readyState === WebSocket.OPEN ? "connected" : "connecting",
      );
      return;
    }

    if (
      lastConnectUrlRef.current === wsUrl &&
      wsStatusRef.current === "connecting"
    ) {
      return;
    }

    lastConnectUrlRef.current = wsUrl;
    connectingLockRef.current = true;
    wsStatusRef.current = "connecting";
    globalConnectLock = {
      url: wsUrl,
      status: "connecting",
      startedAtMs: Date.now(),
    };

    wsRef.current?.close(1000, "reconnect");
    setWsStatus("connecting");
    push(`Connecting WS: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      wsStatusRef.current = "connected";
      connectingLockRef.current = false;
      reconnectAttemptRef.current = 0;
      everConnectedRef.current = true;
      if (globalConnectLock.url === wsUrl) {
        globalConnectLock = { url: "", status: "idle", startedAtMs: 0 };
      }
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
      wsStatusRef.current = "disconnected";
      connectingLockRef.current = false;
      push(`WS closed: ${e.code}${e.reason ? ` (${e.reason})` : ""}`);
      lastConnectUrlRef.current = "";

      if (
        e.reason === "room_ended" ||
        e.reason === "room_idle" ||
        e.reason === "leave"
      ) {
        resetRoomStateAndNavigateHome();
        return;
      }

      if (globalConnectLock.url === wsUrl) {
        globalConnectLock = { url: "", status: "idle", startedAtMs: 0 };
      }

      const shouldReconnect =
        autoConnectRef.current &&
        e.reason !== "disconnect" &&
        e.reason !== "unmount" &&
        e.reason !== "reconnect";

      if (!autoConnectEnabled) return;

      if (
        shouldReconnect &&
        !everConnectedRef.current &&
        reconnectAttemptRef.current >= 3
      ) {
        setAutoConnect(false);
        push(
          "Auto-reconnect stopped (no active session). Please create/join again.",
        );
        return;
      }

      if (shouldReconnect) scheduleReconnect();
    };
  }

  function disconnectWs() {
    setAutoConnect(false);
    clearReconnectTimer();
    wsRef.current?.close(1000, "disconnect");
    wsRef.current = null;
    try {
      window.localStorage.removeItem("qf_resume_pin");
    } catch {
      // ignore
    }

    globalConnectLock = { url: "", status: "idle", startedAtMs: 0 };
  }

  function resetRoomStateAndNavigateHome() {
    disconnectWs();
    setPin("");
    setLobby(null);
    setGame(null);
    setRoleHint(null);
    setDesiredRole(null);
    setCreating(false);
    setJoining(false);
    try {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      void 0;
    }
  }

  async function leaveRoom(as: "host" | "player") {
    const p = pin.trim();
    if (!/^[0-9]{6}$/.test(p)) return;
    try {
      const resp = await fetch("/api/rooms/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: p, as }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        push(`Leave failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
    } catch (e) {
      push(`Leave failed: ${String(e)}`);
      return;
    }
    resetRoomStateAndNavigateHome();
  }

  async function endRoom() {
    const p = pin.trim();
    if (!/^[0-9]{6}$/.test(p)) return;
    try {
      const resp = await fetch("/api/rooms/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: p }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        push(`End room failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
    } catch (e) {
      push(`End room failed: ${String(e)}`);
      return;
    }
    resetRoomStateAndNavigateHome();
  }

  useEffect(() => {
    return () => {
      autoConnectRef.current = false;
      clearReconnectTimer();
      wsRef.current?.close(1000, "unmount");
    };
  }, []);

  useEffect(() => {
    wsStatusRef.current = wsStatus;
  }, [wsStatus]);

  useEffect(() => {
    autoConnectRef.current = autoConnect;
  }, [autoConnect]);

  useEffect(() => {
    connectWsRef.current = connectWs;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("qf_last_pin", pin);
    } catch {
      // ignore
    }
  }, [pin]);

  useEffect(() => {
    try {
      window.localStorage.setItem("qf_last_name", name);
    } catch {
      // ignore
    }
  }, [name]);

  useEffect(() => {
    try {
      window.localStorage.setItem("qf_auto_connect", autoConnect ? "1" : "0");
    } catch {
      // ignore
    }
  }, [autoConnect]);

  useEffect(() => {
    try {
      if (desiredRole === "host" || desiredRole === "player") {
        window.localStorage.setItem("qf_desired_role", desiredRole);
      }
    } catch {
      // ignore
    }
  }, [desiredRole]);

  useEffect(() => {
    if (!autoConnect) return;
    if (!wsUrl) return;
    if (!autoConnectEnabled) return;
    if (wsStatusRef.current !== "disconnected") return;
    connectWsRef.current();
  }, [autoConnect, wsUrl, autoConnectEnabled]);

  return {
    pin,
    setPin,
    name,
    setName,
    desiredRole,
    setDesiredRole,
    wsUrl,
    wsStatus,
    roleHint,
    autoConnect,
    setAutoConnect,
    lobby,
    game,
    logs,
    creating,
    joining,
    createRoom,
    createRoomWithQuiz,
    joinRoom,
    connectWs,
    disconnectWs,
    leaveRoom,
    endRoom,
    hostLockRoom,
    hostStartGame,
    hostNext,
    submitAnswer,
  };
}
