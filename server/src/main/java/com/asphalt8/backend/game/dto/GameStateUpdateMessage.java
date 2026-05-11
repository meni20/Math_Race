package com.asphalt8.backend.game.dto;

import java.util.List;

public record GameStateUpdateMessage(
    String roomId,
    long serverTimeMs,
    long tick,
    String racePhase,
    long raceStartingAtMs,
    long raceStartedAtMs,
    boolean raceStopped,
    long raceStoppedAtMs,
    String winnerPlayerId,
    String roomCreatorPlayerId,
    RoomSettings roomSettings,
    List<PlayerSnapshot> players
) {
}
