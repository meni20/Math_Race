import type { LocalClassroomRoom } from "./localClassroom";

export function finishLocalClassroomRoom(current: LocalClassroomRoom, now: number): LocalClassroomRoom {
  const leader = Object.values(current.players).sort((left, right) => {
    const scoreDelta = Math.max(0, right.score ?? 0) - Math.max(0, left.score ?? 0);
    return scoreDelta !== 0 ? scoreDelta : right.positionMeters - left.positionMeters;
  })[0];
  return {
    ...current,
    racePhase: "finish",
    raceStopped: true,
    raceStoppedAtMs: now,
    endedAtMs: now,
    winnerPlayerId: current.winnerPlayerId ?? leader?.playerId ?? null,
    isListed: false,
    isLocked: true,
    players: Object.fromEntries(Object.values(current.players).map((player) => [
      player.playerId,
      { ...player, racePhase: "finish" as const, speedMps: 0 }
    ]))
  };
}
