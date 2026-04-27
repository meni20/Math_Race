package com.asphalt8.backend.game.dto;

public record RoomPlayerRequest(
    String roomId,
    String playerId
) {
}
