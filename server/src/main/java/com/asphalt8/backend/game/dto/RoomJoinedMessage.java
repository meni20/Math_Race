package com.asphalt8.backend.game.dto;

public record RoomJoinedMessage(
    String roomId,
    String targetPlayerId,
    String displayName,
    double trackLengthMeters,
    int totalLaps,
    double baseSpeedMps,
    String roomCreatorPlayerId,
    RoomSettings roomSettings
) {
}
