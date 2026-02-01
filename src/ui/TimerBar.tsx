import { useEffect, useState } from "react";

type Props = {
  startedAtMs: number;
  endsAtMs: number | null;
};

export function TimerBar({ startedAtMs, endsAtMs }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const totalMs = endsAtMs == null ? 0 : Math.max(0, endsAtMs - startedAtMs);
  const remainingMs = endsAtMs == null ? 0 : Math.max(0, endsAtMs - now);
  const seconds = endsAtMs == null ? "-" : `${Math.ceil(remainingMs / 1000)}s`;
  const pct = totalMs <= 0 ? 0 : Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));

  return (
    <div className="timer">
      <div className="timerTop">
        <span className="timerLabel">Time</span>
        <span className="mono">{seconds}</span>
      </div>
      <div className="timerBar">
        <div className="timerFill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
