package com.asphalt8.backend.game.dto;

public record PlayerSnapshot(
    String playerId,
    String displayName,
    int laneIndex,
    double positionMeters,
    double speedMps,
    int lap,
    boolean finished
) {
}
