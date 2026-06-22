import { useSyncExternalStore } from "react";
import { useGameStore } from "../store/useGameStore";
import type { PlayerSnapshot } from "../types/messages";
import { advanceRenderedPlayers } from "./renderMotion";

const UI_SNAPSHOT_INTERVAL_MS = 125;

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
    classroomVisualMode: gameState.sessionMode === "shared" && gameState.roomCreatorPlayerId === "",
    answerFeedback: gameState.answerFeedback,
    trackLengthMeters: gameState.trackLengthMeters,
    classroomTargetScore: gameState.roomSettings.targetScore,
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
  let uiSnapshot = EMPTY_RENDERED_SNAPSHOT;
  let renderedPlayers: Record<string, PlayerSnapshot> = {};
  let lastFrameAtMs = 0;
  let lastUiPublishAtMs = 0;
  let animationFrameId = 0;
  const listeners = new Set<() => void>();
  const uiListeners = new Set<() => void>();

  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const publishUi = () => {
    for (const listener of uiListeners) {
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
    const nowMs = Date.now();
    advanceFrame(nowMs);

    if (listeners.size > 0) {
      publish();
    }

    if (uiListeners.size > 0 && nowMs - lastUiPublishAtMs >= UI_SNAPSHOT_INTERVAL_MS) {
      uiSnapshot = snapshot;
      lastUiPublishAtMs = nowMs;
      publishUi();
      if (import.meta.env.DEV) {
        recordUiPublish(nowMs);
      }
    }

    if (listeners.size > 0 || uiListeners.size > 0) {
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
    if (
      typeof window === "undefined"
      || animationFrameId === 0
      || listeners.size > 0
      || uiListeners.size > 0
    ) {
      return;
    }

    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  };

  advanceFrame(Date.now());
  uiSnapshot = snapshot;

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
    },
    subscribeUi(listener: () => void) {
      uiListeners.add(listener);
      advanceFrame(Date.now());
      uiSnapshot = snapshot;
      lastUiPublishAtMs = Date.now();
      listener();
      ensureAnimationLoop();

      return () => {
        uiListeners.delete(listener);
        stopAnimationLoop();
      };
    },
    getUiSnapshot() {
      return uiSnapshot;
    }
  };
})();

let uiPublishWindowStartedAtMs = 0;
let uiPublishCount = 0;

function recordUiPublish(nowMs: number) {
  if (uiPublishWindowStartedAtMs <= 0) {
    uiPublishWindowStartedAtMs = nowMs;
  }
  uiPublishCount += 1;
  if (nowMs - uiPublishWindowStartedAtMs < 5000) {
    return;
  }

  const updatesPerSecond = uiPublishCount / ((nowMs - uiPublishWindowStartedAtMs) / 1000);
  console.debug("[rendered-players-ui] throttled updates/sec", updatesPerSecond.toFixed(1));
  uiPublishWindowStartedAtMs = nowMs;
  uiPublishCount = 0;
}

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

export function useRenderedPlayersUi() {
  return useSyncExternalStore(
    renderedPlayersStore.subscribeUi,
    renderedPlayersStore.getUiSnapshot,
    renderedPlayersStore.getUiSnapshot
  );
}
