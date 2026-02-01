import type { LeaderboardEntry } from "../types";

type Props = {
  entries: LeaderboardEntry[];
  title: string;
};

export function Scoreboard({ entries, title }: Props) {
  return (
    <section className="panel">
      <div className="panelTitle">{title}</div>
      <div className="scoreList">
        {entries.slice(0, 10).map((e, idx) => (
          <div key={idx} className="scoreRow">
            <span className="mono">{idx + 1}</span>
            <span className="scoreName">{e.name}</span>
            <span className="mono">{e.score}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
