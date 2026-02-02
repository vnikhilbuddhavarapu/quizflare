import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button";

type QuizMeta = {
  id: string;
  title: string;
  createdAtMs?: number;
  updatedAtMs?: number;
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
  onBackToCreator: () => void;
  onEdit: (quizId: string) => void;
  onHost: (quizId: string) => void;
  onPreview: (quizId: string) => void;
};

export function QuizDetailsPage({
  quizId,
  onBackToCreator,
  onEdit,
  onHost,
  onPreview,
}: Props) {
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

  const questionCount = data?.questions?.length ?? 0;
  const canHostOrPreview = questionCount > 0;

  return (
    <>
      <section className="panel">
        <div className="row">
          <div>
            <div className="panelTitle">Quiz</div>
            <div className="muted">Manage and host your quiz.</div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Button variant="ghost" onClick={onBackToCreator}>
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
            <div className="row">
              <div>
                <div className="panelTitle">{data.quiz.title}</div>
                <div className="muted mono">{data.quiz.id}</div>
              </div>
              <div className="pill">{questionCount} questions</div>
            </div>

            <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
              <Button onClick={() => onEdit(quizId)}>Edit</Button>
              <Button
                variant="secondary"
                onClick={() => onHost(quizId)}
                disabled={!canHostOrPreview}
              >
                Host live
              </Button>
              <Button
                variant="secondary"
                onClick={() => onPreview(quizId)}
                disabled={!canHostOrPreview}
              >
                Preview
              </Button>
            </div>

            {!canHostOrPreview ? (
              <div className="muted" style={{ marginTop: 12 }}>
                Add at least 1 question before hosting or previewing.
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {data && data.questions.length > 0 ? (
        <section className="panel">
          <div className="panelTitle">Questions</div>
          <div className="lobbyList" style={{ marginTop: 10 }}>
            {data.questions.map((q) => (
              <div key={q.id} className="lobbyRow">
                <span className="mono">{q.position + 1}.</span>
                <span className="lobbyName">{q.prompt}</span>
                <span className="muted">{q.timeLimitMs / 1000}s</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
