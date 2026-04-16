import { FormEvent, useEffect, useMemo, useState } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";

export function QuestionOverlay() {
  const racePhase = useGameStore((state) => state.racePhase);
  const question = useGameStore((state) => state.question);
  const questionReceivedAtMs = useGameStore((state) => state.questionReceivedAtMs);
  const [answer, setAnswer] = useState("");
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
    if (!answer.trim()) {
      return;
    }
    gameSocket.submitAnswer(answer.trim());
    setAnswer("");
  };

  if (!question || racePhase !== "active") {
    return null;
  }

  return (
    <section className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(94vw,34rem)] -translate-x-1/2 rounded-2xl border border-cyan-300/40 bg-slate-900/82 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/85">
          {question.highwayChallenge ? "Highway challenge" : "Math boost"}
        </p>
        <p className="text-xs font-semibold text-cyan-100">{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <p className="mb-4 text-2xl font-bold text-cyan-50">{question.prompt} = ?</p>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          className="flex-1 rounded-lg border border-cyan-300/45 bg-slate-950/90 px-3 py-2 text-base text-cyan-100 outline-none transition focus:border-cyan-200 focus:ring-2 focus:ring-cyan-200/40"
          placeholder="Type answer..."
          inputMode="numeric"
          autoFocus
        />
        <button
          type="submit"
          className="rounded-lg border border-cyan-300/60 bg-cyan-400/25 px-4 py-2 text-sm font-semibold uppercase tracking-[0.1em] text-cyan-50 transition hover:bg-cyan-300/35"
        >
          Send
        </button>
      </form>
    </section>
  );
}
