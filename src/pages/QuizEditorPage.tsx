import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

type QuestionType = "true_false" | "single_choice" | "multi_select";

type QuizMeta = {
  id: string;
  title: string;
};

type QuizQuestion = {
  id: string;
  position: number;
  type: QuestionType;
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

export function QuizEditorPage({ quizId, onBackToDetails }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QuizDetailsResponse | null>(null);

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const selected = useMemo(
    () => data?.questions.find((q) => q.id === selectedQuestionId) ?? null,
    [data, selectedQuestionId],
  );

  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctIndices, setCorrectIndices] = useState<number[]>([0]);
  const [questionType, setQuestionType] = useState<QuestionType>("single_choice");
  const [timeLimitMs, setTimeLimitMs] = useState(20000);
  const [pointsMultiplier, setPointsMultiplier] = useState<1 | 2>(1);
  const [quizTitle, setQuizTitle] = useState("");
  const [selectedTemplateType, setSelectedTemplateType] = useState<QuestionType>("single_choice");
  const [uploadingImage, setUploadingImage] = useState(false);

  function applyType(nextType: QuestionType) {
    setQuestionType(nextType);
    if (nextType === "true_false") {
      setOptions(["True", "False", "", "", "", ""]);
      setCorrectIndices([0]);
      return;
    }
    if (nextType === "single_choice") {
      setCorrectIndices([(correctIndices[0] ?? 0) as number]);
    }
  }

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
      if (!selectedQuestionId && json.questions.length > 0) {
        setSelectedQuestionId(json.questions[0]!.id);
      }
    } catch (e) {
      setError(`Failed to load quiz: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [quizId, selectedQuestionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setPrompt(selected.prompt);
    const padded = (selected.options ?? [])
      .concat(["", "", "", "", "", ""]) 
      .slice(0, 6);
    setOptions(padded);
    const idxs = (selected.correctIndices ?? []).filter((n) => Number.isInteger(n));
    setCorrectIndices(idxs.length > 0 ? idxs : [0]);
    setQuestionType(selected.type);
    setTimeLimitMs(selected.timeLimitMs);
    setPointsMultiplier(selected.pointsMultiplier === 2 ? 2 : 1);
  }, [selected]);

  useEffect(() => {
    if (!data) return;
    setQuizTitle(data.quiz.title);
  }, [data]);

  async function addQuestion() {
    setError(null);
    try {
      const resp = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedTemplateType }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Add question failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      const created = (await resp.json()) as { questionId: string };
      await load();
      setSelectedQuestionId(created.questionId);
    } catch (e) {
      setError(`Add question failed: ${String(e)}`);
    }
  }

  async function saveQuizMeta() {
    const title = quizTitle.trim();
    if (!title) return;
    setSavingQuiz(true);
    setError(null);
    try {
      const resp = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Save quiz failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      await load();
    } catch (e) {
      setError(`Save quiz failed: ${String(e)}`);
    } finally {
      setSavingQuiz(false);
    }
  }

  async function reorderQuestions(nextIds: string[]) {
    setError(null);
    try {
      const resp = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIds: nextIds }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Reorder failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      await load();
    } catch (e) {
      setError(`Reorder failed: ${String(e)}`);
    }
  }

  async function moveSelected(delta: -1 | 1) {
    if (!data || !selected) return;
    const ids = data.questions.map((q) => q.id);
    const idx = ids.indexOf(selected.id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return;
    const next = ids.slice();
    const tmp = next[idx]!;
    next[idx] = next[nextIdx]!;
    next[nextIdx] = tmp;
    await reorderQuestions(next);
  }

  function toggleCorrect(idx: number) {
    if (questionType === "multi_select") {
      const set = new Set(correctIndices);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      const arr = Array.from(set).sort((a, b) => a - b);
      setCorrectIndices(arr.length > 0 ? arr : [0]);
      return;
    }
    setCorrectIndices([idx]);
  }

  async function uploadImage(file: File) {
    if (!selected) return;
    setUploadingImage(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`/api/questions/${encodeURIComponent(selected.id)}/image`, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Upload failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      await load();
    } catch (e) {
      setError(`Upload failed: ${String(e)}`);
    } finally {
      setUploadingImage(false);
    }
  }

  async function removeImage() {
    if (!selected) return;
    setUploadingImage(true);
    setError(null);
    try {
      const resp = await fetch(`/api/questions/${encodeURIComponent(selected.id)}/image`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Remove image failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      await load();
    } catch (e) {
      setError(`Remove image failed: ${String(e)}`);
    } finally {
      setUploadingImage(false);
    }
  }

  async function saveSelected() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
      const uniqueCorrect = Array.from(
        new Set(correctIndices.filter((n) => Number.isInteger(n))),
      ).sort((a, b) => a - b);
      const filteredCorrect = uniqueCorrect.filter((idx) => idx >= 0 && idx < cleanOptions.length);

      const safeCorrect =
        questionType === "multi_select"
          ? filteredCorrect.length > 0
            ? filteredCorrect
            : [0]
          : [Math.max(0, Math.min(cleanOptions.length - 1, filteredCorrect[0] ?? 0))];

      const payload = {
        type: questionType,
        prompt: prompt.trim() || "New question",
        timeLimitMs,
        pointsMultiplier,
        options: cleanOptions,
        correctIndices: safeCorrect,
      };

      const resp = await fetch(`/api/questions/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(`Save failed: HTTP ${resp.status}${text ? ` ${text}` : ""}`);
        return;
      }
      await load();
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="row">
          <div>
            <div className="panelTitle">Edit quiz</div>
            <div className="muted">Builder</div>
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
        {error ? <div className="muted">{error}</div> : null}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : data ? (
          <div className="creatorEditorGrid">
            <div className="creatorCol">
              <div className="panelTitle">Quiz</div>
              <TextInput
                label="Title"
                value={quizTitle}
                onChange={setQuizTitle}
                placeholder="Quiz title"
                maxLength={80}
              />
              <div className="row" style={{ marginTop: 10, gap: 10 }}>
                <Button onClick={saveQuizMeta} disabled={savingQuiz}>
                  {savingQuiz ? "Saving…" : "Save title"}
                </Button>
              </div>

              <div className="panelTitle" style={{ marginTop: 14 }}>
                Add question
              </div>
              <div className="field">
                <div className="label">Template</div>
                <select
                  className="input"
                  value={selectedTemplateType}
                  onChange={(e) => setSelectedTemplateType(e.target.value as QuestionType)}
                >
                  <option value="single_choice">Single choice (A-D)</option>
                  <option value="multi_select">Multi select</option>
                  <option value="true_false">True / False</option>
                </select>
              </div>
              <div className="row" style={{ marginTop: 10, gap: 10 }}>
                <Button variant="secondary" onClick={addQuestion}>
                  Add
                </Button>
              </div>

              <div className="panelTitle" style={{ marginTop: 14 }}>
                Questions
              </div>
              <div className="lobbyList" style={{ marginTop: 10 }}>
                {data.questions.length < 1 ? (
                  <div className="muted">No questions yet.</div>
                ) : (
                  data.questions.map((q) => (
                    <button
                      key={q.id}
                      className={
                        q.id === selectedQuestionId
                          ? "creatorQuestionItem creatorQuestionItemActive"
                          : "creatorQuestionItem"
                      }
                      onClick={() => setSelectedQuestionId(q.id)}
                      type="button"
                    >
                      <span className="mono">{q.position + 1}.</span>
                      <span className="creatorQuestionText">{q.prompt}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="creatorCol">
              <div className="panelTitle">Question</div>
              {selected ? (
                <>
                  <div className="row" style={{ marginTop: 10, gap: 10 }}>
                    <Button variant="secondary" onClick={() => void moveSelected(-1)}>
                      Move up
                    </Button>
                    <Button variant="secondary" onClick={() => void moveSelected(1)}>
                      Move down
                    </Button>
                  </div>

                  <TextInput
                    label="Prompt"
                    value={prompt}
                    onChange={setPrompt}
                    placeholder="Type your question…"
                  />

                  <div className="field">
                    <div className="label">Type</div>
                    <select
                      className="input"
                      value={questionType}
                      onChange={(e) => applyType(e.target.value as QuestionType)}
                    >
                      <option value="single_choice">Single choice</option>
                      <option value="multi_select">Multi select</option>
                      <option value="true_false">True / False</option>
                    </select>
                  </div>

                  <div style={{ marginTop: 12 }} className="panelTitle">
                    Options
                  </div>
                  <div className="creatorOptions">
                    {(questionType === "true_false" ? options.slice(0, 2) : options).map((opt, idx) => (
                      <div key={idx} className="creatorOptionRow">
                        <button
                          type="button"
                          className={
                            correctIndices.includes(idx)
                              ? "creatorCorrectBadge creatorCorrectBadgeActive"
                              : "creatorCorrectBadge"
                          }
                          onClick={() => toggleCorrect(idx)}
                          aria-label="Mark as correct"
                        >
                          {correctIndices.includes(idx) ? "✓" : ""}
                        </button>
                        <input
                          className="input"
                          value={opt}
                          onChange={(e) => {
                            const next = options.slice();
                            next[idx] = e.target.value;
                            setOptions(next);
                          }}
                          placeholder={`Option ${idx + 1}`}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="row" style={{ marginTop: 14, gap: 10 }}>
                    <Button onClick={saveSelected} disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="muted" style={{ marginTop: 10 }}>
                  Select a question to edit.
                </div>
              )}
            </div>

            <div className="creatorCol">
              <div className="panelTitle">Settings</div>
              {selected ? (
                <>
                  <TextInput
                    label="Time limit (ms)"
                    value={String(timeLimitMs)}
                    onChange={(v) => {
                      const n = Number(v);
                      if (!Number.isFinite(n)) return;
                      setTimeLimitMs(Math.max(5000, Math.min(120000, Math.floor(n))));
                    }}
                    inputMode="numeric"
                  />

                  <div className="field">
                    <div className="label">Points</div>
                    <select
                      className="input"
                      value={pointsMultiplier}
                      onChange={(e) => setPointsMultiplier(e.target.value === "2" ? 2 : 1)}
                    >
                      <option value={1}>Normal (1x)</option>
                      <option value={2}>Double (2x)</option>
                    </select>
                  </div>

                  <div className="panelTitle" style={{ marginTop: 14 }}>
                    Image
                  </div>
                  {selected.imageKey ? (
                    <>
                      <img
                        src={`/api/questions/${encodeURIComponent(selected.id)}/image`}
                        alt="Question"
                        style={{ width: "100%", borderRadius: 12, border: "1px solid var(--qf-border)" }}
                      />
                      <div className="row" style={{ marginTop: 10, gap: 10 }}>
                        <label className="btn secondary" style={{ display: "inline-flex" }}>
                          Replace
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              void uploadImage(f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <Button variant="ghost" onClick={removeImage} disabled={uploadingImage}>
                          {uploadingImage ? "Working…" : "Remove"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="row" style={{ marginTop: 10, gap: 10 }}>
                      <label className="btn secondary" style={{ display: "inline-flex" }}>
                        {uploadingImage ? "Uploading…" : "Upload"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            void uploadImage(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <div className="muted" style={{ alignSelf: "center" }}>
                        PNG/JPG/WEBP up to 5MB
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="muted" style={{ marginTop: 8 }}>
                  Select a question to edit settings.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
