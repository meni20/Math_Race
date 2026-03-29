package com.asphalt8.backend.game.dto;

import java.util.List;

public record GameStateUpdateMessage(
    String roomId,
    long serverTimeMs,
    long tick,
    long raceStartedAtMs,
    boolean raceStopped,
    long raceStoppedAtMs,
    String winnerPlayerId,
    List<PlayerSnapshot> players
) {
}
