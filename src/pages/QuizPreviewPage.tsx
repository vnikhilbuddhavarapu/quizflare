import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button";

type QuizMeta = {
  id: string;
  title: string;
};

type QuizQuestion = {
  id: string;
  position: number;
  type: string;
  prompt: string;
  timeLimitMs: number;
  pointsMultiplier: number;
  imageKey: string | null;
  options: string[];
  correctIndices: number[];
};

type QuizDetailsResponse = {
  quiz: QuizMeta;
  questions: QuizQuestion[];
};

type Props = {
  quizId: string;
  onBackToDetails: (quizId: string) => void;
};

export function QuizPreviewPage({ quizId, onBackToDetails }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QuizDetailsResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}`);
      if (!resp.ok) {
        setError(`Failed to load quiz: HTTP ${resp.status}`);
        return;
      }
      const json = (await resp.json()) as QuizDetailsResponse;
      setData(json);
    } catch (e) {
      setError(`Failed to load quiz: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <section className="panel">
        <div className="row">
          <div>
            <div className="panelTitle">Preview</div>
            <div className="muted">Read-only preview of the quiz content.</div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Button variant="ghost" onClick={() => onBackToDetails(quizId)}>
              Back
            </Button>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>
      </section>

      <section className="panel">
        {loading ? (
          <div className="muted">Loading…</div>
        ) : error ? (
          <div className="muted">{error}</div>
        ) : data ? (
          <>
            <div className="panelTitle">{data.quiz.title}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              {data.questions.length} questions
            </div>

            <div className="lobbyList" style={{ marginTop: 14 }}>
              {data.questions.map((q) => (
                <div key={q.id} className="lobbyRow">
                  <span className="mono">{q.position + 1}.</span>
                  <span className="lobbyName">{q.prompt}</span>
                  <span className="muted">{q.timeLimitMs / 1000}s</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
