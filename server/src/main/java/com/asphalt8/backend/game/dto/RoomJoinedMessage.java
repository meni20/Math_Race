package com.asphalt8.backend.game.dto;

public record RoomJoinedMessage(
    String roomId,
    String targetPlayerId,
    String displayName,
    double trackLengthMeters,
    int totalLaps,
    double baseSpeedMps,
    String roomCreatorPlayerId,
    RoomSettings roomSettings,
    String carId
) {
    public RoomJoinedMessage(
        String roomId,
        String targetPlayerId,
        String displayName,
        double trackLengthMeters,
        int totalLaps,
        double baseSpeedMps,
        String roomCreatorPlayerId,
        RoomSettings roomSettings
    ) {
        this(roomId, targetPlayerId, displayName, trackLengthMeters, totalLaps, baseSpeedMps, roomCreatorPlayerId, roomSettings, null);
    }
}
