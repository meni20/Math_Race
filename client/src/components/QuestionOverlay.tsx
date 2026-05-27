import { FormEvent, useEffect, useMemo, useState } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";

export function QuestionOverlay() {
  const racePhase = useGameStore((state) => state.racePhase);
  const question = useGameStore((state) => state.question);
  const questionReceivedAtMs = useGameStore((state) => state.questionReceivedAtMs);
  const feedback = useGameStore((state) => state.answerFeedback);
  const [answer, setAnswer] = useState("");
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!question) {
      return;
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 120);
    return () => window.clearInterval(intervalId);
  }, [question]);

  useEffect(() => {
    setAnswer("");
    setSubmittingQuestionId(null);
  }, [question?.questionId]);

  const remainingMs = useMemo(() => {
    if (!question) {
      return 0;
    }
    if (typeof question.expiresAtMs === "number" && question.expiresAtMs > 0) {
      return Math.max(0, question.expiresAtMs - nowMs);
    }
    return Math.max(0, question.timeLimitMs - (nowMs - questionReceivedAtMs));
  }, [question, questionReceivedAtMs, nowMs]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!question || submittingQuestionId === question.questionId || !answer.trim()) {
      return;
    }
    setSubmittingQuestionId(question.questionId);
    gameSocket.submitAnswer(answer.trim(), false);
    setAnswer("");
  };

  useEffect(() => {
    if (!question || submittingQuestionId === question.questionId || remainingMs > 0) {
      return;
    }
    setSubmittingQuestionId(question.questionId);
    gameSocket.submitAnswer("", true);
  }, [question, remainingMs, submittingQuestionId]);

  if (!question || racePhase !== "active") {
    return null;
  }

  const disabled = submittingQuestionId === question.questionId;
  const latestFeedback = feedback && Date.now() - feedback.receivedAtMs < 700 ? feedback : null;
  const feedbackClass = latestFeedback?.feedback === "correct"
    ? "border-emerald-300/55 bg-emerald-500/18 text-emerald-100"
    : latestFeedback?.feedback === "timeout"
      ? "border-amber-300/55 bg-amber-500/18 text-amber-100"
      : "border-rose-300/55 bg-rose-500/18 text-rose-100";
  const feedbackText = latestFeedback?.feedback === "correct"
    ? "Correct!"
    : latestFeedback?.feedback === "timeout"
      ? "Time's up"
      : "Wrong";
  const promptText = question.kind === "WORD_PROBLEM" ? question.prompt : `${question.prompt} = ?`;

  return (
    <section className="pointer-events-auto absolute bottom-4 left-1/2 z-[25] w-[min(94vw,30rem)] -translate-x-1/2 rounded-2xl border border-cyan-300/40 bg-slate-900/88 p-3 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/85">
          {question.highwayChallenge ? "Highway challenge" : "Math boost"}
        </p>
        <p className="text-xs font-semibold text-cyan-100">{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <p className="mb-3 text-xl font-bold text-cyan-50">{promptText}</p>

      {latestFeedback ? (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm font-semibold ${feedbackClass}`}>
          {feedbackText}
          {typeof latestFeedback.pointsDelta === "number" ? (
            <span className="ml-2 opacity-85">{latestFeedback.pointsDelta > 0 ? "+" : ""}{latestFeedback.pointsDelta}</span>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          className="flex-1 rounded-lg border border-cyan-300/45 bg-slate-950/90 px-3 py-2 text-base text-cyan-100 outline-none transition focus:border-cyan-200 focus:ring-2 focus:ring-cyan-200/40"
          placeholder="Type answer..."
          inputMode="numeric"
          disabled={disabled}
          autoFocus
        />
        <button
          type="submit"
          disabled={disabled || !answer.trim()}
          className="rounded-lg border border-cyan-300/60 bg-cyan-400/25 px-4 py-2 text-sm font-semibold uppercase tracking-[0.1em] text-cyan-50 transition hover:bg-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disabled ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}
