import { useEffect, useMemo, useState } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";
import { useLanguage } from "../i18n";

export function QuestionOverlay() {
  const { t } = useLanguage();
  const racePhase = useGameStore((state) => state.racePhase);
  const question = useGameStore((state) => state.question);
  const questionReceivedAtMs = useGameStore((state) => state.questionReceivedAtMs);
  const feedback = useGameStore((state) => state.answerFeedback);
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!question) {
      return;
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 120);
    return () => window.clearInterval(intervalId);
  }, [question]);

  useEffect(() => {
    setSubmittingQuestionId(null);
    setSelectedChoice("");
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

  const choices = useMemo(() => (
    Array.isArray(question?.choices)
      ? question.choices.map((choice) => String(choice).trim()).filter(Boolean)
      : []
  ), [question?.choices]);

  const submitChoice = (choice: string) => {
    const normalizedChoice = choice.trim();
    if (!question || submittingQuestionId === question.questionId || !normalizedChoice) {
      return;
    }
    setSubmittingQuestionId(question.questionId);
    setSelectedChoice(normalizedChoice);
    gameSocket.submitAnswer(normalizedChoice, false);
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
    ? t("correct")
    : latestFeedback?.feedback === "timeout"
      ? t("timeout")
      : t("wrong");
  const promptText = question.kind === "WORD_PROBLEM" ? question.prompt : `${question.prompt} = ?`;
  const arithmeticQuestion = question.kind !== "WORD_PROBLEM";

  return (
    <section className="pointer-events-auto absolute bottom-4 left-1/2 z-[25] w-[min(94vw,30rem)] -translate-x-1/2 rounded-2xl border border-cyan-300/40 bg-slate-900/88 p-3 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/85">
          {question.highwayChallenge ? t("highwayChallenge") : t("mathBoost")}
        </p>
        <p className="text-xs font-semibold text-cyan-100">{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <p className={`mb-3 text-xl font-bold text-cyan-50 ${arithmeticQuestion ? "math-expression" : ""}`}>{promptText}</p>

      {latestFeedback ? (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm font-semibold ${feedbackClass}`}>
          {feedbackText}
          {typeof latestFeedback.pointsDelta === "number" ? (
            <span className="ml-2 opacity-85">{latestFeedback.pointsDelta > 0 ? "+" : ""}{latestFeedback.pointsDelta}</span>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice, index) => {
          const isSelected = selectedChoice === choice && disabled;
          return (
            <button
              key={`${question.questionId}-${choice}`}
              type="button"
              disabled={disabled}
              onClick={() => submitChoice(choice)}
              className={`min-h-12 rounded-lg border px-3 py-2 text-left text-base font-semibold text-cyan-50 transition focus:outline-none focus:ring-2 focus:ring-cyan-200/45 disabled:cursor-not-allowed ${
                isSelected
                  ? "border-cyan-100 bg-cyan-300/35"
                  : "border-cyan-300/45 bg-slate-950/88 hover:border-cyan-100 hover:bg-cyan-400/18 disabled:opacity-70"
              }`}
            >
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-200/50 bg-cyan-300/12 text-xs uppercase text-cyan-100">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="math-answer">{choice}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
