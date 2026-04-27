package com.asphalt8.backend.game.dto;

public record RoomSettings(
    String raceName,
    int maxPlayers,
    int raceDurationSeconds,
    int questionTimeLimitSeconds
) {
}
