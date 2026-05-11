import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";

export function DecisionOverlay() {
  const racePhase = useGameStore((state) => state.racePhase);
  const decision = useGameStore((state) => state.decision);
  const clearDecision = useGameStore((state) => state.clearDecision);

  if (!decision || racePhase !== "active") {
    return null;
  }

  const choose = (choice: "HIGHWAY" | "DIRT") => {
    gameSocket.submitDecision(choice);
    clearDecision();
  };

  return (
    <section className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-300/45 bg-slate-950/86 p-5 shadow-neon backdrop-blur-xl">
      <p className="text-xs uppercase tracking-[0.2em] text-amber-200/85">Decision Point</p>
      <h2 className="mt-1 text-xl font-bold text-amber-100">{decision.prompt}</h2>
      <p className="mt-2 text-sm text-slate-300">
        HIGHWAY: question difficulty spikes; correct answer gives teleport + super boost. DIRT: safe small boost.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => choose("HIGHWAY")}
          className="rounded-xl border border-rose-300/45 bg-rose-500/20 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/30"
        >
          Highway
        </button>
        <button
          onClick={() => choose("DIRT")}
          className="rounded-xl border border-emerald-300/45 bg-emerald-500/20 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/30"
        >
          Dirt
        </button>
      </div>
    </section>
  );
}
