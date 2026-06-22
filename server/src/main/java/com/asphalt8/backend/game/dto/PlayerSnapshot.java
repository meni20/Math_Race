package com.asphalt8.backend.game.dto;

import java.util.Map;

public record PlayerSnapshot(
    String playerId,
    String displayName,
    int laneIndex,
    double positionMeters,
    double speedMps,
    int lap,
    boolean finished,
    String racePhase,
    String carId,
    String routeMode,
    Map<String, Integer> routeStats,
    double maxSpeedMps
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
        this(playerId, displayName, laneIndex, positionMeters, speedMps, lap, finished, racePhase, null, "NORMAL", Map.of(), speedMps);
    }

    public PlayerSnapshot(
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
        this(playerId, displayName, laneIndex, positionMeters, speedMps, lap, finished, racePhase, carId, "NORMAL", Map.of(), speedMps);
    }
}
