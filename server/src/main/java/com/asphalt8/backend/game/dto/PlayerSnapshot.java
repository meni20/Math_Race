package com.asphalt8.backend.game.dto;

public record PlayerSnapshot(
    String playerId,
    String displayName,
    int laneIndex,
    double positionMeters,
    double speedMps,
    int lap,
    boolean finished,
    String racePhase,
    String carId
) {
    public PlayerSnapshot(
        String playerId,
        String displayName,
        int laneIndex,
        double positionMeters,
        double speedMps,
        int lap,
        boolean finished,
        String racePhase
    ) {
        this(playerId, displayName, laneIndex, positionMeters, speedMps, lap, finished, racePhase, null);
    }
}
