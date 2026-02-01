import type { GameState, RoleHint } from "../types";
import { Button } from "../ui/Button";
import { AnswerGrid } from "../ui/AnswerGrid";
import { Scoreboard } from "../ui/Scoreboard";
import { TimerBar } from "../ui/TimerBar";

type Props = {
  roleHint: RoleHint;
  game: GameState;
  onHostNext: () => void;
  onSubmitAnswer: (choiceIndex: number) => void;
};

export function GamePage({ roleHint, game, onHostNext, onSubmitAnswer }: Props) {
  const q = game.question;
  const showAnswerPad = game.phase === "answering" && Array.isArray(q?.options);
  const canAnswer = roleHint === "player";
  const showHostNext = roleHint === "host" && (game.phase === "scoreboard" || game.phase === "finished");

  return (
    <>
      <section className="panel">
        <div className="row">
          <div className="meta">
            <div>
              <span className="metaKey">Phase:</span> <span className="mono">{game.phase}</span>
            </div>
            <div>
              <span className="metaKey">Q:</span> <span className="mono">{game.questionIndex + 1}</span>
            </div>
            {typeof game.answeredCount === "number" && typeof game.playerCount === "number" ? (
              <div>
                <span className="metaKey">Answered:</span> <span className="mono">{game.answeredCount}/{game.playerCount}</span>
              </div>
            ) : null}
          </div>
          {showHostNext ? (
            <Button variant="secondary" onClick={onHostNext}>
              {game.phase === "finished" ? "Restart" : "Next"}
            </Button>
          ) : null}
        </div>

        <div className="questionText">{q?.text ?? "Waiting…"}</div>

        {game.phase === "answering" ? (
          <TimerBar startedAtMs={game.phaseStartedAtMs} endsAtMs={game.phaseEndsAtMs} />
        ) : null}

        {showAnswerPad && q?.options ? (
          <AnswerGrid options={q.options} disabled={!canAnswer} onSelect={onSubmitAnswer} />
        ) : null}

        {roleHint === "player" && game.phase !== "answering" ? (
          <div className="muted">Answer pad will appear when the timer starts.</div>
        ) : null}

        {game.phase === "reveal" && game.reveal && q?.options ? (
          <div className="reveal">
            <span className="metaKey">Correct:</span> <span className="mono">{q.options[game.reveal.correctIndex]}</span>
          </div>
        ) : null}
      </section>

      {Array.isArray(game.leaderboard) && (game.phase === "scoreboard" || game.phase === "finished") ? (
        <Scoreboard entries={game.leaderboard} title={game.phase === "finished" ? "Final leaderboard" : "Leaderboard"} />
      ) : null}
    </>
  );
}
