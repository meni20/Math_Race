import { useSyncExternalStore } from "react";
import { useGameStore } from "../store/useGameStore";
import type { PlayerSnapshot } from "../types/messages";
import { advanceRenderedPlayers } from "./renderMotion";

interface RenderedPlayersSnapshot {
  nowMs: number;
  playerId: string;
  playerIds: string[];
  players: Record<string, PlayerSnapshot>;
  localPlayer: PlayerSnapshot | undefined;
}

const EMPTY_RENDERED_SNAPSHOT: RenderedPlayersSnapshot = {
  nowMs: Date.now(),
  playerId: "",
  playerIds: [],
  players: {},
  localPlayer: undefined
};

function buildRenderedSnapshot(
  nowMs: number,
  previousPlayers: Record<string, PlayerSnapshot>,
  lastFrameAtMs: number
) {
  const gameState = useGameStore.getState();
  const players = advanceRenderedPlayers({
    previousPlayers,
    authoritativePlayers: gameState.players,
    playerIds: gameState.playerIds,
    localPlayerId: gameState.playerId,
    playerSyncMeta: gameState.playerSyncMeta,
    localMotionPrediction: gameState.localMotionPrediction,
    trackLengthMeters: gameState.trackLengthMeters,
    raceStopped: gameState.raceStopped,
    nowMs,
    lastFrameAtMs
  });

  return {
    snapshot: {
      nowMs,
      playerId: gameState.playerId,
      playerIds: gameState.playerIds,
      players,
      localPlayer: gameState.playerId ? players[gameState.playerId] : undefined
    } satisfies RenderedPlayersSnapshot,
    players
  };
}

const renderedPlayersStore = (() => {
  let snapshot = EMPTY_RENDERED_SNAPSHOT;
  let renderedPlayers: Record<string, PlayerSnapshot> = {};
  let lastFrameAtMs = 0;
  let animationFrameId = 0;
  const listeners = new Set<() => void>();

  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const advanceFrame = (nowMs: number) => {
    const next = buildRenderedSnapshot(nowMs, renderedPlayers, lastFrameAtMs);
    renderedPlayers = next.players;
    snapshot = next.snapshot;
    lastFrameAtMs = nowMs;
  };

  const tick = () => {
    advanceFrame(Date.now());
    publish();

    if (listeners.size > 0) {
      animationFrameId = window.requestAnimationFrame(tick);
      return;
    }

    animationFrameId = 0;
  };

  const ensureAnimationLoop = () => {
    if (typeof window === "undefined" || animationFrameId !== 0) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(tick);
  };

  const stopAnimationLoop = () => {
    if (typeof window === "undefined" || animationFrameId === 0 || listeners.size > 0) {
      return;
    }

    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  };

  advanceFrame(Date.now());

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      advanceFrame(Date.now());
      listener();
      ensureAnimationLoop();

      return () => {
        listeners.delete(listener);
        stopAnimationLoop();
      };
    },
    getSnapshot() {
      return snapshot;
    }
  };
})();

export function getRenderedPlayersSnapshot() {
  return renderedPlayersStore.getSnapshot();
}

export function useRenderedPlayers() {
  return useSyncExternalStore(
    renderedPlayersStore.subscribe,
    renderedPlayersStore.getSnapshot,
    renderedPlayersStore.getSnapshot
  );
}
