package com.asphalt8.backend.game.dto;

public record UpdateRoomSettingsRequest(
    String roomId,
    String playerId,
    RoomSettings roomSettings
) {
}
