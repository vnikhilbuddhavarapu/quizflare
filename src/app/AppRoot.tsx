import { AppShell } from "./AppShell";
import { LandingPage } from "../pages/LandingPage";
import { LobbyPage } from "../pages/LobbyPage";
import { HostLobbyPanel } from "../pages/HostLobbyPanel";
import { GamePage } from "../pages/GamePage";
import { CreatorPage } from "../pages/CreatorPage";
import { QuizDetailsPage } from "../pages/QuizDetailsPage";
import { QuizEditorPage } from "../pages/QuizEditorPage";
import { QuizPreviewPage } from "../pages/QuizPreviewPage";
import { LogPanel } from "../ui/LogPanel";
import { useRoomController } from "../state/useRoomController";
import { useEffect, useMemo, useState } from "react";

function routePinFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/room\/([0-9]{6})\/?$/);
  return m ? m[1] : null;
}

function isCreatorRoute(pathname: string): boolean {
  return pathname === "/creator" || pathname === "/creator/";
}

function creatorQuizRouteFromPath(pathname: string): {
  quizId: string;
  mode: "details" | "edit" | "preview";
} | null {
  const m = pathname.match(/^\/creator\/quiz\/([^/]+)(?:\/(edit|preview))?\/?$/);
  if (!m) return null;
  const quizId = m[1] ?? "";
  const tail = m[2] ?? "";
  const mode = tail === "edit" ? "edit" : tail === "preview" ? "preview" : "details";
  if (!quizId) return null;
  return { quizId, mode };
}

function readResumePin(): string {
  try {
    const saved = window.localStorage.getItem("qf_resume_pin") ?? "";
    return /^[0-9]{6}$/.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

function readDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("debug") === "1") return true;
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem("qf_debug") === "1";
  } catch {
    return false;
  }
}

export function AppRoot() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const routePin = useMemo(() => routePinFromPath(pathname), [pathname]);
  const creatorRoute = useMemo(() => isCreatorRoute(pathname), [pathname]);
  const creatorQuizRoute = useMemo(
    () => creatorQuizRouteFromPath(pathname),
    [pathname],
  );

  const [resumePin, setResumePin] = useState(() => readResumePin());
  const [debugEnabled, setDebugEnabled] = useState(() => readDebugEnabled());

  const shouldAutoConnectRoom = Boolean(routePin && routePin === resumePin);
  const c = useRoomController({ autoConnectEnabled: shouldAutoConnectRoom });
  const {
    wsStatus,
    autoConnect,
    disconnectWs,
    pin,
    setPin,
    setAutoConnect,
    setDesiredRole,
  } = c;

  useEffect(() => {
    const onNav = () => {
      setPathname(window.location.pathname);
      setResumePin(readResumePin());
      setDebugEnabled(readDebugEnabled());
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("qf:navigate", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("qf:navigate", onNav);
    };
  }, []);

  useEffect(() => {
    if (!routePin) {
      if (wsStatus !== "disconnected" || autoConnect) disconnectWs();
      return;
    }

    if (routePin !== pin) setPin(routePin);

    if (routePin === resumePin && !autoConnect) setAutoConnect(true);

    const as = new URLSearchParams(window.location.search).get("as");
    if (as === "host" || as === "player") setDesiredRole(as);
  }, [
    routePin,
    resumePin,
    wsStatus,
    autoConnect,
    pin,
    setPin,
    setAutoConnect,
    setDesiredRole,
    disconnectWs,
  ]);

  const showLobby = Boolean(routePin) && (autoConnect || Boolean(c.lobby) || Boolean(c.game));
  const gamePhase = c.game?.phase ?? null;
  const inGame = Boolean(c.game && gamePhase && gamePhase !== "lobby");
  const locked = c.game?.locked ?? false;
  const isHost = c.roleHint === "host";
  const wsConnected = c.wsStatus === "connected";

  function goHome() {
    try {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      // ignore
    }
  }

  function goCreator() {
    try {
      void fetch("/api/creator/init", { method: "POST" });
    } catch {
      // ignore
    }
    try {
      window.history.pushState({}, "", "/creator");
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      // ignore
    }
  }

  function goCreatorQuizDetails(quizId: string) {
    try {
      window.history.pushState(
        {},
        "",
        `/creator/quiz/${encodeURIComponent(quizId)}`,
      );
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      void 0;
    }
  }

  function goCreatorQuizEdit(quizId: string) {
    try {
      window.history.pushState(
        {},
        "",
        `/creator/quiz/${encodeURIComponent(quizId)}/edit`,
      );
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      void 0;
    }
  }

  function goCreatorQuizPreview(quizId: string) {
    try {
      window.history.pushState(
        {},
        "",
        `/creator/quiz/${encodeURIComponent(quizId)}/preview`,
      );
      window.dispatchEvent(new Event("qf:navigate"));
    } catch {
      void 0;
    }
  }

  return (
    <AppShell title="Quizflare" subtitle="Milestone 3: UI overhaul (in progress)" badge="local">
      {creatorQuizRoute ? (
        creatorQuizRoute.mode === "edit" ? (
          <QuizEditorPage
            quizId={decodeURIComponent(creatorQuizRoute.quizId)}
            onBackToDetails={goCreatorQuizDetails}
          />
        ) : creatorQuizRoute.mode === "preview" ? (
          <QuizPreviewPage
            quizId={decodeURIComponent(creatorQuizRoute.quizId)}
            onBackToDetails={goCreatorQuizDetails}
          />
        ) : (
          <QuizDetailsPage
            quizId={decodeURIComponent(creatorQuizRoute.quizId)}
            onBackToCreator={goCreator}
            onEdit={goCreatorQuizEdit}
            onPreview={goCreatorQuizPreview}
            onHost={(quizId) => c.createRoomWithQuiz(quizId)}
          />
        )
      ) : creatorRoute ? (
        <CreatorPage onBackHome={goHome} onOpenQuiz={goCreatorQuizDetails} />
      ) : inGame && c.game ? (
        <GamePage
          roleHint={c.roleHint}
          game={c.game}
          onHostNext={c.hostNext}
          onSubmitAnswer={c.submitAnswer}
          onLeave={() => c.leaveRoom("player")}
          onEndRoom={c.endRoom}
        />
      ) : showLobby ? (
        <>
          {isHost && gamePhase === "lobby" ? (
            <HostLobbyPanel
              locked={locked}
              wsConnected={wsConnected}
              onToggleLock={() => c.hostLockRoom(!locked)}
              onStartGame={c.hostStartGame}
              onEndRoom={c.endRoom}
            />
          ) : null}
          <LobbyPage
            pin={c.pin}
            roleHint={c.roleHint}
            members={c.lobby?.members ?? []}
            wsStatus={c.wsStatus}
            onLeave={c.roleHint === "player" ? () => c.leaveRoom("player") : undefined}
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
          onCreateQuiz={goCreator}
          onCreate={c.createRoom}
          onJoin={c.joinRoom}
        />
      )}

      {debugEnabled ? (
        <>
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
        </>
      ) : null}
    </AppShell>
  );
}
