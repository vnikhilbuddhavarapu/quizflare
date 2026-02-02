import type { GameState, RoleHint } from "../types";
import { Button } from "../ui/Button";
import { AnswerGrid } from "../ui/AnswerGrid";
import { Scoreboard } from "../ui/Scoreboard";
import { TimerBar } from "../ui/TimerBar";
import { useEffect, useMemo, useState } from "react";

type Props = {
  roleHint: RoleHint;
  game: GameState;
  onHostNext: () => void;
  onSubmitAnswer: (choiceIndex: number) => void;
  onLeave: () => void;
  onEndRoom: () => void;
};

export function GamePage({ roleHint, game, onHostNext, onSubmitAnswer, onLeave, onEndRoom }: Props) {
  const q = game.question;
  const showAnswerPad = (game.phase === "answering" || game.phase === "reveal") && Array.isArray(q?.options);
  const canAnswer = roleHint === "player";
  const showHostNext = roleHint === "host" && (game.phase === "scoreboard" || game.phase === "finished");

  const [now, setNow] = useState(() => Date.now());
  const [lockedChoice, setLockedChoice] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setLockedChoice(null);
  }, [game.questionIndex]);

  const remainingSeconds = useMemo(() => {
    if (game.phaseEndsAtMs == null) return null;
    const ms = Math.max(0, game.phaseEndsAtMs - now);
    return Math.ceil(ms / 1000);
  }, [game.phaseEndsAtMs, now]);

  const phaseLabel =
    game.phase === "lobby"
      ? "Lobby"
      : game.phase === "countdown"
        ? "Starting"
        : game.phase === "question_preview"
          ? "Get ready"
          : game.phase === "answering"
            ? "Answer now"
            : game.phase === "reveal"
              ? "Reveal"
              : game.phase === "scoreboard"
                ? "Leaderboard"
                : "Finished";

  const phaseHint =
    game.phase === "countdown"
      ? "Quiz begins in a moment"
      : game.phase === "question_preview"
        ? "Read the question"
        : game.phase === "answering"
          ? "Pick one option"
          : game.phase === "reveal"
            ? "See the correct answer"
            : game.phase === "scoreboard"
              ? "Scores are updated"
              : null;

  const showTimer = game.phase === "answering";
  const showImage = Boolean(game.imageUrl);
  const showReveal = game.phase === "reveal" && game.reveal && q?.options;
  const isScoreboard =
    Array.isArray(game.leaderboard) &&
    (game.phase === "scoreboard" || game.phase === "finished");

  const showCountdown = game.phase === "countdown";
  const showPreview = game.phase === "question_preview";
  const correctIndex = game.phase === "reveal" ? (game.reveal?.correctIndex ?? null) : null;
  const answerDisabled = !canAnswer || game.phase !== "answering" || lockedChoice != null;

  return (
    <>
      <section className="panel">
        <div className="gameHeader">
          <div>
            <div className="gamePhase">{phaseLabel}</div>
            <div className="gameSub">
              <span className="mono">Q{game.questionIndex + 1}</span>
              {phaseHint ? <span className="muted">{phaseHint}</span> : null}
            </div>
          </div>

          <div className="gameHeaderRight">
            {typeof game.answeredCount === "number" && typeof game.playerCount === "number" ? (
              <div className="pill">
                <span className="mono">{game.answeredCount}/{game.playerCount}</span>
                <span className="muted">answered</span>
              </div>
            ) : null}

            {roleHint === "player" ? (
              <Button variant="ghost" onClick={onLeave}>
                Leave
              </Button>
            ) : null}

            {roleHint === "host" ? (
              <Button variant="ghost" onClick={onEndRoom}>
                End room
              </Button>
            ) : null}

            {showHostNext ? (
              <Button variant="secondary" onClick={onHostNext}>
                {game.phase === "finished" ? "Restart" : "Next"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="gameGrid">
          <div className="gameMain">
            <div className="questionCard">
              {showCountdown ? (
                <div className="phaseCenter">
                  <div className="phaseKicker">Starting</div>
                  <div className="phaseBig">{remainingSeconds ?? "…"}</div>
                  <div className="muted">Get ready to play</div>
                </div>
              ) : null}

              {showPreview ? (
                <>
                  <div className="phaseKicker">Get ready</div>
                  <div className="questionText">{q?.text ?? ""}</div>
                  {showImage ? (
                    <div className="questionMedia">
                      <img className="questionImg" src={game.imageUrl} alt="Question" />
                    </div>
                  ) : null}
                  <div className="muted">Answer options appear when the timer starts.</div>
                </>
              ) : null}

              {!showCountdown && !showPreview ? (
                <>
                  <div className="questionText">{q?.text ?? "Waiting…"}</div>

                  {showImage ? (
                    <div className="questionMedia">
                      <img className="questionImg" src={game.imageUrl} alt="Question" />
                    </div>
                  ) : null}

                  {showTimer ? (
                    <TimerBar startedAtMs={game.phaseStartedAtMs} endsAtMs={game.phaseEndsAtMs} />
                  ) : null}

                  {showAnswerPad && q?.options ? (
                    <>
                      <AnswerGrid
                        options={q.options}
                        disabled={answerDisabled}
                        onSelect={(idx) => {
                          if (answerDisabled) return;
                          setLockedChoice(idx);
                          onSubmitAnswer(idx);
                        }}
                        selectedIndex={lockedChoice}
                        correctIndex={correctIndex}
                      />
                      {lockedChoice != null && game.phase === "answering" ? (
                        <div className="muted" style={{ marginTop: 10 }}>
                          Answer submitted.
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <aside className="gameAside">
            {showReveal && game.reveal && q?.options ? (
              <div className="sideCard">
                <div className="panelTitle">Correct answer</div>
                <div className="reveal">
                  <span className="mono">{q.options[game.reveal.correctIndex]}</span>
                </div>
              </div>
            ) : null}

            {roleHint === "host" && (game.phase === "lobby" || game.phase === "countdown") ? (
              <div className="sideCard">
                <div className="panelTitle">Host</div>
                <div className="muted">Start the game from the lobby panel above.</div>
              </div>
            ) : null}

            {isScoreboard && game.leaderboard ? (
              <Scoreboard
                entries={game.leaderboard}
                title={game.phase === "finished" ? "Final leaderboard" : "Leaderboard"}
              />
            ) : null}
          </aside>
        </div>
      </section>
    </>
  );
}
