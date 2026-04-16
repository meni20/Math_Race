import { useEffect, useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import type { PlayerSnapshot } from "../types/messages";
import { getRenderedPlayerSnapshot } from "./renderMotion";

export function useAnimatedNow(active = true) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      setNowMs(Date.now());
      return undefined;
    }

    let animationFrameId = 0;

    const tick = () => {
      setNowMs(Date.now());
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [active]);

  return nowMs;
}

export function useRenderedPlayers() {
  const playerId = useGameStore((state) => state.playerId);
  const playerIds = useGameStore((state) => state.playerIds);
  const players = useGameStore((state) => state.players);
  const playerSyncMeta = useGameStore((state) => state.playerSyncMeta);
  const localMotionPrediction = useGameStore((state) => state.localMotionPrediction);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const nowMs = useAnimatedNow(Boolean(playerIds.length || playerId));

  const renderedPlayers = useMemo(() => {
    const nextPlayers: Record<string, PlayerSnapshot> = {};

    for (const currentPlayerId of playerIds) {
      const renderedPlayer = getRenderedPlayerSnapshot(
        players[currentPlayerId],
        playerSyncMeta[currentPlayerId],
        localMotionPrediction,
        trackLengthMeters,
        raceStopped,
        nowMs
      );
      if (renderedPlayer) {
        nextPlayers[currentPlayerId] = renderedPlayer;
      }
    }

    if (playerId && !nextPlayers[playerId] && players[playerId]) {
      const renderedPlayer = getRenderedPlayerSnapshot(
        players[playerId],
        playerSyncMeta[playerId],
        localMotionPrediction,
        trackLengthMeters,
        raceStopped,
        nowMs
      );
      if (renderedPlayer) {
        nextPlayers[playerId] = renderedPlayer;
      }
    }

    return nextPlayers;
  }, [localMotionPrediction, nowMs, playerId, playerIds, playerSyncMeta, players, raceStopped, trackLengthMeters]);

  return {
    nowMs,
    playerId,
    playerIds,
    players: renderedPlayers,
    localPlayer: playerId ? renderedPlayers[playerId] : undefined
  };
}
