import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

type QuizRow = {
  id: string;
  title: string;
  createdAtMs?: number;
  updatedAtMs?: number;
};

type Props = {
  onBackHome: () => void;
  onOpenQuiz: (quizId: string) => void;
};

export function CreatorPage({ onBackHome, onOpenQuiz }: Props) {
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMine() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/quizzes?scope=mine");
      if (!resp.ok) {
        setError(`Failed to load quizzes: HTTP ${resp.status}`);
        return;
      }
      const data = (await resp.json()) as unknown;
      const rows =
        typeof data === "object" && data !== null &&
        Array.isArray((data as { quizzes?: unknown }).quizzes)
          ? ((data as { quizzes: QuizRow[] }).quizzes ?? [])
          : [];
      setQuizzes(rows);
    } catch (e) {
      setError(`Failed to load quizzes: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetch("/api/creator/init", { method: "POST" }).catch(() => {});
    void loadMine();
  }, []);

  async function createQuiz() {
    const t = title.trim();
    if (!t) return;
    setCreating(true);
    setError(null);
    try {
      const resp = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Create failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      setTitle("");
      await loadMine();
    } catch (e) {
      setError(`Create failed: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="row">
          <div>
            <div className="panelTitle">Create / Setup Quiz</div>
            <div className="muted">Your quizzes are saved to this browser (MVP ownership via cookie).</div>
          </div>
          <Button variant="ghost" onClick={onBackHome}>
            Back
          </Button>
        </div>
      </section>

      <section className="panel">
        <div className="panelTitle">New quiz</div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <TextInput label="Quiz name" value={title} onChange={setTitle} placeholder="e.g. General Knowledge" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button onClick={createQuiz} disabled={creating || !title.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
        {error ? <div className="muted" style={{ marginTop: 10 }}>{error}</div> : null}
      </section>

      <section className="panel">
        <div className="row">
          <div className="panelTitle">My quizzes</div>
          <Button variant="secondary" onClick={loadMine} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        {loading ? (
          <div className="muted" style={{ marginTop: 10 }}>Loading…</div>
        ) : quizzes.length < 1 ? (
          <div className="muted" style={{ marginTop: 10 }}>No quizzes yet. Create your first one above.</div>
        ) : (
          <div className="lobbyList">
            {quizzes.map((q) => (
              <button
                key={q.id}
                className="creatorQuizRow"
                onClick={() => onOpenQuiz(q.id)}
                type="button"
              >
                <span className="lobbyName">{q.title}</span>
                <span className="muted mono">{q.id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
